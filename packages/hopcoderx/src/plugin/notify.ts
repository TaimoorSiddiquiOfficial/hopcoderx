/**
 * B2 - OS Notification Plugin
 *
 * Sends native desktop notifications when:
 *   - A permission request requires user input
 *   - A session encounters an error
 *   - A session becomes idle (i.e. the agent stops without requesting input)
 *
 * Platform support:
 *   macOS  – osascript display notification
 *   Linux  – notify-send
 *   Windows – PowerShell New-BurntToastNotification / WScript.Shell popup
 */

import type { Plugin } from "@hopcoderx/plugin"
import { spawn } from "child_process"

function send(title: string, body: string) {
  try {
    switch (process.platform) {
      case "darwin": {
        const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`
        spawn("osascript", ["-e", script], { stdio: "ignore", detached: true }).unref()
        break
      }
      case "linux": {
        spawn("notify-send", [title, body], { stdio: "ignore", detached: true }).unref()
        break
      }
      case "win32": {
        // PowerShell toast notification (Windows 10+)
        const ps = [
          "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
          "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
          `$xml = [Windows.Data.Xml.Dom.XmlDocument]::new()`,
          `$xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>${title.replace(/</g, "&lt;")}</text><text>${body.replace(/</g, "&lt;")}</text></binding></visual></toast>')`,
          `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("hopcoderx").Show([Windows.UI.Notifications.ToastNotification]::new($xml))`,
        ].join("; ")
        spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], {
          stdio: "ignore",
          detached: true,
        }).unref()
        break
      }
    }
  } catch {
    // notifications are best-effort
  }
}

// Track sessions that have gone idle so we only notify once per idle period
const notifiedIdle = new Set<string>()

export const NotifyPlugin: Plugin = async (_ctx) => {
  return {
    event: async ({ event }) => {
      const type: string = (event as any)?.payload?.type ?? (event as any)?.type ?? ""
      const props: any = (event as any)?.payload?.properties ?? (event as any)?.properties ?? {}

      // Permission request
      if (type === "permission.updated" || type === "permission.ask") {
        send("HopCoderX – Permission Required", props.description ?? "An action requires your approval")
        return
      }

      // Session error
      if (type === "session.error") {
        const msg: string = props.error?.data?.message ?? props.message ?? "An error occurred"
        send("HopCoderX – Error", msg.slice(0, 120))
        return
      }

      // Session updated – detect idle (agent stopped without requesting input)
      if (type === "session.updated") {
        const sessionID: string = props.sessionID ?? ""
        const status: string = props.status ?? ""
        if (status === "idle" && sessionID && !notifiedIdle.has(sessionID)) {
          notifiedIdle.add(sessionID)
          send("HopCoderX – Idle", "The agent has finished and is waiting for your input")
        }
        if (status !== "idle" && sessionID) {
          notifiedIdle.delete(sessionID)
        }
      }
    },
  }
}
