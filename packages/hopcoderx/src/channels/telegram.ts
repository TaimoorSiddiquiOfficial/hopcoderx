/**
 * Telegram channel for HopCoderX — powered by Grammy.
 *
 * Personal coding assistant via Telegram bot.
 * Send code snippets, get reviews, trigger CI, check deployment status.
 *
 * Setup:
 *   TELEGRAM_BOT_TOKEN=123456:ABC-xxx   (from @BotFather)
 *   TELEGRAM_ALLOWED_IDS=12345,67890    (comma-separated chat IDs allowed to use the bot)
 */

import { Bot, type Context } from "grammy"
import { run, sequentialize } from "@grammyjs/runner"
import type { Channel, ChannelConfig, ChannelDiagnostic, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

export class TelegramChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "telegram",
    name: "Telegram",
    envVars: ["TELEGRAM_BOT_TOKEN"],
    canReceive: true,
    canSend: true,
  }

  private bot: Bot | null = null
  private handlers: Handler[] = []
  private allowedIds: Set<string>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private runner: any = null

  constructor() {
    this.allowedIds = new Set(
      (process.env.TELEGRAM_ALLOWED_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    )
  }

  isAvailable(): boolean {
    return !!process.env.TELEGRAM_BOT_TOKEN
  }

  async init(): Promise<void> {
    if (!this.isAvailable() || this.bot) return
    this.bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!)
    await this.bot.api.getMe()
    console.log("[telegram] Bot ready")
  }

  onMessage(handler: Handler): void {
    this.handlers.push(handler)
  }

  async startListening(): Promise<void> {
    if (!this.isAvailable()) return
    await this.init()
    const bot = this.bot!

    // Sequentialize to prevent concurrent updates for the same chat
    bot.use(sequentialize((ctx: Context) => String(ctx.chat?.id ?? ctx.from?.id ?? "unknown")))

    bot.on("message", async (ctx: Context) => {
      const msg = ctx.message!
      const chatId = String(msg.chat.id)

      if (this.allowedIds.size > 0 && !this.allowedIds.has(chatId)) {
        await ctx.reply("You are not authorized to use this bot.")
        return
      }

      const text = msg.text ?? msg.caption ?? ""
      const channelMsg: ChannelMessage = {
        id: String(msg.message_id),
        channelId: "telegram",
        threadId: chatId,
        from: msg.from?.username ?? msg.from?.first_name ?? chatId,
        text,
        attachments: extractAttachments(msg),
        timestamp: msg.date * 1_000,
        raw: msg as unknown as Record<string, unknown>,
      }
      for (const h of this.handlers) {
        await h(channelMsg).catch((err) => console.error("[telegram] handler error:", err))
      }
    })

    this.runner = run(bot)
    console.log("[telegram] Polling started")
  }

  async stopListening(): Promise<void> {
    await this.runner?.stop()
    this.runner = null
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    if (!this.bot) throw new Error("Telegram: call init() first")
    const chatId = Number(to)
    if (isNaN(chatId)) throw new Error(`Invalid Telegram chat ID: ${to}`)

    // Split long messages (Telegram max is 4096 chars)
    const chunks = splitMessage(reply.text, 4_096)
    for (const chunk of chunks) {
      await this.bot.api.sendMessage(chatId, chunk, {
        parse_mode: "Markdown",
        ...(reply.threadId ? { reply_parameters: { message_id: Number(reply.threadId) } } : {}),
      })
    }
  }

  async sendPhoto(to: string, photoUrl: string, caption?: string): Promise<void> {
    if (!this.bot) throw new Error("Telegram: call init() first")
    await this.bot.api.sendPhoto(Number(to), photoUrl, { caption })
  }

  async sendDocument(to: string, fileUrl: string, caption?: string): Promise<void> {
    if (!this.bot) throw new Error("Telegram: call init() first")
    await this.bot.api.sendDocument(Number(to), fileUrl, { caption })
  }

  async sendTyping(to: string): Promise<void> {
    if (!this.bot) return
    await this.bot.api.sendChatAction(Number(to), "typing").catch(() => {/* best-effort */})
  }

  async diagnose(): Promise<ChannelDiagnostic> {
    const checks: ChannelDiagnostic["checks"] = []
    const hasToken = !!process.env.TELEGRAM_BOT_TOKEN
    checks.push({ name: "env:TELEGRAM_BOT_TOKEN", ok: hasToken, detail: hasToken ? "set" : "missing" })

    let botOk = false
    let botUsername = ""
    if (hasToken) {
      try {
        const bot = this.bot ?? new Bot(process.env.TELEGRAM_BOT_TOKEN!)
        const me = await bot.api.getMe()
        botOk = true
        botUsername = `@${me.username}`
      } catch (err) {
        botOk = false
      }
    }
    checks.push({ name: "api:getMe", ok: botOk, detail: botOk ? botUsername : "failed — check token" })

    const ok = hasToken && botOk
    return {
      channelId: "telegram",
      ok,
      summary: ok ? `Connected as ${botUsername}` : "Not configured or token invalid",
      checks,
    }
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function extractAttachments(msg: NonNullable<Context["message"]>): ChannelMessage["attachments"] {
  const attachments: NonNullable<ChannelMessage["attachments"]> = []
  if (msg.photo) {
    const largest = msg.photo[msg.photo.length - 1]
    attachments.push({ name: `photo_${largest.file_id}.jpg`, mimeType: "image/jpeg" })
  }
  if (msg.document) {
    attachments.push({
      name: msg.document.file_name ?? msg.document.file_id,
      mimeType: msg.document.mime_type,
    })
  }
  if (msg.voice) {
    attachments.push({ name: `voice_${msg.voice.file_id}.ogg`, mimeType: "audio/ogg" })
  }
  if (msg.audio) {
    attachments.push({ name: msg.audio.file_name ?? msg.audio.file_id, mimeType: msg.audio.mime_type })
  }
  return attachments.length ? attachments : undefined
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