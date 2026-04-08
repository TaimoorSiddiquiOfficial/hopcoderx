/**
 * Matrix channel for HopCoderX.
 *
 * Developer-friendly E2E-encrypted messaging via Matrix protocol.
 * Connects to any Matrix homeserver (Element, matrix.org, self-hosted).
 *
 * Setup:
 *   MATRIX_HOMESERVER_URL=https://matrix.org
 *   MATRIX_ACCESS_TOKEN=syt_xxx
 *   MATRIX_USER_ID=@hopcoderx:matrix.org
 *   MATRIX_ROOM_IDS=!room1:matrix.org,!room2:matrix.org  (rooms to listen in)
 */

import type { Channel, ChannelConfig, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

interface MatrixEvent {
  event_id: string
  room_id: string
  type: string
  content: { msgtype?: string; body?: string }
  sender: string
  origin_server_ts: number
}

interface SyncResponse {
  next_batch: string
  rooms?: {
    join?: Record<string, { timeline?: { events?: MatrixEvent[] } }>
  }
}

export class MatrixChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "matrix",
    name: "Matrix",
    envVars: ["MATRIX_ACCESS_TOKEN"],
    canReceive: true,
    canSend: true,
  }

  private handler: Handler | null = null
  private syncToken: string | null = null
  private running = false
  private abortController: AbortController | null = null
  private seenEvents = new Set<string>()

  private get homeserver(): string {
    return (process.env.MATRIX_HOMESERVER_URL ?? "https://matrix.org").replace(/\/$/, "")
  }

  private get roomIds(): string[] {
    const env = process.env.MATRIX_ROOM_IDS ?? ""
    return env ? env.split(",").map((r) => r.trim()).filter(Boolean) : []
  }

  isAvailable(): boolean {
    return !!process.env.MATRIX_ACCESS_TOKEN
  }

  async init(): Promise<void> {
    if (!this.isAvailable()) return
    console.log(`[matrix] Ready (${this.homeserver})`)
  }

  onMessage(handler: Handler): void {
    this.handler = handler
  }

  async startListening(): Promise<void> {
    if (!this.isAvailable()) throw new Error("Matrix: MATRIX_ACCESS_TOKEN not configured")
    this.running = true
    this.abortController = new AbortController()
    await this.doSync(true)
    this.poll()
  }

  async stopListening(): Promise<void> {
    this.running = false
    this.abortController?.abort()
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    if (!to) throw new Error("Matrix: room ID required as `to`")
    const txnId = `hop-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const content = { msgtype: "m.text", body: reply.text }
    await this.matrixPut(`/rooms/${encodeURIComponent(to)}/send/m.room.message/${txnId}`, content)
  }

  private async matrixRequest(method: string, path: string, body?: unknown): Promise<any> {
    const url = `${this.homeserver}/_matrix/client/v3${path}`
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.MATRIX_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: this.abortController?.signal,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Matrix API error ${res.status}: ${text}`)
    }
    return res.json()
  }

  private async matrixPut(path: string, body: unknown): Promise<any> {
    return this.matrixRequest("PUT", path, body)
  }

  private async doSync(initial = false): Promise<void> {
    const token = process.env.MATRIX_ACCESS_TOKEN ?? ""
    const params = new URLSearchParams({ access_token: token, timeout: initial ? "0" : "30000" })
    if (this.syncToken) params.set("since", this.syncToken)
    if (initial) params.set("filter", JSON.stringify({ room: { timeline: { limit: 0 } } }))

    const url = `${this.homeserver}/_matrix/client/v3/sync?${params}`
    const res = await fetch(url, { signal: this.abortController?.signal })
    if (!res.ok) throw new Error(`Matrix sync error ${res.status}`)
    const data: SyncResponse = await res.json()
    this.syncToken = data.next_batch

    if (!initial && data.rooms?.join) {
      const myId = process.env.MATRIX_USER_ID
      for (const [roomId, roomData] of Object.entries(data.rooms.join)) {
        if (this.roomIds.length > 0 && !this.roomIds.includes(roomId)) continue
        for (const event of roomData.timeline?.events ?? []) {
          if (event.type !== "m.room.message" || event.sender === myId) continue
          if (this.seenEvents.has(event.event_id)) continue
          this.seenEvents.add(event.event_id)
          if (this.seenEvents.size > 10_000) {
            const first = this.seenEvents.values().next().value
            if (first) this.seenEvents.delete(first)
          }
          const body = event.content.body ?? ""
          if (!body.trim()) continue
          this.handler?.({
            id: event.event_id,
            channelId: "matrix",
            from: event.sender,
            text: body,
            timestamp: event.origin_server_ts,
            raw: event as unknown as Record<string, any>,
          }).catch((err) => console.error("[matrix] handler error:", err))
        }
      }
    }
  }

  private poll(): void {
    const loop = async () => {
      while (this.running) {
        try {
          await this.doSync()
        } catch (err: any) {
          if (err?.name === "AbortError") break
          console.error("[matrix] sync error:", err.message)
          await new Promise((r) => setTimeout(r, 5_000))
        }
      }
    }
    loop()
  }
}
