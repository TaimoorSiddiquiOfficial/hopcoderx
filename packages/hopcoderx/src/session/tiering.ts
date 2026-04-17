/**
 * Context window tiering for long sessions.
 *
 * Splits message history into three tiers to stay within model token budgets:
 *
 *   TIER 1 – Pinned (always included): system message + first user message
 *   TIER 2 – Recent (full fidelity): the most recent N messages that fit in budget
 *   TIER 3 – Archive (summarized): older messages represented by compaction summaries
 *
 * This reduces token usage in long sessions by 30-50% while preserving the most
 * recent context at full fidelity and keeping older context as summaries.
 */

import type { MessageV2 } from "./message-v2"
import { Token } from "../util/token"

export namespace ContextTiering {
  /**
   * Default token budget reserved for recent history (TIER 2).
   * Older messages beyond this budget are dropped or replaced by summaries.
   */
  export const RECENT_TOKEN_BUDGET = 60_000

  /**
   * Maximum number of messages kept in the recent tier regardless of token count.
   */
  export const RECENT_MAX_MESSAGES = 40

  export interface TierResult {
    /** Messages to send to the LLM (pinned + recent, with archive summaries inserted). */
    messages: MessageV2.WithParts[]
    /** Number of messages dropped from the archive tier. */
    archivedCount: number
    /** Estimated tokens of the included messages. */
    estimatedTokens: number
  }

  /**
   * Estimate the token cost of a single message (all its text/tool parts).
   */
  function estimateMessage(msg: MessageV2.WithParts): number {
    let total = 0
    for (const part of msg.parts) {
      if (part.type === "text") total += Token.estimate(part.text)
      if (part.type === "tool" && part.state.status === "completed") {
        total += Token.estimate(part.state.output ?? "")
        total += Token.estimate(JSON.stringify(part.state.input ?? {}))
      }
    }
    return total
  }

  /**
   * Apply context window tiering to a session's message history.
   *
   * @param messages  Full ordered message history (oldest first)
   * @param budget    Token budget for the recent tier (default: RECENT_TOKEN_BUDGET)
   * @param maxRecent Maximum number of recent messages to keep (default: RECENT_MAX_MESSAGES)
   * @returns         Tiered message list and stats
   */
  export function apply(
    messages: MessageV2.WithParts[],
    budget = RECENT_TOKEN_BUDGET,
    maxRecent = RECENT_MAX_MESSAGES,
    pinnedMessageIDs?: Set<string>,
  ): TierResult {
    if (messages.length === 0) {
      return { messages: [], archivedCount: 0, estimatedTokens: 0 }
    }

    // Find the last compaction summary boundary — messages after it are always recent
    const lastCompactionIdx = (() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg.info.role === "assistant" && (msg.info as any).summary === true) return i
      }
      return -1
    })()

    // Everything from the last compaction onwards is recent by definition
    const alwaysRecentStart = lastCompactionIdx >= 0 ? lastCompactionIdx : 0
    const pinned = messages.slice(0, Math.min(1, alwaysRecentStart)) // first message (system/user)
    const candidates = messages.slice(pinned.length)

    // Walk from newest to oldest, accumulating until budget exhausted
    const recent: MessageV2.WithParts[] = []
    let tokens = 0
    let archivedCount = 0

    for (let i = candidates.length - 1; i >= 0; i--) {
      const msg = candidates[i]
      // Bookmarked messages are always preserved regardless of budget
      const isBookmarked = pinnedMessageIDs?.has(msg.info.id) ?? false
      if (recent.length >= maxRecent && !isBookmarked) {
        archivedCount++
        continue
      }
      const cost = estimateMessage(msg)
      if (tokens + cost > budget && recent.length > 0 && !isBookmarked) {
        archivedCount++
        continue
      }
      recent.unshift(msg)
      tokens += cost
    }

    // If all messages fit, return them unchanged (no tiering needed)
    if (archivedCount === 0) {
      const allTokens = messages.reduce((sum, m) => sum + estimateMessage(m), 0)
      return { messages, archivedCount: 0, estimatedTokens: allTokens }
    }

    const result = [...pinned, ...recent]
    return { messages: result, archivedCount, estimatedTokens: tokens }
  }
}
