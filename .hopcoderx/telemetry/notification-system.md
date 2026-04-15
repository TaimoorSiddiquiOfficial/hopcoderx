# Notification System

## Overview

HopCoderX now includes a comprehensive notification system with support for multiple delivery channels:

- **OS Native**: Windows Toast, macOS User Notifications, Linux notify-send
- **ntfy.sh**: Push notifications via the ntfy.sh service
- **Slack**: Incoming webhook notifications
- **Voice/TTS**: Text-to-speech using Azure, Google, or local system voices

## Features

### 1. Multi-Channel Delivery

Send notifications to multiple channels simultaneously with automatic fallback.

### 2. Type-Aware Notifications

Notifications are categorized by type (info, success, warning, error) with appropriate icons, sounds, and urgency levels.

### 3. Session & Task Notifications

Built-in hooks for session end and task completion notifications.

### 4. Configurable Channels

Set default notification channels in config for consistent delivery preferences.

## Configuration

### Basic Setup

```typescript
export default defineConfig({
  notification: {
    enabled: true,
    defaultChannels: [
      { type: "os" },  // Use OS native notifications
    ],
    onSessionEnd: false,
    onTaskComplete: true,
  },
})
```

### ntfy.sh Configuration

```typescript
export default defineConfig({
  notification: {
    ntfy: {
      url: "https://ntfy.sh",
      topic: "my-hopcoderx-alerts",
    },
    defaultChannels: [
      { type: "ntfy", url: "https://ntfy.sh", topic: "my-hopcoderx-alerts" },
    ],
  },
})
```

### Slack Configuration

```typescript
export default defineConfig({
  notification: {
    slack: {
      webhook: "https://hooks.slack.com/services/xxx/yyy/zzz",
      channel: "#hopcoderx-alerts",
    },
    defaultChannels: [
      { type: "slack", webhook: "https://hooks.slack.com/services/xxx/yyy/zzz" },
    ],
  },
})
```

### Voice/TTS Configuration

```typescript
export default defineConfig({
  notification: {
    voice: {
      engine: "local",  // or "azure", "google"
      voice: "Microsoft Zira",  // Platform-specific voice name
      rate: 1.0,  // Speech rate multiplier
    },
    defaultChannels: [
      { type: "voice", engine: "local" },
    ],
  },
})
```

### Environment Variables

```bash
# Azure TTS (optional)
export AZURE_TTS_KEY="your-azure-key"
export AZURE_TTS_REGION="eastus"

# Google TTS (optional)
export GOOGLE_TTS_KEY="your-google-key"
```

## NotificationManager API

### `send(notification)`

Send a notification to configured channels.

```typescript
import { NotificationManager } from "@/notification"

await NotificationManager.send({
  title: "Build Complete",
  message: "Your code compiled successfully with no errors",
  type: "success",
  channels: [
    { type: "os" },
    { type: "ntfy", url: "https://ntfy.sh", topic: "my-alerts" },
  ],
  icon: "checkmark",
  sound: true,
  timeout: 5000,
  actions: [
    { label: "View Logs", action: "https://example.com/logs" },
  ],
  metadata: {
    buildId: "12345",
    duration: "2m 34s",
  },
})
```

### `onSessionEnd(input)`

Send notification when a session ends.

```typescript
await NotificationManager.onSessionEnd({
  sessionID: "session-123",
  title: "Session Completed",
  channels: [{ type: "os" }],
})
```

### `onTaskComplete(input)`

Send notification when a task completes.

```typescript
await NotificationManager.onTaskComplete({
  taskName: "TypeScript Compilation",
  success: true,
  duration: 125000,  // 2m 5s
  channels: [{ type: "voice", engine: "local" }],
})
```

## Channel-Specific APIs

### OS Notifications

```typescript
import { sendOSNotification } from "@/notification/os"

await sendOSNotification({
  title: "Test",
  message: "Hello from HopCoderX",
  type: "info",
  channels: [],
}, {
  type: "os",
  platform: "windows",  // Optional: auto-detected if not specified
})
```

