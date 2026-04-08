/**
 * Microsoft Teams channel for HopCoderX.
 *
 * Sends rich Adaptive Cards to Teams via incoming webhook.
 * Optionally receives messages via Azure Bot Service relay.
 *
 * Setup:
 *   TEAMS_WEBHOOK_URL=https://xxx.webhook.office.com/...
 *   TEAMS_BOT_APP_ID=xxx           (optional — for bot relay mode)
 *   TEAMS_BOT_APP_PASSWORD=xxx     (optional)
 */

import type { Channel, ChannelConfig, ChannelMessage, ChannelReply } from "./channel"

type Handler = (msg: ChannelMessage) => Promise<void>

interface AdaptiveCardBody {
  type: string
  text?: string
  wrap?: boolean
  weight?: string
  color?: string
  isSubtle?: boolean
  id?: string
  items?: AdaptiveCardBody[]
}

interface AdaptiveCard {
  type: "AdaptiveCard"
  version: string
  body: AdaptiveCardBody[]
  actions?: {
    type: string
    title: string
    url?: string
    data?: Record<string, string>
  }[]
  $schema: string
}

// ─── Adaptive Card builder ────────────────────────────────────────────────────

function buildCard(title: string, body: string, codeBlock?: string): AdaptiveCard {
  const bodyItems: AdaptiveCardBody[] = [
    { type: "TextBlock", text: title, weight: "bolder", wrap: true },
    { type: "TextBlock", text: body, wrap: true },
  ]
  if (codeBlock) {
    bodyItems.push({ type: "TextBlock", text: `\`\`\`\n${codeBlock.slice(0, 2000)}\n\`\`\``, wrap: true })
  }
  return {
    type: "AdaptiveCard",
    version: "1.4",
    body: bodyItems,
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
  }
}

function buildMessagePayload(content: string): object {
  const codeMatch = content.match(/```(?:\w+)?\n([\s\S]+?)```/)
  const codeBlock = codeMatch ? codeMatch[1] : undefined
  const textContent = content.replace(/```(?:\w+)?\n[\s\S]+?```/g, "[code block]").trim()
  const card = buildCard("🤖 HopCoderX", textContent, codeBlock)
  return {
    type: "message",
    attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content: card }],
  }
}

// ─── TeamsChannel ─────────────────────────────────────────────────────────────

export class TeamsChannel implements Channel {
  readonly config: ChannelConfig = {
    id: "teams",
    name: "Microsoft Teams",
    envVars: ["TEAMS_WEBHOOK_URL"],
    canReceive: false,
    canSend: true,
  }

  private handler: Handler | null = null

  isAvailable(): boolean {
    return !!process.env.TEAMS_WEBHOOK_URL
  }

  async init(): Promise<void> {
    if (!this.isAvailable()) return
    console.log("[teams] Ready (outbound webhook mode)")
  }

  onMessage(handler: Handler): void {
    this.handler = handler
  }

  async send(to: string, reply: ChannelReply): Promise<void> {
    const webhookUrl = to || process.env.TEAMS_WEBHOOK_URL
    if (!webhookUrl) throw new Error("Teams: no webhook URL (pass as `to` or set TEAMS_WEBHOOK_URL)")
    const payload = buildMessagePayload(reply.text)
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Teams webhook error ${res.status}: ${body}`)
    }
  }

  /** Send a rich notification card */
  async notify(webhookUrl: string, title: string, message: string, linkUrl?: string): Promise<void> {
    const card: AdaptiveCard = {
      type: "AdaptiveCard",
      version: "1.4",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      body: [
        { type: "TextBlock", text: `**${title}**`, weight: "bolder", wrap: true },
        { type: "TextBlock", text: message, wrap: true },
      ],
      actions: linkUrl ? [{ type: "Action.OpenUrl", title: "View", url: linkUrl }] : undefined,
    }
    const payload = {
      type: "message",
      attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content: card }],
    }
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  }
}
