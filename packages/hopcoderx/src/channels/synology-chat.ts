/**
 * Synology Chat channel for HopCoderX.
 *
 * Uses Synology Chat's incoming webhook to send messages.
 * Receiving requires setting up an outgoing webhook on your Synology NAS.
 *
 * Setup:
 *   SYNOLOGY_CHAT_WEBHOOK_URL=https://nas.example.com/webapi/entry.cgi?api=SYNO.Chat.External&...
 *     (from Synology Chat > Integrations > Incoming Webhook)
 *   SYNOLOGY_CHAT_TOKEN=...    (outgoing webhook token, for verifying incoming requests)
 */

import type { Channel, ChannelConfig, ChannelDiagnostic, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

export class SynologyChatChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "synology-chat",
    name: "Synology Chat",
    envVars: ["SYNOLOGY_CHAT_WEBHOOK_URL"],
    canReceive: false, // Receive requires outgoing webhook server setup
    canSend: true,
  }

  private webhookUrl = process.env.SYNOLOGY_CHAT_WEBHOOK_URL ?? ""
  private handlers: Handler[] = []

  isAvailable(): boolean {
    return !!this.webhookUrl
  }

  async init(): Promise<void> {}

  onMessage(handler: Handler): void {
    this.handlers.push(handler)
  }

  /** Handle an inbound Synology Chat event (from your webhook server) */
  async handleWebhookEvent(payload: { username: string; text: string; token?: string; timestamp?: number }): Promise<void> {
    const msg: ChannelMessage = {
      id: `${payload.timestamp ?? Date.now()}`,
      channelId: "synology-chat",
      from: payload.username,
      text: payload.text,
      timestamp: payload.timestamp ?? Date.now(),
      raw: payload,
    }
    for (const h of this.handlers) await h(msg)
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    if (!this.isAvailable()) throw new Error("Synology Chat channel not configured")
    // Synology Chat uses form-encoded payload parameter
    const payload = JSON.stringify({ text: reply.text })
    const url = `${this.webhookUrl}&payload=${encodeURIComponent(payload)}`
    const res = await fetch(url, { method: "POST" })
    if (!res.ok) throw new Error(`Synology Chat send failed: ${res.status} ${await res.text()}`)
  }

  async diagnose(): Promise<ChannelDiagnostic> {
    const checks: ChannelDiagnostic["checks"] = []
    const ok = this.isAvailable()
    const missing = this.config.envVars.filter((v) => !process.env[v])
    checks.push({ name: "env vars", ok, detail: ok ? "all set" : "missing: " + missing.join(", ") })
    return { channelId: this.config.id, ok, summary: ok ? "configured" : `missing env: ${missing.join(", ")}`, checks }
  }
}