### ntfy.sh Notifications

```typescript
import { sendNtfyNotification, getSessionTopic } from "@/notification/ntfy"

// Send to session-specific topic
const topic = getSessionTopic("session-123")
await sendNtfyNotification({
  title: "Session Update",
  message: "New message received",
  type: "info",
  channels: [],
}, {
  type: "ntfy",
  url: "https://ntfy.sh",
  topic,
})

// Send with attachment (image, file)
import { sendNtfyWithAttachment } from "@/notification/ntfy"

await sendNtfyWithAttachment({
  title: "Screenshot",
  message: "Here's the error screenshot",
  type: "error",
  channels: [],
  attachmentUrl: "https://example.com/error.png",
  attachmentType: "image/png",
}, {
  type: "ntfy",
  topic: "my-alerts",
})
```

### Slack Notifications

```typescript
import { sendSlackNotification, sendSlackBlocks, formatSessionSummary } from "@/notification/slack"

// Simple notification
await sendSlackNotification({
  title: "Deployment Complete",
  message: "v1.2.3 deployed to production",
  type: "success",
  channels: [],
}, {
  type: "slack",
  webhook: "https://hooks.slack.com/services/xxx/yyy/zzz",
})

// Rich blocks formatting
await sendSlackBlocks([
  {
    type: "header",
    text: { type: "plain_text", text: "HopCoderX Alert" },
  },
  {
    type: "section",
    text: { type: "mrkdwn", text: "Custom message with *bold* and _italic_" },
  },
], {
  type: "slack",
  webhook: "...",
})

// Session summary
const stats = { tokens: 50000, cost: 0.15, duration: 300000 }
const blocks = formatSessionSummary("session-123", stats)
await sendSlackBlocks(blocks, { type: "slack", webhook: "..." })
```

### Voice/TTS Notifications

```typescript
import { sendVoiceNotification, getAvailableVoices } from "@/notification/voice"

// Local TTS (no API key required)
await sendVoiceNotification({
  title: "Build Complete",
  message: "Your code compiled successfully",
  type: "success",
  channels: [],
}, {
  type: "voice",
  engine: "local",
  rate: 1.0,
})

// Azure TTS (premium voices)
await sendVoiceNotification({
  title: "Alert",
  message: "Production deployment failed",
  type: "error",
  channels: [],
}, {
  type: "voice",
  engine: "azure",
  voice: "en-US-JennyNeural",
  rate: 1.1,
})

// Get available system voices (macOS)
const voices = await getAvailableVoices()
console.log("Available voices:", voices)
```

## Events

### `notification.sent`

Fired when a notification is successfully sent.

```typescript
Bus.event.listen((event) => {
  if (event.type === "notification.sent") {
    console.log(`Sent to channels: ${event.properties.channels.join(", ")}`)
  }
})
```

### `notification.failed`

Fired when a notification fails to send.

```typescript
Bus.event.listen((event) => {
  if (event.type === "notification.failed") {
    console.log(`Failed to send via ${event.properties.channel}: ${event.properties.error}`)
  }
})
```

## REST API Endpoints

The notification system is primarily used programmatically. For webhook-based triggers, you can use the MCP server or create custom endpoints.

### Example: Webhook Trigger

```typescript
// POST /api/notification/trigger
{
  "title": "External Alert",
  "message": "CI pipeline completed",
  "type": "success",
  "channels": [
    { "type": "slack", "webhook": "..." }
  ]
}
```

## Integration Points

1. **Session Processor**: Notify on session end (optional)
2. **Task System**: Notify on task completion
3. **Build/Deploy**: Notify on build success/failure
4. **Error Handling**: Notify on critical errors
5. **MCP Servers**: External tools can trigger notifications

## Example: CI/CD Integration

