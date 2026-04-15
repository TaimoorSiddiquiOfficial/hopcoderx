/**
 * Slack Webhook Notifications
 *
 * Send notifications to Slack channels via incoming webhooks.
 * Supports rich formatting, blocks, and interactive elements.
 *
 * Usage:
 *   await sendSlackNotification({
 *     title: "Deployment Complete",
 *     message: "v1.2.3 deployed to production",
 *     type: "success"
 *   }, {
 *     type: "slack",
 *     webhook: "https://hooks.slack.com/services/xxx/yyy/zzz"
 *   })
 */

import type { NotificationManager } from "./index"
type Notification = NotificationManager.Notification
type SlackChannel = NotificationManager.SlackChannel
import { Log } from "@/util/log"

const log = Log.create({ service: "notification.slack" })

export async function sendSlackNotification(notification: Notification, channel: SlackChannel): Promise<void> {
  const { title, message, type, actions } = notification

  // Map notification type to Slack color and emoji
  const typeConfig: Record<string, { color: string; emoji: string }> = {
    info: { color: "#36a64f", emoji: ":information_source:" },
    success: { color: "#2eb886", emoji: ":white_check_mark:" },
    warning: { color: "#ffa500", emoji: ":warning:" },
    error: { color: "#ff0000", emoji: ":x:" },
  }

  const config = typeConfig[type] || typeConfig.info

  const payload: Record<string, any> = {
    text: `${config.emoji} *${title}*\n${message}`,
    attachments: [
      {
        color: config.color,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `${config.emoji} ${title}`,
              emoji: true,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: message,
            },
          },
        ],
      },
    ],
  }

  // Add actions if present
  if (actions && actions.length > 0) {
    payload.attachments[0].blocks.push({
      type: "actions",
      elements: actions.map((action: { label: string; action: string }) => ({
        type: "button",
        text: {
          type: "plain_text",
          text: action.label,
          emoji: true,
        },
        url: action.action,
        action_id: action.action,
      })),
    })
  }

  // Add metadata if present
  if (notification.metadata) {
    const fields = Object.entries(notification.metadata).map(([key, value]) => ({
      type: "mrkdwn",
      text: `*${key}:*\n${value}`,
    }))

    if (fields.length > 0) {
      payload.attachments[0].blocks.push({
        type: "section",
        fields,
      })
    }
  }

  try {
    const response = await fetch(channel.webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Slack webhook error: ${response.status} - ${errorText}`)
    }

    // Check for Slack error response
    const result = await response.json()
    if (result.ok === false) {
      throw new Error(`Slack API error: ${result.error}`)
    }

    log.info("slack notification sent", { title, message })
  } catch (error) {
    log.error("slack notification failed", { error, webhook: channel.webhook.slice(0, 30) + "..." })
    throw error
  }
}

/**
 * Send a Slack message with rich blocks formatting
 */
export async function sendSlackBlocks(
  blocks: Array<{
    type: string
    [key: string]: any
  }>,
  channel: SlackChannel,
): Promise<void> {
  const payload = {
    blocks,
  }

  try {
    const response = await fetch(channel.webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Slack webhook error: ${response.status} - ${errorText}`)
    }

    log.info("slack blocks notification sent")
  } catch (error) {
    log.error("slack blocks notification failed", { error })
    throw error
  }
}

/**
 * Send a thread reply to a Slack message
 */
export async function sendSlackThread(
  notification: Notification,
  channel: SlackChannel,
  threadTs: string,
): Promise<void> {
  const { title, message, type } = notification

  const typeConfig: Record<string, { emoji: string }> = {
    info: { emoji: ":information_source:" },
    success: { emoji: ":white_check_mark:" },
    warning: { emoji: ":warning:" },
    error: { emoji: ":x:" },
  }

  const config = typeConfig[type] || typeConfig.info

  const payload = {
    text: `${config.emoji} *${title}*\n${message}`,
    thread_ts: threadTs,
  }

  try {
    const response = await fetch(channel.webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Slack webhook error: ${response.status} - ${errorText}`)
    }

    log.info("slack thread notification sent", { threadTs })
  } catch (error) {
    log.error("slack thread notification failed", { error })
    throw error
  }
}

/**
 * Format a session summary for Slack
 */
export function formatSessionSummary(sessionID: string, stats: { tokens: number; cost: number; duration: number }) {
  const durationMin = Math.floor(stats.duration / 60000)
  const costCents = Math.round(stats.cost * 100)

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Session Summary*\nSession: \`${sessionID.slice(0, 8)}...\``,
      },
    },
    {
      type: "divider",
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Tokens*\n${stats.tokens.toLocaleString()}`,
        },
        {
          type: "mrkdwn",
          text: `*Cost*\n${costCents}¢`,
        },
        {
          type: "mrkdwn",
          text: `*Duration*\n${durationMin}m`,
        },
      ],
    },
  ] as const

  return blocks
}
