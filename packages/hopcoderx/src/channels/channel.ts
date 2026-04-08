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

  /** Check if credentials are available */
  isAvailable(): boolean
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
}