```typescript
import { NotificationManager } from "@/notification"

// In your CI/CD script
async function notifyBuildResult(build: {
  success: boolean
  version: string
  duration: number
  errors: string[]
}) {
  await NotificationManager.send({
    title: build.success ? "Build Successful" : "Build Failed",
    message: build.success
      ? `Version ${build.version} built in ${formatDuration(build.duration)}`
      : `Build failed with ${build.errors.length} errors`,
    type: build.success ? "success" : "error",
    channels: [
      { type: "os" },
      { type: "slack", webhook: process.env.SLACK_WEBHOOK },
    ],
    metadata: {
      version: build.version,
      duration: formatDuration(build.duration),
      errors: build.errors.slice(0, 3).join("\n"),
    },
  })
}
```

## Example: Long-Running Task Monitor

```typescript
import { NotificationManager } from "@/notification"

async function runWithNotification<T>(
  taskName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now()

  try {
    const result = await fn()
    const duration = Date.now() - start

    await NotificationManager.onTaskComplete({
      taskName,
      success: true,
      duration,
    })

    return result
  } catch (error) {
    const duration = Date.now() - start

    await NotificationManager.send({
      title: "Task Failed",
      message: `${taskName} failed after ${formatDuration(duration)}`,
      type: "error",
      channels: [{ type: "os" }, { type: "voice", engine: "local" }],
      metadata: { error: error instanceof Error ? error.message : String(error) },
    })

    throw error
  }
}

// Usage
await runWithNotification("Database Migration", async () => {
  // Long-running migration
})
```

## Platform-Specific Notes

### Windows

- Uses PowerShell ToastNotificationManager for modern toast notifications
- Falls back to MessageBox if WinRT is unavailable
- TTS uses System.Speech.Synthesis

### macOS

- Uses osascript for User Notifications
- TTS uses the `say` command with configurable voices
- Run `say -v ?` to list available voices

### Linux

- Uses `notify-send` from libnotify (freedesktop.org standard)
- Falls back to `zenity` if notify-send is unavailable
- TTS uses `espeak` or `festival` (install via package manager)
- Audio playback uses `aplay` or `paplay` (PulseAudio)

## Best Practices

1. **Use appropriate notification types**: Match the notification type to the severity (info, success, warning, error).

2. **Limit voice notifications**: Use voice/TTS sparingly for critical alerts to avoid notification fatigue.

3. **Configure topics wisely**: Use unique ntfy.sh topics per project or team to avoid cross-contamination.

4. **Include actionable info**: Add action buttons or metadata to make notifications useful.

5. **Respect quiet hours**: Consider implementing quiet hours in config to suppress non-critical notifications during off-hours.

6. **Test channels**: Verify each notification channel works before relying on it for critical alerts.

## Troubleshooting

### Windows notifications not showing

- Ensure PowerShell execution policy allows script execution
- Check Windows notification settings for HopCoderX

### macOS notifications not showing

- Check System Preferences > Notifications for HopCoderX permissions
- Ensure Focus Mode / Do Not Disturb is not enabled

### Linux notifications not showing

- Install libnotify: `sudo apt install libnotify-bin` (Debian/Ubuntu)
- Or: `sudo dnf install libnotify` (Fedora/RHEL)

### Voice/TTS not working

- **Windows**: Ensure System.Speech is available (included in .NET Framework)
- **macOS**: Run `say "test"` to verify system TTS
- **Linux**: Install espeak: `sudo apt install espeak`

### ntfy.sh notifications failing

- Verify the topic name is URL-safe (no spaces, special characters)
- Check firewall rules for outbound HTTPS to ntfy.sh

## File Structure

```
src/notification/
  index.ts      - Core notification manager and types
  os.ts         - OS native notifications (Windows/macOS/Linux)
  ntfy.ts       - ntfy.sh push notifications
  slack.ts      - Slack webhook notifications
  voice.ts      - TTS voice notifications (Azure/Google/Local)
```
