/**
 * Discord channel for HopCoderX — powered by discord.js.
 *
 * Full coding assistant in Discord:
 *   - Receive messages from specific channels/DMs with a command prefix
 *   - Code block formatting for responses
 *   - Slash command support
 *   - Thread and reply context
 *
 * Setup:
 *   DISCORD_BOT_TOKEN=xxx         (Discord bot token — no "Bot " prefix needed)
 *   DISCORD_CHANNEL_IDS=id1,id2   (channel IDs to listen in, empty = all)
 *   DISCORD_PREFIX=!hop           (command prefix, default: !hop)
 *
 * Bot permissions required: Read Messages, Send Messages, Read Message History
 * Privileged intents required: Message Content Intent (enable in Discord Dev Portal)
 */

import {
  Client,
  GatewayIntentBits,
  Partials,
  type Message,
  type OmitPartialGroupDMChannel,
} from "discord.js"
import type { Channel, ChannelConfig, ChannelDiagnostic, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

export class DiscordChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "discord",
    name: "Discord",
    envVars: ["DISCORD_BOT_TOKEN"],
    canReceive: true,
    canSend: true,
  }

  private client: Client | null = null
  private handlers: Handler[] = []
  private channelIds: Set<string>
  private prefix: string

  constructor() {
    this.channelIds = new Set(
      (process.env.DISCORD_CHANNEL_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    )
    this.prefix = process.env.DISCORD_PREFIX ?? "!hop"
  }

  isAvailable(): boolean {
    return !!process.env.DISCORD_BOT_TOKEN
  }

  async init(): Promise<void> {
    if (!this.isAvailable() || this.client) return
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel, Partials.Message],
    })
  }

  onMessage(handler: Handler): void {
    this.handlers.push(handler)
  }

  async startListening(): Promise<void> {
    if (!this.isAvailable()) return
    await this.init()
    const client = this.client!

    client.on("messageCreate", async (msg: OmitPartialGroupDMChannel<Message<boolean>>) => {
      if (msg.author.bot) return
      if (this.channelIds.size > 0 && !this.channelIds.has(msg.channelId)) return
      if (!msg.content.startsWith(this.prefix)) return

      const text = msg.content.slice(this.prefix.length).trim()
      const attachments = msg.attachments.map((a) => ({
        name: a.name,
        url: a.url,
        mimeType: a.contentType ?? undefined,
      }))

      const channelMsg: ChannelMessage = {
        id: msg.id,
        channelId: "discord",
        threadId: msg.channelId,
        from: msg.author.tag ?? msg.author.username,
        text,
        attachments: attachments.length ? attachments : undefined,
        timestamp: msg.createdTimestamp,
        raw: { id: msg.id, channelId: msg.channelId, guildId: msg.guildId, authorId: msg.author.id },
      }
      for (const h of this.handlers) {
        await h(channelMsg).catch((err) => console.error("[discord] handler error:", err))
      }
    })

    const token = process.env.DISCORD_BOT_TOKEN!
    await client.login(token.startsWith("Bot ") ? token.slice(4) : token)
    console.log(`[discord] Logged in as ${client.user?.tag}`)
  }

  async stopListening(): Promise<void> {
    this.client?.destroy()
    this.client = null
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    if (!this.client) throw new Error("Discord: call startListening() first")
    const channel = await this.client.channels.fetch(to)
    if (!channel?.isTextBased()) throw new Error(`Discord channel ${to} is not a text channel`)

    // Split messages longer than Discord's 2000-char limit
    const chunks = splitMessage(reply.text, 2_000)
    for (const chunk of chunks) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (channel as any).send(chunk)
    }
  }

  /** Reply inside a thread (or create one if threadId refers to a message) */
  async sendReply(messageId: string, channelId: string, text: string): Promise<void> {
    if (!this.client) throw new Error("Discord: call startListening() first")
    const channel = await this.client.channels.fetch(channelId)
    if (!channel?.isTextBased()) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (channel as any).send({ content: text.slice(0, 2_000), reply: { messageReference: messageId } })
  }

  async diagnose(): Promise<ChannelDiagnostic> {
    const checks: ChannelDiagnostic["checks"] = []
    const rawToken = process.env.DISCORD_BOT_TOKEN
    const hasToken = !!rawToken
    checks.push({ name: "env:DISCORD_BOT_TOKEN", ok: hasToken, detail: hasToken ? "set" : "missing" })

    let apiOk = false
    let botTag = ""
    if (hasToken) {
      try {
        const token = rawToken!.startsWith("Bot ") ? rawToken!.slice(4) : rawToken!
        const res = await fetch("https://discord.com/api/v10/users/@me", {
          headers: { Authorization: `Bot ${token}` },
        })
        if (res.ok) {
          const data = await res.json() as { username: string; discriminator: string }
          botTag = `${data.username}#${data.discriminator}`
          apiOk = true
        }
      } catch {
        apiOk = false
      }
    }
    checks.push({ name: "api:users/@me", ok: apiOk, detail: apiOk ? botTag : "failed — check token" })

    const ok = hasToken && apiOk
    return {
      channelId: "discord",
      ok,
      summary: ok ? `Connected as ${botTag}` : "Not configured or token invalid",
      checks,
    }
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

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