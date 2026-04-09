/**
 * Auto-reply engine for HopCoderX channels.
 *
 * Handles:
 *   - Debouncing: collect multiple messages before replying
 *   - Thread binding: route replies to the right thread
 *   - Typing indicators: send "typing…" status while agent is thinking
 *   - Status reactions: react with emoji when a command is received
 *   - Rate limiting: max N replies per minute per channel/thread
 *   - Heartbeat: periodic proactive check-ins driven by HEARTBEAT.md
 *   - Keep-alive: auto-reconnect channels on disconnect
 *
 * Used by daemon when channels are listening.
 * Configure via HOPCODERX_AUTOREPLY_* env vars.
 */

import { ChannelRegistry, type ChannelMessage } from "./channel"

export interface AutoReplyConfig {
  /** Milliseconds to wait after last message before replying (default: 1000) */
  debounceMs: number
  /** Max replies per minute per thread (default: 10) */
  maxRpm: number
  /** Whether to send typing indicators (default: true) */
  typingIndicators: boolean
  /** Channels to enable auto-reply for */
  enabledChannels: string[]
  /**
   * Keep-alive: auto-reconnect channels if they disconnect.
   * Set to false for one-shot / test scenarios.
   */
  keepAlive: boolean
  /** Milliseconds between reconnect attempts (default: 10000) */
  reconnectDelayMs: number
}

export type AgentHandler = (messages: ChannelMessage[], threadId: string, channelId: string) => Promise<string>

interface ThreadState {
  messages: ChannelMessage[]
  timer: NodeJS.Timeout | null
  replyCount: number
  windowStart: number
}

export class AutoReplyEngine {
  private config: AutoReplyConfig
  private threads = new Map<string, ThreadState>()
  private handler: AgentHandler | null = null
  private _running = false
  private _heartbeat: HeartbeatScheduler | null = null

  constructor(config?: Partial<AutoReplyConfig>) {
    this.config = {
      debounceMs: parseInt(process.env.HOPCODERX_AUTOREPLY_DEBOUNCE ?? "1000", 10),
      maxRpm: parseInt(process.env.HOPCODERX_AUTOREPLY_MAX_RPM ?? "10", 10),
      typingIndicators: process.env.HOPCODERX_AUTOREPLY_TYPING !== "false",
      enabledChannels: (process.env.HOPCODERX_AUTOREPLY_CHANNELS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      keepAlive: process.env.HOPCODERX_AUTOREPLY_KEEPALIVE !== "false",
      reconnectDelayMs: parseInt(process.env.HOPCODERX_AUTOREPLY_RECONNECT_DELAY ?? "10000", 10),
      ...config,
    }
  }

  /** Register the agent handler that will be called with batched messages */
  setHandler(handler: AgentHandler): void {
    this.handler = handler
  }

  /** Configure and start a heartbeat scheduler */
  setHeartbeat(scheduler: HeartbeatScheduler): void {
    this._heartbeat = scheduler
  }

  /** Process an incoming message (called by channel listeners) */
  async onMessage(msg: ChannelMessage): Promise<void> {
    if (!this.handler) return
    if (this.config.enabledChannels.length > 0 && !this.config.enabledChannels.includes(msg.channelId)) return

    const threadKey = `${msg.channelId}:${msg.threadId ?? msg.from}`
    let state = this.threads.get(threadKey)
    if (!state) {
      state = { messages: [], timer: null, replyCount: 0, windowStart: Date.now() }
      this.threads.set(threadKey, state)
    }

    state.messages.push(msg)

    // Clear existing debounce timer
    if (state.timer) clearTimeout(state.timer)

    // Emit typing indicator immediately so the user sees feedback
    if (this.config.typingIndicators) {
      const dest = msg.threadId ?? msg.from
      ChannelRegistry.sendTyping(msg.channelId, dest).catch(() => {/* best-effort */})
    }

    // Set new debounce timer
    state.timer = setTimeout(async () => {
      await this.flush(threadKey)
    }, this.config.debounceMs)
  }

  private async flush(threadKey: string): Promise<void> {
    const state = this.threads.get(threadKey)
    if (!state || !this.handler || state.messages.length === 0) return

    const [channelId, threadId] = threadKey.split(":", 2)

    // Rate limiting
    const now = Date.now()
    if (now - state.windowStart > 60000) {
      state.replyCount = 0
      state.windowStart = now
    }
    if (state.replyCount >= this.config.maxRpm) {
      console.warn(`[auto-reply] Rate limit hit for thread ${threadKey}`)
      state.messages = []
      return
    }

    const messages = [...state.messages]
    state.messages = []
    state.timer = null
    state.replyCount++

    try {
      const reply = await this.handler(messages, threadId ?? "", channelId)
      if (reply) {
        await ChannelRegistry.send(channelId, threadId ?? messages[0].from, {
          text: reply,
          threadId,
        })
      }
    } catch (e) {
      console.warn(`[auto-reply] Handler error for ${threadKey}:`, e)
    }
  }

  /** Start listening on all available channels with optional keep-alive reconnect */
  async startAll(): Promise<void> {
    this._running = true
    const channels = this.config.enabledChannels.length > 0
      ? this.config.enabledChannels.map((id) => ChannelRegistry.get(id)).filter(Boolean)
      : ChannelRegistry.available()

    for (const ch of channels) {
      if (!ch) continue
      ch.onMessage(async (msg) => {
        await this.onMessage(msg)
      })
      await this._startChannel(ch.config.id)
    }

    this._heartbeat?.start()
  }

  private async _startChannel(channelId: string): Promise<void> {
    const ch = ChannelRegistry.get(channelId)
    if (!ch?.startListening) return
    try {
      await ch.startListening()
      console.log(`[auto-reply] Listening on ${channelId}`)
    } catch (err) {
      console.error(`[auto-reply] Failed to start ${channelId}:`, err)
      if (this.config.keepAlive && this._running) {
        this._scheduleReconnect(channelId)
      }
    }
  }

  private _scheduleReconnect(channelId: string): void {
    setTimeout(async () => {
      if (!this._running) return
      console.log(`[auto-reply] Reconnecting ${channelId}…`)
      await this._startChannel(channelId)
    }, this.config.reconnectDelayMs)
  }

  async stopAll(): Promise<void> {
    this._running = false
    this._heartbeat?.stop()
    for (const ch of ChannelRegistry.all()) {
      await ch.stopListening?.()
    }
    for (const state of this.threads.values()) {
      if (state.timer) clearTimeout(state.timer)
    }
    this.threads.clear()
  }
}

// ─── Heartbeat scheduler ──────────────────────────────────────────────────────

export interface HeartbeatConfig {
  /** Interval between heartbeat ticks (ms, default: 30 minutes) */
  intervalMs: number
  /** Channel IDs to deliver heartbeat messages to (default: all available) */
  channels?: string[]
  /** Per-channel recipient address (if omitted, heartbeat is internal-only) */
  recipients?: Record<string, string>
  /** Prompt or content to pass to the handler on each tick */
  prompt?: string
}

export type HeartbeatHandler = (prompt: string) => Promise<string | null>

/**
 * HeartbeatScheduler fires periodic ticks so the agent can proactively check in.
 *
 * Inspired by OpenClaw's heartbeat-runner: reads HEARTBEAT.md, runs the agent,
 * delivers the reply to configured channel recipients.
 *
 * Usage:
 *   const hb = new HeartbeatScheduler({
 *     intervalMs: 30 * 60 * 1000,
 *     recipients: { telegram: "123456789" },
 *   })
 *   hb.setHandler(async (prompt) => await agent.run(prompt))
 *   hb.start()
 */
export class HeartbeatScheduler {
  private config: HeartbeatConfig
  private handler: HeartbeatHandler | null = null
  private _timer: NodeJS.Timeout | null = null
  private _running = false

