/**
 * Nextcloud Talk channel for HopCoderX.
 *
 * Uses the Nextcloud Talk API (spreed) to send and receive messages.
 * Polls for new messages via the OCS API.
 *
 * Setup:
 *   NEXTCLOUD_URL=https://cloud.example.com        (Nextcloud base URL)
 *   NEXTCLOUD_USER=botuser                          (bot username)
 *   NEXTCLOUD_PASSWORD=apppassword                  (app password, not login password)
 *   NEXTCLOUD_TALK_ROOM=abc1defg                    (room token from Talk URL)
 */

import type { Channel, ChannelConfig, ChannelDiagnostic, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

interface NcMessage {
  id: number
  actorId: string
  actorDisplayName: string
  message: string
  timestamp: number
  systemMessage?: string
}

export class NextcloudTalkChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "nextcloud-talk",
    name: "Nextcloud Talk",
    envVars: ["NEXTCLOUD_URL", "NEXTCLOUD_USER", "NEXTCLOUD_PASSWORD", "NEXTCLOUD_TALK_ROOM"],
    canReceive: true,
    canSend: true,
  }

  private baseUrl = (process.env.NEXTCLOUD_URL ?? "").replace(/\/$/, "")
  private user = process.env.NEXTCLOUD_USER ?? ""
  private pass = process.env.NEXTCLOUD_PASSWORD ?? ""
  private room = process.env.NEXTCLOUD_TALK_ROOM ?? ""
  private handlers: Handler[] = []
  private _polling = false
  private _lastMsgId = 0

  isAvailable(): boolean {
    return !!this.baseUrl && !!this.user && !!this.pass && !!this.room
  }

  async init(): Promise<void> {
    if (!this.isAvailable()) return
    try {
      const res = await this.apiGet(`/ocs/v2.php/apps/spreed/api/v4/room/${this.room}`)
      if (!res.ok) throw new Error(`room fetch failed: ${res.status}`)
    } catch (e) {
      console.warn("[nextcloud-talk channel] init failed:", e)
    }
  }

  onMessage(handler: Handler): void {
    this.handlers.push(handler)
  }

  async startListening(): Promise<void> {
    if (!this.isAvailable()) return
    await this.init()
    this._polling = true
    void this.poll()
  }

  async stopListening(): Promise<void> {
    this._polling = false
  }

  private async poll(): Promise<void> {
    while (this._polling) {
      try {
        const url = `/ocs/v2.php/apps/spreed/api/v1/chat/${this.room}?lookIntoFuture=1&timeout=30&lastKnownMessageId=${this._lastMsgId}&setReadMarker=0`
        const res = await this.apiGet(url)
        if (!res.ok) {
          await new Promise((r) => setTimeout(r, 5000))
          continue
        }
        const data = (await res.json()) as { ocs: { data: NcMessage[] } }
        for (const ncMsg of data.ocs?.data ?? []) {
          if (ncMsg.systemMessage) continue
          if (ncMsg.id > this._lastMsgId) this._lastMsgId = ncMsg.id
          const msg: ChannelMessage = {
            id: String(ncMsg.id),
            channelId: "nextcloud-talk",
            threadId: this.room,
            from: ncMsg.actorDisplayName || ncMsg.actorId,
            text: ncMsg.message,
            timestamp: ncMsg.timestamp * 1000,
            raw: ncMsg,
          }
          for (const h of this.handlers) await h(msg)
        }
      } catch (e) {
        console.warn("[nextcloud-talk channel] poll error:", e)
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
  }

  async send(_to: string, reply: ChannelReply): Promise<void> {
    if (!this.isAvailable()) throw new Error("Nextcloud Talk channel not configured")
    const res = await fetch(`${this.baseUrl}/ocs/v2.php/apps/spreed/api/v1/chat/${this.room}`, {
      method: "POST",
      headers: {
        ...this.authHeader(),
        "Content-Type": "application/json",
        "OCS-APIRequest": "true",
      },
      body: JSON.stringify({ message: reply.text }),
    })
    if (!res.ok) throw new Error(`Nextcloud Talk send failed: ${res.status} ${await res.text()}`)
  }

  private apiGet(path: string) {
    return fetch(`${this.baseUrl}${path}`, {
      headers: { ...this.authHeader(), "OCS-APIRequest": "true", Accept: "application/json" },
    })
  }

  private authHeader() {
    const cred = Buffer.from(`${this.user}:${this.pass}`).toString("base64")
    return { Authorization: `Basic ${cred}` }
  }

  async diagnose(): Promise<ChannelDiagnostic> {
    const checks: ChannelDiagnostic["checks"] = []
    const ok = this.isAvailable()
    const missing = this.config.envVars.filter((v) => !process.env[v])
    checks.push({ name: "env vars", ok, detail: ok ? "all set" : "missing: " + missing.join(", ") })
    return { channelId: this.config.id, ok, summary: ok ? "configured" : `missing env: ${missing.join(", ")}`, checks }
  }
}
