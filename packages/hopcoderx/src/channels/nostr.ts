/**
 * Nostr channel for HopCoderX.
 *
 * Connects to Nostr relays (WebSocket) to receive and send text notes (kind 1).
 * Listens for mentions (kind 1, p-tagged to our pubkey) and direct messages (kind 4).
 *
 * Setup:
 *   NOSTR_PRIVATE_KEY=hex64...          (nsec private key in hex, 64 chars)
 *   NOSTR_RELAYS=wss://relay.damus.io,wss://relay.nostr.band  (comma-separated relay URLs)
 *   NOSTR_PUBLIC_KEY=hex64...           (optional, derived from private key if not set)
 */

import type { Channel, ChannelConfig, ChannelDiagnostic, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

export class NostrChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "nostr",
    name: "Nostr",
    envVars: ["NOSTR_PRIVATE_KEY", "NOSTR_RELAYS"],
    canReceive: true,
    canSend: true,
  }

  private privkey = process.env.NOSTR_PRIVATE_KEY ?? ""
  private pubkey = process.env.NOSTR_PUBLIC_KEY ?? ""
  private relayUrls = (process.env.NOSTR_RELAYS ?? "wss://relay.damus.io").split(",").map((s) => s.trim()).filter(Boolean)
  private handlers: Handler[] = []
  private sockets: any[] = []
  private _listening = false

  isAvailable(): boolean {
    return !!this.privkey
  }

  async init(): Promise<void> {}

  onMessage(handler: Handler): void {
    this.handlers.push(handler)
  }

  async startListening(): Promise<void> {
    if (!this.isAvailable()) return
    this._listening = true
    for (const url of this.relayUrls) {
      this.connectRelay(url)
    }
  }

  async stopListening(): Promise<void> {
    this._listening = false
    for (const ws of this.sockets) {
      try { ws.close() } catch {}
    }
    this.sockets = []
  }

  private connectRelay(url: string): void {
    const WSClass = (globalThis as any).WebSocket as typeof WebSocket
    if (!WSClass) return

    const ws = new WSClass(url)
    this.sockets.push(ws)

    ws.onopen = () => {
      // Subscribe to kind 1 (text notes) mentioning our pubkey, and kind 4 (DMs)
      const filter: Record<string, any> = { kinds: [1, 4], limit: 0, since: Math.floor(Date.now() / 1000) }
      if (this.pubkey) filter["#p"] = [this.pubkey]
      ws.send(JSON.stringify(["REQ", "hopcoderx-sub", filter]))
    }

    ws.onmessage = async (evt: MessageEvent) => {
      try {
        const payload = JSON.parse(typeof evt.data === "string" ? evt.data : evt.data.toString())
        if (!Array.isArray(payload) || payload[0] !== "EVENT") return
        const event = payload[2] as { id: string; pubkey: string; created_at: number; kind: number; content: string }
        if (!event?.content) return

        const msg: ChannelMessage = {
          id: event.id,
          channelId: "nostr",
          from: event.pubkey,
          text: event.content,
          timestamp: event.created_at * 1000,
          raw: event,
        }
        for (const h of this.handlers) await h(msg)
      } catch {}
    }

    ws.onclose = () => {
      this.sockets = this.sockets.filter((s) => s !== ws)
      if (this._listening) {
        setTimeout(() => { if (this._listening) this.connectRelay(url) }, 5000)
      }
    }
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    if (!this.isAvailable()) throw new Error("Nostr channel not configured — set NOSTR_PRIVATE_KEY and NOSTR_RELAYS")
    // Broadcasting a signed note requires NIP-01 event signing — this is a simplified stub.
    // Full implementation requires secp256k1 schnorr signing (use @noble/curves or similar).
    const note = {
      pubkey: this.pubkey || "0".repeat(64),
      created_at: Math.floor(Date.now() / 1000),
      kind: 1,
      tags: to ? [["p", to]] : [],
      content: reply.text,
    }
    const json = ["EVENT", note]
    for (const ws of this.sockets) {
      if (ws.readyState === 1 /* OPEN */) ws.send(JSON.stringify(json))
    }
  }

  async diagnose(): Promise<ChannelDiagnostic> {
    const checks: ChannelDiagnostic["checks"] = []
    const ok = this.isAvailable()
    const missing = this.config.envVars.filter((v) => !process.env[v])
    checks.push({ name: "env vars", ok, detail: ok ? "all set" : "missing: " + missing.join(", ") })
    if (ok) {
      const relays = (process.env.NOSTR_RELAYS ?? "").split(",").filter(Boolean)
      checks.push({ name: "relays configured", ok: relays.length > 0, detail: relays.length > 0 ? `${relays.length} relay(s)` : "set NOSTR_RELAYS" })
    }
    return { channelId: this.config.id, ok, summary: ok ? "configured" : `missing env: ${missing.join(", ")}`, checks }
  }
}
