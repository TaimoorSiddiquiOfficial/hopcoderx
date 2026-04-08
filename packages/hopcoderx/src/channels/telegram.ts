/**
 * Telegram channel for HopCoderX.
 *
 * Personal coding assistant via Telegram bot.
 * Send code snippets, get reviews, trigger CI, check deployment status.
 *
 * Setup:
 *   TELEGRAM_BOT_TOKEN=123456:ABC-xxx   (from @BotFather)
 *   TELEGRAM_ALLOWED_IDS=12345,67890    (comma-separated chat IDs allowed to use the bot)
 *   TELEGRAM_POLL_TIMEOUT=30            (long-poll timeout in seconds)
 */

import type { Channel, ChannelConfig, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

interface TgMessage {
  message_id: number
  chat: { id: number; type: string; username?: string }
  from?: { id: number; username?: string; first_name: string }
  text?: string
  document?: { file_id: string; file_name?: string; mime_type?: string }
  photo?: Array<{ file_id: string }>
  date: number
}

interface TgUpdate {
  update_id: number
  message?: TgMessage
  edited_message?: TgMessage
  callback_query?: { id: string; message?: TgMessage; data?: string }
}

export class TelegramChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "telegram",
    name: "Telegram",
    envVars: ["TELEGRAM_BOT_TOKEN"],
    canReceive: true,
    canSend: true,
  }

  private token = process.env.TELEGRAM_BOT_TOKEN ?? ""
  private allowedIds = new Set(
    (process.env.TELEGRAM_ALLOWED_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  )
  private pollTimeout = parseInt(process.env.TELEGRAM_POLL_TIMEOUT ?? "30", 10)
  private handlers: Handler[] = []
  private _polling = false
  private _offset = 0

  isAvailable(): boolean {
    return !!this.token
  }

  async init(): Promise<void> {
    if (!this.isAvailable()) return
    // Confirm bot token works
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/getMe`)
      if (!res.ok) throw new Error(`getMe failed: ${res.status}`)
    } catch (e) {
      console.warn("[telegram channel] init failed:", e)
    }
  }

  onMessage(handler: Handler): void {
    this.handlers.push(handler)
  }

  async startListening(): Promise<void> {
    if (!this.isAvailable()) return
    await this.init()
    this._polling = true
    void this.longPoll()
  }

  async stopListening(): Promise<void> {
    this._polling = false
  }

  private async longPoll(): Promise<void> {
    while (this._polling) {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this._offset}&timeout=${this.pollTimeout}`
        )
        if (!res.ok) {
          await new Promise((r) => setTimeout(r, 5000))
          continue
        }
        const data = (await res.json()) as { ok: boolean; result: TgUpdate[] }
        for (const update of data.result ?? []) {
          this._offset = update.update_id + 1
          const tgMsg = update.message ?? update.edited_message
          if (!tgMsg) continue

          const chatId = String(tgMsg.chat.id)
          if (this.allowedIds.size > 0 && !this.allowedIds.has(chatId)) {
            await this.sendRaw(tgMsg.chat.id, "❌ You are not authorized to use this bot.")
            continue
          }

          const msg: ChannelMessage = {
            id: String(update.update_id),
            channelId: "telegram",
            threadId: chatId,
            from: tgMsg.from?.username ?? tgMsg.from?.first_name ?? chatId,
            text: tgMsg.text ?? "",
            timestamp: tgMsg.date * 1000,
            raw: tgMsg,
          }
          for (const h of this.handlers) await h(msg)
        }
      } catch (e) {
        console.warn("[telegram channel] poll error:", e)
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    if (!this.isAvailable()) throw new Error("Telegram channel not configured")
    const chatId = parseInt(to, 10)
    if (isNaN(chatId)) throw new Error(`Invalid Telegram chat ID: ${to}`)
    await this.sendRaw(chatId, reply.text, reply.threadId)
  }

  private async sendRaw(chatId: number, text: string, replyToMsgId?: string): Promise<void> {
    const body: Record<string, any> = {
      chat_id: chatId,
      text: text.slice(0, 4096),
      parse_mode: "Markdown",
    }
    if (replyToMsgId) body.reply_to_message_id = parseInt(replyToMsgId, 10)
    const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`)
  }
}
