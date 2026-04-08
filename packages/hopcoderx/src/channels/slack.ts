/**
 * Slack channel for HopCoderX.
 *
 * Uses Slack Socket Mode (WebSocket) for receiving messages and
 * the Web API for sending — no public URL required.
 *
 * Setup:
 *   SLACK_BOT_TOKEN=xoxb-...        (Bot User OAuth Token)
 *   SLACK_APP_TOKEN=xapp-...        (App-Level Token with connections:write scope)
 *   SLACK_ALLOWED_CHANNELS=C123,C456  (optional comma-separated channel IDs)
 */

import type { Channel, ChannelConfig, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

interface SlackEvent {
  type: string
  channel?: string
  user?: string
  username?: string
  text?: string
  ts?: string
  thread_ts?: string
  files?: Array<{ name: string; url_private: string; mimetype: string }>
}

interface SlackEnvelope {
  envelope_id: string
  type: string
  payload?: {
    type?: string
    event?: SlackEvent
  }
  retry_attempt?: number
}

export class SlackChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "slack",
    name: "Slack",
    envVars: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"],
    canReceive: true,
    canSend: true,
  }

  private botToken = process.env.SLACK_BOT_TOKEN ?? ""
  private appToken = process.env.SLACK_APP_TOKEN ?? ""
  private allowedChannels = new Set(
    (process.env.SLACK_ALLOWED_CHANNELS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  )
  private handlers: Handler[] = []
  private ws: any = null
  private _listening = false

  isAvailable(): boolean {
    return !!this.botToken && !!this.appToken
  }

  async init(): Promise<void> {
    if (!this.isAvailable()) return
    try {
      const res = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${this.botToken}` },
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!data.ok) throw new Error(`Slack auth.test failed: ${data.error}`)
    } catch (e) {
      console.warn("[slack channel] init failed:", e)
    }
  }

  onMessage(handler: Handler): void {
    this.handlers.push(handler)
  }

  async startListening(): Promise<void> {
    if (!this.isAvailable()) return
    this._listening = true
    await this.connectSocketMode()
  }

  async stopListening(): Promise<void> {
    this._listening = false
    if (this.ws) {
      try {
        this.ws.close()
      } catch {}
      this.ws = null
    }
  }

  private async connectSocketMode(): Promise<void> {
    try {
      // Get WebSocket URL from Slack
      const res = await fetch("https://slack.com/api/apps.connections.open", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.appToken}` },
      })
      const data = (await res.json()) as { ok: boolean; url?: string; error?: string }
      if (!data.ok || !data.url) throw new Error(`Failed to open Socket Mode connection: ${data.error}`)

      // Use WebSocket via dynamic import (Node.js ws or Bun native)
      const wsUrl = data.url
      await this.openWebSocket(wsUrl)
    } catch (e) {
      console.warn("[slack channel] Socket Mode connect failed:", e)
      if (this._listening) {
        await new Promise((r) => setTimeout(r, 5000))
        if (this._listening) void this.connectSocketMode()
      }
    }
  }

  private async openWebSocket(url: string): Promise<void> {
    // Use native WebSocket (Bun / Node 22+) or fallback
    const WSClass = (globalThis as any).WebSocket as typeof WebSocket
    if (!WSClass) {
      console.warn("[slack channel] WebSocket not available in this runtime")
      return
    }

    const ws = new WSClass(url)
    this.ws = ws

    ws.onmessage = async (evt: MessageEvent) => {
      const envelope = JSON.parse(typeof evt.data === "string" ? evt.data : evt.data.toString()) as SlackEnvelope

      // Acknowledge every envelope immediately
      if (envelope.envelope_id) {
        ws.send(JSON.stringify({ envelope_id: envelope.envelope_id }))
      }

      if (envelope.type !== "events_api") return
      const event = envelope.payload?.event
      if (!event || event.type !== "message") return
      if (!event.channel || !event.user || !event.text) return
      if (this.allowedChannels.size > 0 && !this.allowedChannels.has(event.channel)) return

      const msg: ChannelMessage = {
        id: event.ts ?? Date.now().toString(),
        channelId: "slack",
        threadId: event.thread_ts ?? event.channel,
        from: event.user,
        text: event.text,
        timestamp: event.ts ? parseFloat(event.ts) * 1000 : Date.now(),
        raw: event,
      }
      for (const h of this.handlers) await h(msg)
    }

    ws.onclose = async () => {
      this.ws = null
      if (this._listening) {
        await new Promise((r) => setTimeout(r, 3000))
        if (this._listening) void this.connectSocketMode()
      }
    }

    ws.onerror = (err: Event) => {
      console.warn("[slack channel] WebSocket error:", err)
    }
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    if (!this.isAvailable()) throw new Error("Slack channel not configured")

    const body: Record<string, any> = {
      channel: to,
      text: reply.text,
    }
    if (reply.threadId && reply.threadId !== to) {
      body.thread_ts = reply.threadId
    }

    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as { ok: boolean; error?: string }
    if (!data.ok) throw new Error(`Slack chat.postMessage failed: ${data.error}`)
  }
}
