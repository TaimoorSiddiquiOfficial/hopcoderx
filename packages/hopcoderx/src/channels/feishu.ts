/**
 * Feishu (Lark) channel for HopCoderX.
 *
 * Supports Feishu bots using the Feishu Open Platform API.
 * Receives events via long-polling and sends via Feishu Messaging API.
 *
 * Setup:
 *   FEISHU_APP_ID=cli_...           (App ID from Feishu Developer Console)
 *   FEISHU_APP_SECRET=...           (App Secret)
 *   FEISHU_ALLOWED_USERS=ou_...,ou_... (optional comma-separated open_id list)
 */

import type { Channel, ChannelConfig, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

interface FeishuTokenResp {
  code: number
  msg: string
  tenant_access_token?: string
  expire?: number
}

interface FeishuEventMsg {
  message_id: string
  chat_id: string
  sender: { sender_id: { open_id: string }; sender_type: string }
  message: { message_type: string; content: string }
  event_id: string
  create_time: string
}

export class FeishuChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "feishu",
    name: "Feishu / Lark",
    envVars: ["FEISHU_APP_ID", "FEISHU_APP_SECRET"],
    canReceive: false, // Feishu uses webhook push — receive requires server setup
    canSend: true,
  }

  private appId = process.env.FEISHU_APP_ID ?? ""
  private appSecret = process.env.FEISHU_APP_SECRET ?? ""
  private handlers: Handler[] = []
  private tokenCache: { token: string; expiresAt: number } | null = null

  isAvailable(): boolean {
    return !!this.appId && !!this.appSecret
  }

  async init(): Promise<void> {
    if (!this.isAvailable()) return
    try {
      await this.getAccessToken()
    } catch (e) {
      console.warn("[feishu channel] init failed:", e)
    }
  }

  onMessage(handler: Handler): void {
    this.handlers.push(handler)
  }

  /** Feishu event dispatch — call from your webhook handler */
  async handleWebhookEvent(event: FeishuEventMsg): Promise<void> {
    const msg: ChannelMessage = {
      id: event.message_id,
      channelId: "feishu",
      threadId: event.chat_id,
      from: event.sender.sender_id.open_id,
      text: (() => {
        try {
          return JSON.parse(event.message.content).text ?? ""
        } catch {
          return event.message.content
        }
      })(),
      timestamp: parseInt(event.create_time, 10) || Date.now(),
      raw: event,
    }
    for (const h of this.handlers) await h(msg)
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    if (!this.isAvailable()) throw new Error("Feishu channel not configured")
    const token = await this.getAccessToken()
    const res = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        receive_id: to,
        msg_type: "text",
        content: JSON.stringify({ text: reply.text }),
      }),
    })
    const data = (await res.json()) as { code: number; msg: string }
    if (data.code !== 0) throw new Error(`Feishu send failed: ${data.msg}`)
  }

  private async getAccessToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.token
    }
    const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
    })
    const data = (await res.json()) as FeishuTokenResp
    if (data.code !== 0 || !data.tenant_access_token) throw new Error(`Feishu auth failed: ${data.msg}`)
    this.tokenCache = {
      token: data.tenant_access_token,
      expiresAt: Date.now() + (data.expire ?? 7200) * 1000 - 60_000,
    }
    return this.tokenCache.token
  }
}
