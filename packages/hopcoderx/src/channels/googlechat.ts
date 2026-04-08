/**
 * Google Chat channel for HopCoderX.
 *
 * Uses Google Chat Bot (incoming webhook for sending; webhook push for receiving).
 * For receiving, the bot must be set up in Google Cloud with a server endpoint.
 * For sending only, just set the webhook URL.
 *
 * Setup:
 *   GOOGLECHAT_WEBHOOK_URL=https://chat.googleapis.com/v1/spaces/.../messages?key=...
 *     (from Google Chat > Manage Webhooks)
 *   GOOGLECHAT_BOT_TOKEN=...   (optional, for bot API receive)
 */

import type { Channel, ChannelConfig, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

interface GoogleChatCard {
  header?: { title: string; subtitle?: string }
  sections?: Array<{ widgets: Array<Record<string, any>> }>
}

interface GoogleChatMessage {
  name?: string
  text?: string
  sender?: { name: string; displayName: string; email?: string }
  createTime?: string
  space?: { name: string; type: string }
  argumentText?: string
}

export class GoogleChatChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "googlechat",
    name: "Google Chat",
    envVars: ["GOOGLECHAT_WEBHOOK_URL"],
    canReceive: false, // Receive requires webhook server endpoint
    canSend: true,
  }

  private webhookUrl = process.env.GOOGLECHAT_WEBHOOK_URL ?? ""
  private handlers: Handler[] = []

  isAvailable(): boolean {
    return !!this.webhookUrl
  }

  async init(): Promise<void> {
    // Nothing to init for webhook-only mode
  }

  onMessage(handler: Handler): void {
    this.handlers.push(handler)
  }

  /** Handle an inbound Google Chat event (from your webhook server) */
  async handleWebhookEvent(event: GoogleChatMessage): Promise<void> {
    if (!event.text && !event.argumentText) return
    const msg: ChannelMessage = {
      id: event.name ?? Date.now().toString(),
      channelId: "googlechat",
      threadId: event.space?.name,
      from: event.sender?.displayName ?? event.sender?.name ?? "unknown",
      text: event.argumentText ?? event.text ?? "",
      timestamp: event.createTime ? new Date(event.createTime).getTime() : Date.now(),
      raw: event,
    }
    for (const h of this.handlers) await h(msg)
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    if (!this.isAvailable()) throw new Error("Google Chat channel not configured")
    // `to` is either ignored (uses webhook) or a space name for Bot API
    const url = to.startsWith("spaces/")
      ? `https://chat.googleapis.com/v1/${to}/messages`
      : this.webhookUrl

    const body: Record<string, any> = { text: reply.text }
    if (reply.threadId) {
      body.thread = { name: reply.threadId }
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Google Chat send failed: ${res.status} ${await res.text()}`)
  }
}
