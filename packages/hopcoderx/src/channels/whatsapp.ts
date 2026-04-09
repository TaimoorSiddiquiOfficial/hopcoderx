/**
 * WhatsApp channel for HopCoderX via Baileys (WhatsApp Web).
 *
 * Authenticates by scanning a QR code in WhatsApp → Linked Devices.
 * No Twilio account or phone number required.
 *
 * Setup:
 *   HOPCODERX_WHATSAPP_AUTH_DIR=~/.hopcoderx/whatsapp-auth  (optional)
 *
 * Usage:
 *   const ch = new WhatsAppChannel()
 *   await ch.init()                       // loads saved auth if present
 *   const { qrDataUrl } = await ch.startQrLogin()  // get PNG data URL to show user
 *   const { connected } = await ch.waitForLogin()  // wait for scan
 *   await ch.send("+1234567890", { text: "hello" })
 */

import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys"
import type { WASocket, ConnectionState } from "@whiskeysockets/baileys"
import QRCode from "qrcode"
import type { Channel, ChannelConfig, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

const LOGGED_OUT_CODE = DisconnectReason?.loggedOut ?? 401
const RESTART_REQUIRED_CODE = 515
const QR_TTL_MS = 3 * 60_000   // QR expires after 3 minutes
const QR_TIMEOUT_MS = 30_000   // time to wait for first QR emission

// ─── Helpers ─────────────────────────────────────────────────────────────────

function defaultAuthDir(): string {
  return path.join(os.homedir(), ".hopcoderx", "whatsapp-auth")
}

/** Convert a WhatsApp JID (12345@s.whatsapp.net) to an E.164 phone string */
function jidToE164(jid: string): string {
  return "+" + jid.replace(/@.+$/, "").replace(/[^0-9]/g, "")
}

/** Normalise a phone number or JID to a WhatsApp JID */
function toJid(to: string): string {
  if (to.endsWith("@s.whatsapp.net") || to.endsWith("@g.us")) return to
  const digits = to.replace(/[^0-9]/g, "")
  return `${digits}@s.whatsapp.net`
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]
  const chunks: string[] = []
  let pos = 0
  while (pos < text.length) {
    chunks.push(text.slice(pos, pos + maxLen))
    pos += maxLen
  }
  return chunks
}

// ─── Active login state ───────────────────────────────────────────────────────

interface ActiveLogin {
  id: string
  sock: WASocket
  startedAt: number
  qrDataUrl?: string
  connected: boolean
  error?: string
  errorCode?: number
  waitPromise: Promise<void>
  restartAttempted: boolean
}

// ─── WhatsAppChannel ─────────────────────────────────────────────────────────

