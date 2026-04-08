/**
 * Signal messaging channel for HopCoderX.
 *
 * Sends/receives messages via Signal using one of:
 *   1. signal-cli REST API (self-hosted): https://github.com/bbernhard/signal-cli-rest-api
 *   2. CallMeBot API (send only, no receive): https://www.callmebot.com/blog/free-api-signal-send-messages/
 *
 * Setup (option 1 — signal-cli REST, recommended):
 *   SIGNAL_CLI_URL=http://localhost:8080   (signal-cli REST server)
 *   SIGNAL_SENDER=+1234567890             (your registered number)
 *
 * Setup (option 2 — CallMeBot, send-only):
 *   CALLMEBOT_PHONE=+1234567890
 *   CALLMEBOT_API_KEY=your-key
 */

import type { Channel, ChannelConfig, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

export class SignalChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "signal",
    name: "Signal",
    envVars: ["SIGNAL_CLI_URL", "SIGNAL_SENDER"],
    canReceive: true,
    canSend: true,
  }

  private cliUrl = process.env.SIGNAL_CLI_URL ?? ""
  private sender = process.env.SIGNAL_SENDER ?? ""
  private callmebotPhone = process.env.CALLMEBOT_PHONE ?? ""
  private callmebotKey = process.env.CALLMEBOT_API_KEY ?? ""
  private handlers: Handler[] = []
  private pollTimer?: ReturnType<typeof setInterval>
  private lastTimestamp = Date.now()

  isAvailable(): boolean {
    return !!(this.cliUrl && this.sender) || !!(this.callmebotPhone && this.callmebotKey)
  }

  async init(): Promise<void> {}

  onMessage(handler: Handler): void {
    this.handlers.push(handler)
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    if (this.cliUrl && this.sender) {
      await this.sendViaCLI(to, reply.text)
    } else if (this.callmebotPhone && this.callmebotKey) {
      await this.sendViaCallMeBot(to || this.callmebotPhone, reply.text)
    } else {
      throw new Error("Signal not configured. Set SIGNAL_CLI_URL+SIGNAL_SENDER or CALLMEBOT_PHONE+CALLMEBOT_API_KEY.")
    }
  }

  private async sendViaCLI(recipient: string, text: string): Promise<void> {
    const res = await fetch(`${this.cliUrl}/v2/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, number: this.sender, recipients: [recipient] }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`Signal CLI error ${res.status}: ${await res.text()}`)
  }

  private async sendViaCallMeBot(phone: string, text: string): Promise<void> {
    const params = new URLSearchParams({ phone, text, apikey: this.callmebotKey })
    const res = await fetch(`https://api.callmebot.com/signal/send.php?${params}`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`CallMeBot error ${res.status}: ${await res.text()}`)
  }

  async startListening(): Promise<void> {
    if (!this.cliUrl) return // CallMeBot is send-only
    this.pollTimer = setInterval(() => this.pollMessages(), 5_000)
  }

  async stopListening(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer)
  }

  private async pollMessages(): Promise<void> {
    try {
      const res = await fetch(`${this.cliUrl}/v1/receive/${encodeURIComponent(this.sender)}`, {
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return
      const data = await res.json() as Array<{
        envelope?: {
          sourceNumber?: string
          dataMessage?: { message?: string; timestamp?: number }
        }
      }>
      if (!Array.isArray(data)) return

      for (const item of data) {
        const env = item.envelope
        if (!env?.dataMessage?.message) continue
        const ts = env.dataMessage.timestamp ?? Date.now()
        if (ts <= this.lastTimestamp) continue
        this.lastTimestamp = ts

        const msg: ChannelMessage = {
          id: String(ts),
          channelId: "signal",
          from: env.sourceNumber ?? "unknown",
          text: env.dataMessage.message,
          timestamp: ts,
        }
        for (const handler of this.handlers) {
          await handler(msg).catch(console.error)
        }
      }
    } catch {
      // Ignore network errors during polling
    }
  }
}
