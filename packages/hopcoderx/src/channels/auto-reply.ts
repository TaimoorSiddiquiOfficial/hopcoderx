/**
 * Auto-reply engine for HopCoderX channels.
 *
 * Handles:
 *   - Debouncing: collect multiple messages before replying
 *   - Thread binding: route replies to the right thread
 *   - Typing indicators: send "typing…" status while agent is thinking
 *   - Status reactions: react with emoji when a command is received
 *   - Rate limiting: max N replies per minute per channel/thread
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

  constructor(config?: Partial<AutoReplyConfig>) {
    this.config = {
      debounceMs: parseInt(process.env.HOPCODERX_AUTOREPLY_DEBOUNCE ?? "1000", 10),
      maxRpm: parseInt(process.env.HOPCODERX_AUTOREPLY_MAX_RPM ?? "10", 10),
      typingIndicators: process.env.HOPCODERX_AUTOREPLY_TYPING !== "false",
      enabledChannels: (process.env.HOPCODERX_AUTOREPLY_CHANNELS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      ...config,
    }
  }

  /** Register the agent handler that will be called with batched messages */
  setHandler(handler: AgentHandler): void {
    this.handler = handler
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

  /** Start listening on all available channels */
  async startAll(): Promise<void> {
    const channels = this.config.enabledChannels.length > 0
      ? this.config.enabledChannels.map((id) => ChannelRegistry.get(id)).filter(Boolean)
      : ChannelRegistry.available()

    for (const ch of channels) {
      if (!ch) continue
      ch.onMessage(async (msg) => {
        await this.onMessage(msg)
      })
      await ch.startListening?.()
      console.log(`[auto-reply] Listening on ${ch.config.id}`)
    }
  }

  async stopAll(): Promise<void> {
    for (const ch of ChannelRegistry.all()) {
      await ch.stopListening?.()
    }
    for (const state of this.threads.values()) {
      if (state.timer) clearTimeout(state.timer)
    }
    this.threads.clear()
  }
}

// Singleton instance
export const autoReply = new AutoReplyEngine()