export class WhatsAppChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "whatsapp",
    name: "WhatsApp (Baileys)",
    envVars: [],   // no env vars required — auth is QR-based
    canReceive: true,
    canSend: true,
  }

  private authDir: string
  private handlers: Handler[] = []
  private sock: WASocket | null = null
  private activeLogin: ActiveLogin | null = null

  constructor(authDir?: string) {
    this.authDir = authDir ?? process.env.HOPCODERX_WHATSAPP_AUTH_DIR ?? defaultAuthDir()
  }

  isAvailable(): boolean {
    // Always available — auth is obtained via QR scan at runtime
    return true
  }

  /** Load saved auth and restore the socket if credentials exist. */
  async init(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir)
    if (!state.creds.registered) {
      console.log("[whatsapp] No saved session — call startQrLogin() to link a device")
      return
    }
    await this._createSocket(state, saveCreds, false)
    console.log("[whatsapp] Session restored")
  }

  // ─── QR login flow ──────────────────────────────────────────────────────────

  /**
   * Start a QR login session and return a data URL PNG to show the user.
   * The user scans it in WhatsApp → Settings → Linked Devices → Link a Device.
   */
  async startQrLogin(
    opts: { force?: boolean; timeoutMs?: number } = {},
  ): Promise<{ qrDataUrl?: string; message: string }> {
    if (this.activeLogin && this._isLoginFresh() && this.activeLogin.qrDataUrl && !opts.force) {
      return {
        qrDataUrl: this.activeLogin.qrDataUrl,
        message: "QR already active — scan it in WhatsApp → Linked Devices.",
      }
    }

    // Clean up any stale login
    this._closeActiveLogin()

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir)
    if (state.creds.registered && !opts.force) {
      return { message: "WhatsApp already linked. Pass force:true to re-scan." }
    }

    let resolveQr!: (qr: string) => void
    let rejectQr!: (err: Error) => void
    const qrPromise = new Promise<string>((res, rej) => {
      resolveQr = res
      rejectQr = rej
    })

    const qrTimer = setTimeout(
      () => rejectQr(new Error("Timed out waiting for WhatsApp QR")),
      Math.max(opts.timeoutMs ?? QR_TIMEOUT_MS, 5_000),
    )

    let capturedQr: string | null = null
    let sock: WASocket
    try {
      sock = await this._createSocket(state, saveCreds, true, (qr) => {
        if (capturedQr) return
        capturedQr = qr
        clearTimeout(qrTimer)
        resolveQr(qr)
      })
    } catch (err) {
      clearTimeout(qrTimer)
      return { message: `Failed to start WhatsApp login: ${String(err)}` }
    }

    const login: ActiveLogin = {
      id: randomUUID(),
      sock,
      startedAt: Date.now(),
      connected: false,
      waitPromise: Promise.resolve(),
      restartAttempted: false,
    }
    this.activeLogin = login
    this._attachLoginWaiter(login)

    let qr: string
    try {
      qr = await qrPromise
    } catch (err) {
      this._closeActiveLogin()
      return { message: `Failed to get QR: ${String(err)}` }
    }

    login.qrDataUrl = await QRCode.toDataURL(qr, { errorCorrectionLevel: "M", width: 300 })
    return {
      qrDataUrl: login.qrDataUrl,
      message: "Scan this QR in WhatsApp → Linked Devices → Link a Device.",
    }
  }

  /**
   * Wait for the user to scan the QR.
   * Call this after startQrLogin() — resolves when linked or times out.
   */
  async waitForLogin(
    opts: { timeoutMs?: number } = {},
  ): Promise<{ connected: boolean; message: string }> {
    const login = this.activeLogin
    if (!login) {
      return { connected: false, message: "No active WhatsApp login — call startQrLogin() first." }
    }
    if (!this._isLoginFresh()) {
      this._closeActiveLogin()
      return { connected: false, message: "QR expired — call startQrLogin() to get a fresh one." }
    }

    const timeoutMs = Math.max(opts.timeoutMs ?? 120_000, 1_000)
    const deadline = Date.now() + timeoutMs

    while (true) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        return { connected: false, message: "Still waiting for scan — let me know when done." }
      }

      const timeout = new Promise<"timeout">((res) => setTimeout(() => res("timeout"), remaining))
      const result = await Promise.race([login.waitPromise.then(() => "done" as const), timeout])

      if (result === "timeout") {
        return { connected: false, message: "Still waiting for scan — let me know when done." }
      }

      if (login.error) {
        if (login.errorCode === LOGGED_OUT_CODE) {
          this._closeActiveLogin()
          return { connected: false, message: "WhatsApp rejected the session — scan a new QR." }
        }
        if (login.errorCode === RESTART_REQUIRED_CODE && !login.restartAttempted) {
          login.restartAttempted = true
          await this._restartLoginSocket(login)
          if (this._isLoginFresh()) continue
        }
        const msg = `WhatsApp login failed: ${login.error}`
        this._closeActiveLogin()
        return { connected: false, message: msg }
      }

      if (login.connected) {
        this._closeActiveLogin()
        return { connected: true, message: "✅ Linked! WhatsApp is ready." }
      }

      return { connected: false, message: "Login ended unexpectedly." }
    }
  }

  // ─── Channel interface ──────────────────────────────────────────────────────

  onMessage(handler: Handler): void {
    this.handlers.push(handler)
  }

  async startListening(): Promise<void> {
    if (this.sock) {
      console.log("[whatsapp] Already listening")
      return
    }
    await this.init()
    if (!this.sock) {
      console.warn("[whatsapp] Not linked — startQrLogin() first")
    }
  }

  async stopListening(): Promise<void> {
    this._closeSock()
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    const sock = this._requireSock()
    const jid = toJid(to)
    for (const chunk of splitMessage(reply.text, 4_096)) {
      await sock.sendMessage(jid, { text: chunk })
    }
  }

  /** Send a media file. `data` is a Buffer or URL string. */
  async sendMedia(
    to: string,
    data: Buffer | string,
    opts: { mimeType?: string; caption?: string; filename?: string } = {},
  ): Promise<void> {
    const sock = this._requireSock()
    const jid = toJid(to)
    const mime = opts.mimeType ?? "application/octet-stream"
    const content =
      typeof data === "string"
        ? { url: data }
        : { stream: require("node:stream").Readable.from(data) }

    if (mime.startsWith("image/")) {
      await sock.sendMessage(jid, { image: content as any, caption: opts.caption })
    } else if (mime.startsWith("video/")) {
      await sock.sendMessage(jid, { video: content as any, caption: opts.caption })
    } else if (mime.startsWith("audio/")) {
      await sock.sendMessage(jid, { audio: content as any, mimetype: mime })
    } else {
      await sock.sendMessage(jid, {
        document: content as any,
        mimetype: mime,
        fileName: opts.filename ?? "file",
        caption: opts.caption,
      })
    }
  }

  // ─── Internal socket lifecycle ───────────────────────────────────────────────

  private async _createSocket(
    state: Awaited<ReturnType<typeof useMultiFileAuthState>>["state"],
    saveCreds: () => Promise<void>,
    printQR: boolean,
    onQr?: (qr: string) => void,
  ): Promise<WASocket> {
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, undefined as any),
      },
      printQRInTerminal: printQR,
      browser: ["HopCoderX", "Chrome", "1.0"],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
    })

    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("connection.update", (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update
      if (qr && onQr) onQr(qr)
      if (connection === "open") {
        console.log("[whatsapp] Connected ✅")
        this.sock = sock
      }
      if (connection === "close") {
        const code = (lastDisconnect?.error as any)?.output?.statusCode
        if (code !== LOGGED_OUT_CODE && code !== RESTART_REQUIRED_CODE) {
          console.log(`[whatsapp] Disconnected (${code}) — reconnecting…`)
          this._reconnect(saveCreds)
        } else if (code === LOGGED_OUT_CODE) {
          console.warn("[whatsapp] Logged out — re-scan QR to relink")
          this.sock = null
        }
      }
    })

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return
      for (const msg of messages) {
        if (msg.key.fromMe) continue
        const from = msg.key.remoteJid ?? "unknown"
        const text =
          msg.message?.conversation ??
          msg.message?.extendedTextMessage?.text ??
          msg.message?.imageMessage?.caption ??
          msg.message?.videoMessage?.caption ??
          ""
        const channelMsg: ChannelMessage = {
          id: msg.key.id ?? randomUUID(),
          channelId: "whatsapp",
          from: from.includes("@s.whatsapp.net") ? jidToE164(from) : from,
          threadId: from,
          text,
          timestamp: msg.messageTimestamp != null ? (msg.messageTimestamp as number) * 1_000 : Date.now(),
          raw: msg as any,
        }
        for (const handler of this.handlers) {
          handler(channelMsg).catch((err) => console.error("[whatsapp] handler error:", err))
        }
      }
    })

    return sock
  }

  private async _reconnect(saveCreds: () => Promise<void>): Promise<void> {
    this.sock = null
    try {
      const { state, saveCreds: sc } = await useMultiFileAuthState(this.authDir)
      await this._createSocket(state, sc ?? saveCreds, false)
    } catch (err) {
      console.error("[whatsapp] Reconnect failed:", err)
    }
  }

  private _closeSock(): void {
    try { this.sock?.ws?.close() } catch { /* ignore */ }
    this.sock = null
  }

  private _requireSock(): WASocket {
    if (!this.sock) throw new Error("WhatsApp not connected — call init() or startQrLogin() first")
    return this.sock
  }

  private _isLoginFresh(): boolean {
    return !!this.activeLogin && Date.now() - this.activeLogin.startedAt < QR_TTL_MS
  }

  private _closeActiveLogin(): void {
    if (this.activeLogin) {
      try { this.activeLogin.sock.ws?.close() } catch { /* ignore */ }
      this.activeLogin = null
    }
  }

  private _attachLoginWaiter(login: ActiveLogin): void {
    login.waitPromise = new Promise<void>((resolve) => {
      login.sock.ev.on("connection.update", (update: Partial<ConnectionState>) => {
        const { connection, lastDisconnect } = update
        if (connection === "open") {
          login.connected = true
          this.sock = login.sock
          resolve()
        }
        if (connection === "close") {
          login.errorCode = (lastDisconnect?.error as any)?.output?.statusCode
          login.error = String(lastDisconnect?.error ?? "Connection closed")
          resolve()
        }
      })
    })
  }

  private async _restartLoginSocket(login: ActiveLogin): Promise<void> {
    try { login.sock.ws?.close() } catch { /* ignore */ }
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir)
    const sock = await this._createSocket(state, saveCreds, false)
    login.sock = sock
    login.connected = false
    login.error = undefined
    login.errorCode = undefined
    this._attachLoginWaiter(login)
  }
}
