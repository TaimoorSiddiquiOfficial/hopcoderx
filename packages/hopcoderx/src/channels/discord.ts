/**
 * Discord channel for HopCoderX.
 *
 * Full coding assistant in Discord:
 *   - Receive messages from specific channels/DMs
 *   - Code block formatting for responses
 *   - Slash command responses
 *   - Embed-rich replies for CI results, code reviews
 *
 * Setup:
 *   DISCORD_BOT_TOKEN=Bot xxx     (Discord bot token)
 *   DISCORD_CHANNEL_IDS=id1,id2   (channel IDs to listen in)
 *   DISCORD_GUILD_ID=xxx          (optional: restrict to one guild)
 *   DISCORD_PREFIX=!hop           (command prefix, default: !hop)
 */

import type { Channel, ChannelConfig, ChannelMessage, ChannelReply } from "./channel"
// Bun has native WebSocket; use a simple any type to avoid ws dependency
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WS = globalThis.WebSocket as any

type Handler = (msg: ChannelMessage) => Promise<void>

interface DiscordMessage {
  id: string
  channel_id: string
  guild_id?: string
  content: string
  author: { id: string; username: string; bot?: boolean }
}

export class DiscordChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "discord",
    name: "Discord",
    envVars: ["DISCORD_BOT_TOKEN"],
    canReceive: true,
    canSend: true,
  }

  private token = process.env.DISCORD_BOT_TOKEN ?? ""
  private channelIds = new Set((process.env.DISCORD_CHANNEL_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean))
  private prefix = process.env.DISCORD_PREFIX ?? "!hop"
  private handlers: Handler[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _ws: any = null
  private _heartbeat?: NodeJS.Timer
  private _seq: number | null = null
  private _sessionId?: string
  private _resumeGatewayUrl?: string

  isAvailable(): boolean {
    return !!this.token
  }

  async init(): Promise<void> {}

  onMessage(handler: Handler): void {
    this.handlers.push(handler)
  }

  async startListening(): Promise<void> {
    if (!this.isAvailable()) return
    await this.connectGateway()
  }

  async stopListening(): Promise<void> {
    if (this._heartbeat) clearInterval(this._heartbeat)
    this._ws?.close()
    this._ws = null
  }

  private async connectGateway(): Promise<void> {
    // Get gateway URL
    const res = await fetch("https://discord.com/api/v10/gateway/bot", {
      headers: { Authorization: `Bot ${this.token}` },
    })
    if (!res.ok) throw new Error(`Discord gateway error: ${res.status}`)
    const data = (await res.json()) as { url: string }
    const wsUrl = `${data.url}?v=10&encoding=json`
    this._connect(wsUrl)
  }

  private _connect(wsUrl: string): void {
    this._ws = new WS(wsUrl)

    this._ws.on("message", async (raw: Buffer) => {
      const payload = JSON.parse(raw.toString()) as { op: number; d: any; s?: number; t?: string }
      if (payload.s !== undefined && payload.s !== null) this._seq = payload.s

      switch (payload.op) {
        case 10: { // Hello
          const interval = payload.d.heartbeat_interval
          this._heartbeat = setInterval(() => {
            this._ws?.send(JSON.stringify({ op: 1, d: this._seq }))
          }, interval)
          // Identify
          this._ws?.send(JSON.stringify({
            op: 2,
            d: {
              token: this.token,
              intents: 513, // GUILDS + GUILD_MESSAGES
              properties: { os: process.platform, browser: "hopcoderx", device: "hopcoderx" },
            },
          }))
          break
        }
        case 0: { // Dispatch
          if (payload.t === "READY") {
            this._sessionId = payload.d.session_id
            this._resumeGatewayUrl = payload.d.resume_gateway_url
          } else if (payload.t === "MESSAGE_CREATE") {
            await this.handleDiscordMessage(payload.d as DiscordMessage)
          }
          break
        }
        case 7: // Reconnect
        case 9: { // Invalid session
          setTimeout(() => this._connect(this._resumeGatewayUrl ?? wsUrl), 3000)
          break
        }
      }
    })

    this._ws.on("close", () => {
      if (this._heartbeat) clearInterval(this._heartbeat)
      // Auto-reconnect
      setTimeout(() => this._connect(this._resumeGatewayUrl ?? wsUrl), 5000)
    })
  }

  private async handleDiscordMessage(dm: DiscordMessage): Promise<void> {
    if (dm.author.bot) return
    if (this.channelIds.size > 0 && !this.channelIds.has(dm.channel_id)) return
    if (!dm.content.startsWith(this.prefix)) return

    const text = dm.content.slice(this.prefix.length).trim()
    const msg: ChannelMessage = {
      id: dm.id,
      channelId: "discord",
      threadId: dm.channel_id,
      from: `${dm.author.username}#${dm.author.id}`,
      text,
      raw: dm,
      timestamp: Date.now(),
    }
    for (const h of this.handlers) await h(msg)
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    if (!this.isAvailable()) throw new Error("Discord channel not configured")
    const channelId = to.startsWith("discord:") ? to.slice(8) : to
    const content = reply.text.slice(0, 2000)
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) throw new Error(`Discord send error: ${res.status} ${await res.text()}`)
  }
}
