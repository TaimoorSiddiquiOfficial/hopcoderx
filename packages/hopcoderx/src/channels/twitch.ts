/**
 * Twitch channel for HopCoderX.
 *
 * Connects to Twitch chat via IRC over WebSocket (irc.chat.twitch.tv:443/ssl).
 * Can monitor chat, respond to commands, and send messages.
 *
 * Setup:
 *   TWITCH_OAUTH_TOKEN=oauth:...     (from https://twitchapps.com/tmi/ — prefix with "oauth:")
 *   TWITCH_USERNAME=yourbotname      (bot's Twitch username, lowercase)
 *   TWITCH_CHANNEL=channelname       (channel to join, without #)
 */

import type { Channel, ChannelConfig, ChannelDiagnostic, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

const TWITCH_IRC_URL = "wss://irc-ws.chat.twitch.tv:443"

export class TwitchChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "twitch",
    name: "Twitch",
    envVars: ["TWITCH_OAUTH_TOKEN", "TWITCH_USERNAME", "TWITCH_CHANNEL"],
    canReceive: true,
    canSend: true,
  }

  private oauthToken = process.env.TWITCH_OAUTH_TOKEN ?? ""
  private username = (process.env.TWITCH_USERNAME ?? "").toLowerCase()
  private channel = (process.env.TWITCH_CHANNEL ?? "").toLowerCase().replace(/^#/, "")
  private handlers: Handler[] = []
  private ws: any = null
  private _listening = false

  isAvailable(): boolean {
    return !!this.oauthToken && !!this.username && !!this.channel
  }

  async init(): Promise<void> {
    // Validated at startListening
  }

  onMessage(handler: Handler): void {
    this.handlers.push(handler)
  }

  async startListening(): Promise<void> {
    if (!this.isAvailable()) return
    this._listening = true
    await this.connect()
  }

  async stopListening(): Promise<void> {
    this._listening = false
    if (this.ws) {
      try { this.ws.close() } catch {}
      this.ws = null
    }
  }

  private async connect(): Promise<void> {
    const WSClass = (globalThis as any).WebSocket as typeof WebSocket
    if (!WSClass) {
      console.warn("[twitch channel] WebSocket not available in this runtime")
      return
    }

    const ws = new WSClass(TWITCH_IRC_URL)
    this.ws = ws

    ws.onopen = () => {
      ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands")
      ws.send(`PASS ${this.oauthToken}`)
      ws.send(`NICK ${this.username}`)
      ws.send(`JOIN #${this.channel}`)
    }

    ws.onmessage = async (evt: MessageEvent) => {
      const raw = typeof evt.data === "string" ? evt.data : evt.data.toString()
      for (const line of raw.split("\r\n").filter(Boolean)) {
        await this.parseLine(line)
      }
    }

    ws.onclose = async () => {
      this.ws = null
      if (this._listening) {
        await new Promise((r) => setTimeout(r, 3000))
        if (this._listening) void this.connect()
      }
    }

    ws.onerror = (err: Event) => {
      console.warn("[twitch channel] IRC error:", err)
    }
  }

  private async parseLine(line: string): Promise<void> {
    // PING :tmi.twitch.tv → pong
    if (line.startsWith("PING")) {
      this.ws?.send("PONG :tmi.twitch.tv")
      return
    }

    // Parse: @tags :user!user@user.tmi.twitch.tv PRIVMSG #channel :text
    const match = line.match(/^(?:@([^ ]+) )?:(\w+)!\w+@\S+ PRIVMSG #(\S+) :(.+)$/)
    if (!match) return

    const [, tagStr, user, chan, text] = match
    const tags: Record<string, string> = {}
    if (tagStr) {
      for (const kv of tagStr.split(";")) {
        const [k, v] = kv.split("=")
        tags[k] = v ?? ""
      }
    }

    const msgId = tags["id"] ?? Date.now().toString()
    const msg: ChannelMessage = {
      id: msgId,
      channelId: "twitch",
      threadId: `#${chan}`,
      from: user,
      text,
      timestamp: tags["tmi-sent-ts"] ? parseInt(tags["tmi-sent-ts"], 10) : Date.now(),
      raw: { tags, user, channel: chan, text },
    }
    for (const h of this.handlers) await h(msg)
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    if (!this.isAvailable()) throw new Error("Twitch channel not configured")
    if (!this.ws) throw new Error("Twitch channel not connected")
    const target = to.startsWith("#") ? to : `#${to || this.channel}`
    // Twitch max message length: 500 chars
    const text = reply.text.slice(0, 500)
    this.ws.send(`PRIVMSG ${target} :${text}`)
  }

  async diagnose(): Promise<ChannelDiagnostic> {
    const checks: ChannelDiagnostic["checks"] = []
    const ok = this.isAvailable()
    const missing = this.config.envVars.filter((v) => !process.env[v])
    checks.push({ name: "env vars", ok, detail: ok ? "all set" : "missing: " + missing.join(", ") })
    return { channelId: this.config.id, ok, summary: ok ? "configured" : `missing env: ${missing.join(", ")}`, checks }
  }
}
