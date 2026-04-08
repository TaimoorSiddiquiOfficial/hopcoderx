/**
 * Mattermost channel for HopCoderX.
 *
 * Full Mattermost integration via REST API + WebSocket events.
 *
 * Setup:
 *   MATTERMOST_URL=https://your.mattermost.com   (server URL)
 *   MATTERMOST_TOKEN=your-bot-token              (Personal Access Token or Bot Token)
 *   MATTERMOST_TEAM=team-name-or-id              (team name/ID)
 *   MATTERMOST_CHANNELS=channel1,channel2        (channel names to listen in)
 *   MATTERMOST_PREFIX=!hop                       (command prefix)
 */

import type { Channel, ChannelConfig, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

interface MMPost {
  id: string
  channel_id: string
  root_id?: string
  user_id: string
  message: string
  create_at: number
}

interface MMUser {
  id: string
  username: string
}

export class MattermostChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "mattermost",
    name: "Mattermost",
    envVars: ["MATTERMOST_URL", "MATTERMOST_TOKEN"],
    canReceive: true,
    canSend: true,
  }

  private baseUrl = (process.env.MATTERMOST_URL ?? "").replace(/\/$/, "")
  private token = process.env.MATTERMOST_TOKEN ?? ""
  private teamName = process.env.MATTERMOST_TEAM ?? ""
  private channelNames = (process.env.MATTERMOST_CHANNELS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean)
  private prefix = process.env.MATTERMOST_PREFIX ?? "!hop"
  private handlers: Handler[] = []
  private ws: WebSocket | null = null
  private botUserId?: string
  private channelIds = new Map<string, string>() // name → id

  isAvailable(): boolean {
    return !!(this.baseUrl && this.token)
  }

  async init(): Promise<void> {
    if (!this.isAvailable()) return
    // Fetch bot user ID
    const me = await this.api<MMUser>("GET", "/users/me")
    this.botUserId = me.id

    // Resolve channel names to IDs
    if (this.teamName) {
      for (const name of this.channelNames) {
        try {
          const ch = await this.api<{ id: string }>("GET", `/teams/name/${this.teamName}/channels/name/${name}`)
          this.channelIds.set(name, ch.id)
        } catch {
          // Channel not found, skip
        }
      }
    }
  }

  onMessage(handler: Handler): void {
    this.handlers.push(handler)
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    // `to` can be a channel name, channel ID, or user ID
    const channelId = this.channelIds.get(to) ?? to
    await this.api("POST", "/posts", {
      channel_id: channelId,
      message: reply.text,
      root_id: reply.threadId ?? "",
    })
  }

  async startListening(): Promise<void> {
    await this.init()
    const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/api/v4/websocket"
    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      this.ws?.send(JSON.stringify({
        seq: 1,
        action: "authentication_challenge",
        data: { token: this.token },
      }))
    }

    this.ws.onmessage = async (event: MessageEvent) => {
      let data: any
      try { data = JSON.parse(event.data) } catch { return }
      if (data.event !== "posted") return

      const postData = JSON.parse(data.data?.post ?? "{}")
      if (!postData?.message) return
      if (postData.user_id === this.botUserId) return

      const text = postData.message as string
      const hasPrefix = text.startsWith(this.prefix)
      if (!hasPrefix && this.channelNames.length > 0) return

      const cleanText = hasPrefix ? text.slice(this.prefix.length).trim() : text
      const channelId = postData.channel_id ?? ""

      const msg: ChannelMessage = {
        id: postData.id ?? String(Date.now()),
        channelId: "mattermost",
        threadId: postData.root_id || channelId,
        from: postData.user_id ?? "unknown",
        text: cleanText,
        timestamp: postData.create_at ?? Date.now(),
        raw: data,
      }

      for (const handler of this.handlers) {
        await handler(msg).catch(console.error)
      }
    }
  }

  async stopListening(): Promise<void> {
    this.ws?.close()
    this.ws = null
  }

  private async api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/v4${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`Mattermost API error ${res.status}: ${await res.text()}`)
    return res.json() as Promise<T>
  }
}
