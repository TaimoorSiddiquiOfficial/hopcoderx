/**
 * WhatsApp channel for HopCoderX via Twilio API.
 *
 * Send and receive WhatsApp messages using Twilio's WhatsApp sandbox
 * or production number.
 *
 * Setup:
 *   TWILIO_ACCOUNT_SID=ACxxx
 *   TWILIO_AUTH_TOKEN=xxx
 *   TWILIO_WHATSAPP_FROM=whatsapp:+14155238886  (Twilio sandbox or production)
 *   TWILIO_WHATSAPP_TO=whatsapp:+1xxxxxxxxxx    (your number for notifications)
 *
 * Inbound messages require a Twilio webhook pointed at your server.
 * Use `hopcoderx webhooks create --channel whatsapp` to set one up.
 */

import type { Channel, ChannelConfig, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

// ─── Twilio REST API helpers ──────────────────────────────────────────────────

async function twilioRequest(
  accountSid: string,
  authToken: string,
  endpoint: string,
  body: Record<string, string>,
): Promise<any> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/${endpoint}`
  const encoded = new URLSearchParams(body).toString()
  const credentials = btoa(`${accountSid}:${authToken}`)
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encoded,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twilio API error ${res.status}: ${text}`)
  }
  return res.json()
}

// ─── WhatsAppChannel ─────────────────────────────────────────────────────────

export class WhatsAppChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "whatsapp",
    name: "WhatsApp (Twilio)",
    envVars: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM"],
    canReceive: true,
    canSend: true,
  }

  private handler: Handler | null = null

  isAvailable(): boolean {
    return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM)
  }

  async init(): Promise<void> {
    if (!this.isAvailable()) return
    console.log("[whatsapp] Ready (configure Twilio webhook for inbound)")
  }

  onMessage(handler: Handler): void {
    this.handler = handler
  }

  /** Handle an inbound Twilio webhook payload (call from your HTTP server) */
  handleInbound(payload: Record<string, string>): void {
    if (!this.handler) return
    const from = payload.From ?? "unknown"
    const body = payload.Body ?? ""
    const msgId = payload.MessageSid ?? `wa-${Date.now()}`
    this.handler({
      id: msgId,
      channelId: "whatsapp",
      from: from.replace("whatsapp:", ""),
      text: body,
      timestamp: Date.now(),
      raw: payload,
    }).catch((err) => console.error("[whatsapp] handler error:", err))
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    const sid = process.env.TWILIO_ACCOUNT_SID
    const token = process.env.TWILIO_AUTH_TOKEN
    const from = process.env.TWILIO_WHATSAPP_FROM
    if (!sid || !token || !from) throw new Error("WhatsApp: missing Twilio env vars")

    const recipient = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`
    const chunks = splitMessage(reply.text, 4096)
    for (const chunk of chunks) {
      await twilioRequest(sid, token, "Messages.json", { From: from, To: recipient, Body: chunk })
    }
  }

  async sendMedia(to: string, mediaUrl: string, caption?: string): Promise<void> {
    const sid = process.env.TWILIO_ACCOUNT_SID
    const token = process.env.TWILIO_AUTH_TOKEN
    const from = process.env.TWILIO_WHATSAPP_FROM
    if (!sid || !token || !from) throw new Error("WhatsApp: missing Twilio env vars")
    const recipient = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`
    await twilioRequest(sid, token, "Messages.json", {
      From: from,
      To: recipient,
      MediaUrl: mediaUrl,
      ...(caption ? { Body: caption } : {}),
    })
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
