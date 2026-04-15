/**
 * OS Native Notifications
 *
 * Uses platform-specific APIs for native desktop notifications:
 * - Windows: Toast notifications via PowerShell/WinRT
 * - macOS: NSUserNotification via AppleScript/osascript
 * - Linux: notify-send via freedesktop.org
 */

import type { NotificationManager } from "./index"
type Notification = NotificationManager.Notification
type OSChannel = NotificationManager.OSChannel
import { Log } from "@/util/log"
import { execFile } from "child_process"
import { promisify } from "util"
import os from "os"

const execFileAsync = promisify(execFile)
const log = Log.create({ service: "notification.os" })

export async function sendOSNotification(notification: Notification, channel: OSChannel): Promise<void> {
  const platform = channel.platform ?? getPlatform()

  switch (platform) {
    case "windows":
      await sendWindows(notification)
      break
    case "macos":
      await sendMacOS(notification)
      break
    case "linux":
      await sendLinux(notification)
      break
  }
}

function getPlatform(): OSChannel["platform"] {
  const plat = os.platform()
  if (plat === "win32") return "windows"
  if (plat === "darwin") return "macos"
  return "linux"
}

/**
 * Windows Toast Notification via PowerShell
 */
async function sendWindows(notification: Notification): Promise<void> {
  const { title, message, type } = notification

  // Map notification type to Windows toast severity
  const severityMap: Record<string, string> = {
    info: "Default",
    success: "Success",
    warning: "Warning",
    error: "Error",
  }

  const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$toastXml = @"
<toast>
  <visual>
    <binding template="ToastText02">
      <text id="1">${escapeXml(title)}</text>
      <text id="2">${escapeXml(message)}</text>
    </binding>
  </visual>
  <audio src="ms-winsoundevent:Notification.${severityMap[type]}" />
</toast>
"@

$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($toastXml)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("HopCoderX").Show($toast)
`

  try {
    await execFileAsync("powershell", ["-Command", script], {
      timeout: 5000,
      windowsHide: true,
    })
    log.info("windows notification sent", { title, message })
  } catch (error) {
    // Fall back to simpler PowerShell notification
    const fallbackScript = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show("${message.replace(/"/g, '`"')}", "${title.replace(/"/g, '`"')}")
`
    try {
      await execFileAsync("powershell", ["-Command", fallbackScript], {
        timeout: 5000,
        windowsHide: true,
      })
      log.info("windows notification sent (fallback)", { title })
    } catch (fallbackError) {
      log.error("windows notification failed", { error: fallbackError })
      throw new Error(`Windows notification failed: ${error}`)
    }
  }
}

/**
 * macOS Notification via osascript
 */
async function sendMacOS(notification: Notification): Promise<void> {
  const { title, message, type } = notification

  const script = `
display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}" subtitle "${escapeAppleScript(type.toUpperCase())}"
`

  try {
    await execFileAsync("osascript", ["-e", script], {
      timeout: 5000,
    })
    log.info("macos notification sent", { title, message })
  } catch (error) {
    log.error("macos notification failed", { error })
    throw new Error(`macOS notification failed: ${error}`)
  }
}

/**
 * Linux Notification via notify-send
 */
async function sendLinux(notification: Notification): Promise<void> {
  const { title, message, type, icon, timeout } = notification

  const args: string[] = []

  // Set icon
  if (icon) {
    args.push("-i", icon)
  } else {
    // Use default icons based on type
    const iconMap: Record<string, string> = {
      info: "dialog-information",
      success: "dialog-ok",
      warning: "dialog-warning",
      error: "dialog-error",
    }
    if (iconMap[type]) {
      args.push("-i", iconMap[type])
    }
  }

  // Set urgency
  const urgencyMap: Record<string, string> = {
    info: "normal",
    success: "normal",
    warning: "low",
    error: "critical",
  }
  args.push("-u", urgencyMap[type] || "normal")

  // Set timeout
  if (timeout) {
    args.push("-t", timeout.toString())
  }

  args.push(title, message)

  try {
    await execFileAsync("notify-send", args, {
      timeout: 5000,
    })
    log.info("linux notification sent", { title, message })
  } catch (error) {
    // Check if notify-send is available
    if ((error as any).code === "ENOENT") {
      log.warn("notify-send not available, trying alternative", { error })
      // Try zenity as fallback
      try {
        await execFileAsync("zenity", ["--notification", "--title", title, "--text", message], {
          timeout: 5000,
        })
        log.info("linux notification sent (zenity fallback)", { title })
        return
      } catch (zenityError) {
        log.error("zenity fallback failed", { error: zenityError })
      }
    }
    log.error("linux notification failed", { error })
    throw new Error(`Linux notification failed: ${error}`)
  }
}

/**
 * Escape special characters for XML
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/**
 * Escape special characters for AppleScript
 */
function escapeAppleScript(text: string): string {
  return text.replace(/"/g, '\\"').replace(/\\/g, "\\\\")
}
