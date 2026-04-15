/**
 * HopCoderX Notification System
 *
 * Unified notification delivery across multiple channels:
 * - OS native notifications (Windows/macOS/Linux)
 * - ntfy.sh push notifications
 * - Slack webhooks
 * - TTS voice notifications
 *
 * Usage:
 *   await NotificationManager.send({
 *     title: "Build Complete",
 *     message: "Your code compiled successfully",
 *     type: "success",
 *     channels: [{ type: "os" }]
 *   })
 */

import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { fn } from "@/util/fn"
import z from "zod"
import { Config } from "@/config/config"

const log = Log.create({ service: "notification" })

export namespace NotificationManager {
  export const NotificationType = z.enum(["info", "success", "warning", "error"])
  export type NotificationType = z.infer<typeof NotificationType>

  export const OSChannel = z
    .object({
      type: z.literal("os"),
      platform: z.enum(["windows", "macos", "linux"]).optional(),
    })
    .meta({ ref: "OSChannel" })
  export type OSChannel = z.infer<typeof OSChannel>

  export const NtfyChannel = z
    .object({
      type: z.literal("ntfy"),
      url: z.string().url().default("https://ntfy.sh"),
      topic: z.string(),
    })
    .meta({ ref: "NtfyChannel" })
  export type NtfyChannel = z.infer<typeof NtfyChannel>

  export const SlackChannel = z
    .object({
      type: z.literal("slack"),
      webhook: z.string().url(),
    })
    .meta({ ref: "SlackChannel" })
  export type SlackChannel = z.infer<typeof SlackChannel>

  export const VoiceChannel = z
    .object({
      type: z.literal("voice"),
      engine: z.enum(["azure", "google", "local"]).default("local"),
      voice: z.string().optional(),
      rate: z.number().optional(),
    })
    .meta({ ref: "VoiceChannel" })
  export type VoiceChannel = z.infer<typeof VoiceChannel>

  export const NotificationChannel = z
    .discriminatedUnion("type", [OSChannel, NtfyChannel, SlackChannel, VoiceChannel])
    .meta({ ref: "NotificationChannel" })
  export type NotificationChannel = z.infer<typeof NotificationChannel>

  export const Notification = z
    .object({
      title: z.string(),
      message: z.string(),
      type: NotificationType,
      channels: z.array(NotificationChannel),
      icon: z.string().optional(),
      sound: z.boolean().optional().default(true),
      timeout: z.number().optional(),
      actions: z
        .array(
          z.object({
            label: z.string(),
            action: z.string(),
          }),
        )
        .optional(),
      metadata: z.record(z.string(), z.any()).optional(),
    })
    .meta({ ref: "Notification" })
  export type Notification = z.infer<typeof Notification>

  export const Event = {
    Sent: BusEvent.define(
      "notification.sent",
      z.object({
        notification: Notification,
        channels: z.array(z.string()),
      }),
    ),
    Failed: BusEvent.define(
      "notification.failed",
      z.object({
        notification: Notification,
        channel: z.string(),
        error: z.string(),
      }),
    ),
  }

  /**
   * Send a notification to configured channels
   */
  export const send = fn(Notification, async (input) => {
    const config = await Config.get()
    const channels = input.channels.length > 0 ? input.channels : config.notification?.defaultChannels ?? [{ type: "os" } as const]

    const results: { channel: string; success: boolean; error?: string }[] = []

    for (const channel of channels) {
      try {
        switch (channel.type) {
          case "os":
            await sendOS(input, channel)
            results.push({ channel: "os", success: true })
            break
          case "ntfy":
            await sendNtfy(input, channel)
            results.push({ channel: "ntfy", success: true })
            break
          case "slack":
            await sendSlack(input, channel)
            results.push({ channel: "slack", success: true })
            break
          case "voice":
            await sendVoice(input, channel)
            results.push({ channel: "voice", success: true })
            break
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        results.push({ channel: channel.type, success: false, error: errorMsg })
        log.error("notification failed", { channel: channel.type, error: errorMsg })

        Bus.publish(Event.Failed, {
          notification: input,
          channel: channel.type,
          error: errorMsg,
        })
      }
    }

    const successCount = results.filter((r) => r.success).length
    log.info("notification sent", {
      title: input.title,
      total: channels.length,
      success: successCount,
    })

    Bus.publish(Event.Sent, {
      notification: input,
      channels: results.filter((r) => r.success).map((r) => r.channel),
    })

    return {
      success: successCount > 0,
      results,
    }
  })

  /**
   * Send OS native notification
   */
  async function sendOS(notification: Notification, channel: OSChannel): Promise<void> {
    const { sendOSNotification } = await import("./os")
    await sendOSNotification(notification, channel)
  }

  /**
   * Send ntfy.sh notification
   */
  async function sendNtfy(notification: Notification, channel: NtfyChannel): Promise<void> {
    const { sendNtfyNotification } = await import("./ntfy")
    await sendNtfyNotification(notification, channel)
  }

  /**
   * Send Slack notification
   */
  async function sendSlack(notification: Notification, channel: SlackChannel): Promise<void> {
    const { sendSlackNotification } = await import("./slack")
    await sendSlackNotification(notification, channel)
  }

  /**
   * Send voice/TTS notification
   */
  async function sendVoice(notification: Notification, channel: VoiceChannel): Promise<void> {
    const { sendVoiceNotification } = await import("./voice")
    await sendVoiceNotification(notification, channel)
  }

  /**
   * Send notification on session end
   */
  export const onSessionEnd = fn(
    z.object({
      sessionID: z.string(),
      title: z.string().optional(),
      channels: z.array(NotificationChannel).optional(),
    }),
    async (input) => {
      const notification: Notification = {
        title: input.title ?? "Session Ended",
        message: `Session ${input.sessionID.slice(0, 8)}... has completed`,
        type: "info",
        channels: input.channels ?? [{ type: "os" }],
        sound: true,
      }
      return send(notification)
    },
  )

  /**
   * Send notification on task complete
   */
  export const onTaskComplete = fn(
    z.object({
      taskName: z.string(),
      success: z.boolean(),
      duration: z.number().optional(),
      channels: z.array(NotificationChannel).optional(),
    }),
    async (input) => {
      const durationStr = input.duration ? ` in ${formatDuration(input.duration)}` : ""
      const notification: Notification = {
        title: input.success ? "Task Completed" : "Task Failed",
        message: `${input.taskName}${durationStr}${input.success ? " ✓" : " ✗"}`,
        type: input.success ? "success" : "error",
        channels: input.channels ?? [{ type: "os" }],
        sound: true,
      }
      return send(notification)
    },
  )

  function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }

  /**
   * Initialize notification system
   */
  export async function init(): Promise<void> {
    log.info("notification system initialized")
  }
}
