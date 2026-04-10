/**
 * LINE messaging channel for HopCoderX.
 *
 * Supports the LINE Messaging API (send text/stickers/images + receive via webhook).
 *
 * Setup:
 *   LINE_CHANNEL_ACCESS_TOKEN=your-long-lived-access-token
 *   LINE_CHANNEL_SECRET=your-channel-secret   (for webhook signature validation)
 *
 * To receive messages:
 *   Set webhook URL in LINE Developers console to: https://your-server/webhooks/line
 *   The webhook handler should call lineChannel.handleWebhook(body, signature).
 */

import type { Channel, ChannelConfig, ChannelDiagnostic, ChannelMessage, ChannelReply } from "./channel"
import { createHmac } from "crypto"

type Handler = (msg: ChannelMessage) => Promise<void>

interface LINETextMessage {
  type: "text"
  text: string
}

interface LINEEvent {
  type: string
  replyToken?: string
  source?: { type: string; userId?: string; groupId?: string; roomId?: string }
  message?: { id: string; type: string; text?: string }
  timestamp?: number
}

export class LINEChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "line",
    name: "LINE",
    envVars: ["LINE_CHANNEL_ACCESS_TOKEN"],
    canReceive: true,
    canSend: true,
  }

  private accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? ""
  private channelSecret = process.env.LINE_CHANNEL_SECRET ?? ""
  private handlers: Handler[] = []

  isAvailable(): boolean {
    return !!this.accessToken
  }

  async init(): Promise<void> {}

  onMessage(handler: Handler): void {
    this.handlers.push(handler)
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    // `to` can be a userId, groupId, or roomId
    const messages: LINETextMessage[] = [{ type: "text", text: reply.text.slice(0, 5000) }]
    await this.api("POST", "/message/push", { to, messages })
  }

  /** Send a quick reply to a LINE event replyToken */
  async replyToToken(replyToken: string, text: string): Promise<void> {
    const messages: LINETextMessage[] = [{ type: "text", text: text.slice(0, 5000) }]
    await this.api("POST", "/message/reply", { replyToken, messages })
  }

  /** Handle an incoming LINE webhook payload (call from your webhook route) */
  async handleWebhook(body: string, signature: string): Promise<void> {
    if (this.channelSecret && !this.verifySignature(body, signature)) {
      throw new Error("LINE webhook signature verification failed")
    }

    let payload: { events?: LINEEvent[] }
    try { payload = JSON.parse(body) } catch { return }

    for (const event of payload.events ?? []) {
      if (event.type !== "message" || event.message?.type !== "text") continue
      const text = event.message.text ?? ""
      const from = event.source?.userId ?? event.source?.groupId ?? "unknown"
      const threadId = event.source?.groupId ?? event.source?.roomId ?? from

      const msg: ChannelMessage = {
        id: event.message.id,
        channelId: "line",
        threadId,
        from,
        text,
        timestamp: event.timestamp ?? Date.now(),
        raw: event,
      }

      for (const handler of this.handlers) {
        await handler(msg).catch(console.error)
      }
    }
  }

  private verifySignature(body: string, signature: string): boolean {
    const hash = createHmac("sha256", this.channelSecret).update(body).digest("base64")
    return hash === signature
  }

  private async api(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`https://api.line.me/v2/bot${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`LINE API error ${res.status}: ${await res.text()}`)
    return res.json()
  }

  async diagnose(): Promise<ChannelDiagnostic> {
    const checks: ChannelDiagnostic["checks"] = []
    const ok = this.isAvailable()
    const missing = this.config.envVars.filter((v) => !process.env[v])
    checks.push({ name: "env vars", ok, detail: ok ? "all set" : "missing: " + missing.join(", ") })
    return { channelId: this.config.id, ok, summary: ok ? "configured" : `missing env: ${missing.join(", ")}`, checks }
  }
}