  static readonly DEFAULT_PROMPT =
    "Check HEARTBEAT.md in the project workspace (if it exists) and follow its instructions. " +
    "If nothing needs attention, reply with exactly: HEARTBEAT_OK"

  constructor(config?: Partial<HeartbeatConfig>) {
    this.config = {
      intervalMs: parseInt(process.env.HOPCODERX_HEARTBEAT_INTERVAL_MS ?? String(30 * 60 * 1000), 10),
      prompt: process.env.HOPCODERX_HEARTBEAT_PROMPT ?? HeartbeatScheduler.DEFAULT_PROMPT,
      channels: (process.env.HOPCODERX_HEARTBEAT_CHANNELS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      ...config,
    }
  }

  setHandler(handler: HeartbeatHandler): void {
    this.handler = handler
  }

  start(): void {
    if (this._running) return
    this._running = true
    this._schedule()
    console.log(`[heartbeat] Scheduled every ${Math.round(this.config.intervalMs / 60000)}m`)
  }

  stop(): void {
    this._running = false
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
  }

  /** Trigger a heartbeat tick immediately (useful for testing) */
  async tick(): Promise<void> {
    if (!this.handler) return
    try {
      const reply = await this.handler(this.config.prompt ?? HeartbeatScheduler.DEFAULT_PROMPT)
      if (!reply || reply.trim() === "HEARTBEAT_OK") return
      await this._deliver(reply)
    } catch (err) {
      console.error("[heartbeat] tick error:", err)
    }
  }

  private _schedule(): void {
    this._timer = setTimeout(async () => {
      if (!this._running) return
      await this.tick()
      if (this._running) this._schedule()
    }, this.config.intervalMs)
  }

  private async _deliver(message: string): Promise<void> {
    const channelIds = this.config.channels?.length
      ? this.config.channels
      : ChannelRegistry.available().map((c) => c.config.id)

    for (const channelId of channelIds) {
      const to = this.config.recipients?.[channelId]
      if (!to) continue
      await ChannelRegistry.send(channelId, to, { text: message }).catch((err) => {
        console.warn(`[heartbeat] Delivery failed on ${channelId}:`, err)
      })
    }
  }
}

// Singleton instance
export const autoReply = new AutoReplyEngine()
