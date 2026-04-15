/**
 * ntfy.sh Push Notifications
 *
 * Send push notifications via ntfy.sh - a simple HTTP-based pub-sub service.
 * Supports priority, tags, actions, and attachments.
 *
 * Usage:
 *   await sendNtfyNotification({
 *     title: "Build Complete",
 *     message: "CI pipeline passed",
 *     type: "success"
 *   }, {
 *     type: "ntfy",
 *     topic: "my-hopcoderx-alerts"
 *   })
 */

import type { Notification, NtfyChannel } from "./index"
import { Log } from "@/util/log"

const log = Log.create({ service: "notification.ntfy" })

export async function sendNtfyNotification(notification: Notification, channel: NtfyChannel): Promise<void> {
  const { title, message, type, tags, timeout } = notification

  // Map notification type to ntfy priority
  const priorityMap: Record<string, number> = {
    info: 3,
    success: 3,
    warning: 4,
    error: 5,
  }

  // Map notification type to ntfy tags
  const typeTags: Record<string, string[]> = {
    info: ["information"],
    success: ["white_check_mark", "tada"],
    warning: ["warning", "exclamation"],
    error: ["x", "no_entry", "rotating_light"],
  }

  const allTags = [...(typeTags[type] || []), ...(tags || [])]

  const payload: Record<string, string | number | string[]> = {
    topic: channel.topic,
    title,
    message,
    priority: priorityMap[type] || 3,
    tags: allTags,
  }

  if (timeout) {
    payload.click = timeout.toString()
  }

  // Add actions if present
  if (notification.actions && notification.actions.length > 0) {
    const actions = notification.actions.map((a) => ({
      action: "view",
      label: a.label,
      url: a.action,
    }))
    payload.actions = JSON.stringify(actions)
  }

  // Send to ntfy.sh
  const url = `${channel.url}/${channel.topic}`

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Priority": payload.priority.toString(),
        "X-Tags": allTags.join(","),
        "X-Title": title,
      },
      body: JSON.stringify({
        title,
        message,
        tags: allTags,
        actions: notification.actions?.map((a) => ({
          action: "view",
          label: a.label,
          url: a.action,
        })),
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`ntfy error: ${response.status} - ${errorText}`)
    }

    log.info("ntfy notification sent", { topic: channel.topic, title, message })
  } catch (error) {
    log.error("ntfy notification failed", { error, topic: channel.topic })
    throw error
  }
}

/**
 * Send ntfy notification with attachment (image, file, etc.)
 */
export async function sendNtfyWithAttachment(
  notification: Notification & { attachmentUrl: string; attachmentType?: string },
  channel: NtfyChannel,
): Promise<void> {
  const { title, message, type, attachmentUrl, attachmentType } = notification

  const priorityMap: Record<string, number> = {
    info: 3,
    success: 3,
    warning: 4,
    error: 5,
  }

  const url = `${channel.url}/${channel.topic}`

  try {
    // First send the message with attachment URL
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Priority": priorityMap[type] || 3,
        "X-Title": title,
        "X-Attach": attachmentUrl,
        "X-Filename": attachmentType || "attachment",
      },
      body: JSON.stringify({
        title,
        message,
        attach: attachmentUrl,
        filename: attachmentType || "attachment",
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`ntfy error: ${response.status} - ${errorText}`)
    }

    log.info("ntfy notification with attachment sent", { topic: channel.topic, attachmentUrl })
  } catch (error) {
    log.error("ntfy notification with attachment failed", { error, topic: channel.topic })
    throw error
  }
}

/**
 * Create a ntfy topic for a specific session
 */
export function getSessionTopic(sessionID: string): string {
  return `hopcoderx-session-${sessionID.slice(0, 8)}`
}

/**
 * Create a ntfy topic for a specific user/project
 */
export function getUserTopic(userID: string, projectSlug?: string): string {
  if (projectSlug) {
    return `hopcoderx-${userID}-${projectSlug}`
  }
  return `hopcoderx-${userID}`
}
