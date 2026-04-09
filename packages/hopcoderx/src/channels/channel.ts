/**
 * Channel abstraction layer for HopCoderX.
 *
 * Defines the interface all messaging/notification channels must implement.
 * Each channel is a plugin loaded lazily — keeps core lean.
 *
 * Channels:
 *   - github-issues  (built-in)
 *   - slack          (built-in)
 *   - discord        (built-in)
 *   - telegram       (built-in)
 *   - teams          (built-in)
 *   - whatsapp       (built-in)
 *   - matrix         (built-in)
 *   - signal         (built-in)
 *   - irc            (built-in)
 *   - mattermost     (built-in)
 *   - line           (built-in)
 *   - feishu         (built-in)
 *   - googlechat     (built-in)
 *   - twitch         (built-in)
 *   - synology-chat  (built-in)
 *   - nextcloud-talk (built-in)
 *   - nostr          (built-in)
 *   - email/ses      (built-in)
 *   - pagerduty      (built-in)
 *   - linear         (built-in)
 *   - custom         (user-provided via plugin)
 *
 * Channel plugins are loaded from:
 *   - Built-in: packages/hopcoderx/src/channels/<name>.ts
 *   - NPM plugin: hopcoderx-channel-<name> package
 */

// ─── Core types ────────────────────────────────────────────────────────────────

export interface ChannelMessage {
  /** Channel-specific message/event ID */
  id: string
  /** Where this came from */
  channelId: string
  /** Thread or conversation ID */
  threadId?: string
  /** Sender identifier */
  from: string
  /** Message body */
  text: string
  /** Attachments (files, images) */
  attachments?: Array<{ name: string; url?: string; data?: string; mimeType?: string }>
  /** Raw platform-specific payload */
  raw?: Record<string, any>
  timestamp: number
}

export interface ChannelReply {
  text: string
  /** Reply to a specific thread */
  threadId?: string
  /** Attach files */
  attachments?: Array<{ name: string; content: string; mimeType?: string }>
  /** Platform-specific options */
  options?: Record<string, any>
}

export interface ChannelConfig {
  /** Unique channel type ID */
  id: string
  /** Human-readable name */
  name: string
  /** Required environment variables */
  envVars: string[]
  /** Whether this channel can receive messages */
  canReceive: boolean
  /** Whether this channel can send messages */
  canSend: boolean
}

export interface Channel {
  readonly config: ChannelConfig

  /** Initialize the channel (authenticate, connect) */
  init(): Promise<void>

  /** Send a message */
  send(to: string, reply: ChannelReply): Promise<void>

  /** Register a handler for incoming messages */
  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void

  /** Start listening for incoming messages */
  startListening?(): Promise<void>

  /** Stop listening */
  stopListening?(): Promise<void>

  /** Send a typing indicator (best-effort, non-fatal if unsupported) */
  sendTyping?(to: string, typing?: boolean): Promise<void>

  /** Check if credentials are available */
  isAvailable(): boolean

  /**
   * Run a health check and return a diagnostic report.
   * Should verify config validity, connectivity, and auth state without side effects.
   */
  diagnose?(): Promise<ChannelDiagnostic>
}

export interface ChannelDiagnostic {
  channelId: string
  ok: boolean
  /** Human-readable status summary */
  summary: string
  /** Individual check results */
  checks: Array<{ name: string; ok: boolean; detail?: string }>
}

// ─── Registry ──────────────────────────────────────────────────────────────────

const _channels = new Map<string, Channel>()

export const ChannelRegistry = {
  register(channel: Channel): void {
    _channels.set(channel.config.id, channel)
  },

  get(id: string): Channel | undefined {
    return _channels.get(id)
  },

  all(): Channel[] {
    return Array.from(_channels.values())
  },

  available(): Channel[] {
    return this.all().filter((c) => c.isAvailable())
  },

  async send(channelId: string, to: string, reply: ChannelReply): Promise<void> {
    const ch = this.get(channelId)
    if (!ch) throw new Error(`Channel '${channelId}' not registered`)
    if (!ch.isAvailable()) throw new Error(`Channel '${channelId}' not configured (missing env vars)`)
    await ch.send(to, reply)
  },

  async sendTyping(channelId: string, to: string, typing = true): Promise<void> {
    const ch = this.get(channelId)
    if (ch?.sendTyping) await ch.sendTyping(to, typing).catch(() => {/* best-effort */})
  },

  async diagnose(channelId: string): Promise<ChannelDiagnostic> {
    const ch = this.get(channelId)
    if (!ch) {
      return { channelId, ok: false, summary: `Channel '${channelId}' not registered`, checks: [] }
    }
    if (ch.diagnose) return ch.diagnose()
    // Fallback: basic config check
    const missingEnv = ch.config.envVars.filter((v) => !process.env[v])
    const ok = missingEnv.length === 0
    return {
      channelId,
      ok,
      summary: ok ? "Config present" : `Missing env vars: ${missingEnv.join(", ")}`,
      checks: ch.config.envVars.map((v) => ({
        name: `env:${v}`,
        ok: !!process.env[v],
        detail: process.env[v] ? "set" : "missing",
      })),
    }
  },

  async diagnoseAll(): Promise<ChannelDiagnostic[]> {
    return Promise.all(Array.from(_channels.keys()).map((id) => this.diagnose(id)))
  },
}
