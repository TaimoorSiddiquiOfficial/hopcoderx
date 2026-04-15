/**
 * Quota Tracker for Token/Cost Management
 *
 * Tracks token usage and costs across providers with:
 * - Per-provider quota limits
 * - Usage thresholds with warnings
 * - Cost estimation in USD
 * - Reset time tracking
 *
 * Inspired by:
 * - opencode-quota (quota tracking via toasts)
 * - opencode-tokenscope (comprehensive token analysis)
 */

import { Log } from "../util/log"
import { Bus } from "../bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "../config/config"
import z from "zod"

const log = Log.create({ service: "telemetry-quota" })

/**
 * Provider quota information
 */
export interface ProviderQuota {
  providerID: string
  /** Current tokens used in this session */
  used: number
  /** Token limit (if configured) */
  limit?: number
  /** When the quota resets (timestamp) */
  resetAt?: number
  /** Estimated cost in USD */
  costUSD: number
  /** Input tokens used */
  inputTokens: number
  /** Output tokens used */
  outputTokens: number
  /** Cache hit tokens */
  cacheHitTokens?: number
  /** Cache miss tokens */
  cacheMissTokens?: number
}

/**
 * Quota status
 */
export interface QuotaStatus {
  providerID: string
  used: number
  limit?: number
  remaining?: number
  utilizationPercent: number
  costUSD: number
  resetAt?: number
  resetInMs?: number
  warning?: string
  exceeded: boolean
}

/**
 * Quota threshold configuration
 */
export interface QuotaThreshold {
  /** Warn at this utilization percent (0-100) */
  warnPercent: number
  /** Block at this utilization percent (0-100) */
  blockPercent: number
  /** Maximum cost before warning */
  maxCostUSD?: number
}

const DEFAULT_THRESHOLDS: QuotaThreshold = {
  warnPercent: 80,
  blockPercent: 100,
  maxCostUSD: 10,
}

/**
 * Token usage record
 */
export interface TokenUsage {
  providerID: string
  sessionID: string
  inputTokens: number
  outputTokens: number
  cacheHitTokens?: number
  cacheMissTokens?: number
  costUSD: number
  timestamp: number
}

const state = new Map<
  string,
  {
    quota: ProviderQuota
    history: TokenUsage[]
  }
>()

let thresholds: QuotaThreshold = DEFAULT_THRESHOLDS

export namespace QuotaTracker {
  /**
   * Initialize quota tracker with config
   */
  export async function init(): Promise<void> {
    const cfg = await Config.get()

    // Load thresholds from config
    if (cfg.telemetry?.quota) {
      thresholds = {
        warnPercent: cfg.telemetry.quota.warnPercent ?? DEFAULT_THRESHOLDS.warnPercent,
        blockPercent: cfg.telemetry.quota.blockPercent ?? DEFAULT_THRESHOLDS.blockPercent,
        maxCostUSD: cfg.telemetry.quota.maxCostUSD ?? DEFAULT_THRESHOLDS.maxCostUSD,
      }
    }

    log.info("quota tracker initialized", {
      thresholds,
    })
  }

  /**
   * Track token usage for a provider
   */
  export function track(usage: {
    providerID: string
    sessionID: string
    inputTokens: number
    outputTokens: number
    cacheHitTokens?: number
    cacheMissTokens?: number
    costUSD: number
  }): ProviderQuota {
    const existing = state.get(usage.providerID)

    const quota: ProviderQuota = existing
      ? {
          ...existing.quota,
          used: existing.quota.used + usage.inputTokens + usage.outputTokens,
          inputTokens: existing.quota.inputTokens + usage.inputTokens,
          outputTokens: existing.quota.outputTokens + usage.outputTokens,
          cacheHitTokens: (existing.quota.cacheHitTokens ?? 0) + (usage.cacheHitTokens ?? 0),
          cacheMissTokens: (existing.quota.cacheMissTokens ?? 0) + (usage.cacheMissTokens ?? 0),
          costUSD: existing.quota.costUSD + usage.costUSD,
        }
      : {
          providerID: usage.providerID,
          used: usage.inputTokens + usage.outputTokens,
          limit: undefined,
          resetAt: undefined,
          costUSD: usage.costUSD,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheHitTokens: usage.cacheHitTokens,
          cacheMissTokens: usage.cacheMissTokens,
        }

    const tokenUsage: TokenUsage = {
      providerID: usage.providerID,
      sessionID: usage.sessionID,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheHitTokens: usage.cacheHitTokens,
      cacheMissTokens: usage.cacheMissTokens,
      costUSD: usage.costUSD,
      timestamp: Date.now(),
    }

    state.set(usage.providerID, {
      quota,
      history: [...(existing?.history ?? []), tokenUsage],
    })

    // Check thresholds and emit warnings
    checkThresholds(usage.providerID, quota)

    return quota
  }

  /**
   * Check quota thresholds and emit warnings
   */
  function checkThresholds(providerID: string, quota: ProviderQuota): void {
    const status = getStatus(providerID)

    if (status.utilizationPercent >= thresholds.blockPercent) {
      log.error("quota exceeded", {
        providerID,
        utilizationPercent: status.utilizationPercent,
        costUSD: status.costUSD,
      })
      Bus.publish(Event.QuotaExceeded, {
        providerID,
        status,
        reason: "limit_exceeded",
      })
    } else if (status.utilizationPercent >= thresholds.warnPercent) {
      log.warn("quota warning", {
        providerID,
        utilizationPercent: status.utilizationPercent,
        costUSD: status.costUSD,
      })
      Bus.publish(Event.QuotaWarning, {
        providerID,
        status,
        reason: "threshold_approaching",
      })
    }

    if (thresholds.maxCostUSD && status.costUSD >= thresholds.maxCostUSD) {
      log.warn("cost threshold exceeded", {
        providerID,
        costUSD: status.costUSD,
        maxCostUSD: thresholds.maxCostUSD,
      })
      Bus.publish(Event.QuotaWarning, {
        providerID,
        status,
        reason: "cost_threshold",
      })
    }
  }

  /**
   * Get current quota status for a provider
   */
  export function getStatus(providerID: string): QuotaStatus {
    const entry = state.get(providerID)

    if (!entry) {
      return {
        providerID,
        used: 0,
        utilizationPercent: 0,
        costUSD: 0,
        exceeded: false,
      }
    }

    const { quota } = entry
    const remaining = quota.limit ? quota.limit - quota.used : undefined
    const utilizationPercent = quota.limit ? (quota.used / quota.limit) * 100 : 0
    const resetInMs = quota.resetAt ? quota.resetAt - Date.now() : undefined
    const exceeded = quota.limit ? quota.used > quota.limit : false

    let warning: string | undefined
    if (exceeded) {
      warning = `Quota exceeded: ${quota.used.toLocaleString()} / ${quota.limit?.toLocaleString()} tokens`
    } else if (quota.limit && utilizationPercent >= thresholds.warnPercent) {
      warning = `Approaching quota: ${utilizationPercent.toFixed(1)}% used`
    }

    if (thresholds.maxCostUSD && quota.costUSD >= thresholds.maxCostUSD) {
      warning = `Cost threshold exceeded: $${quota.costUSD.toFixed(2)} / $${thresholds.maxCostUSD}`
    }

    return {
      providerID,
      used: quota.used,
      limit: quota.limit,
      remaining,
      utilizationPercent,
      costUSD: quota.costUSD,
      resetAt: quota.resetAt,
      resetInMs,
      warning,
      exceeded,
    }
  }

  /**
   * Set quota limit for a provider
   */
  export function setLimit(providerID: string, limit: number, resetAt?: number): void {
    const entry = state.get(providerID)

    if (entry) {
      entry.quota.limit = limit
      entry.quota.resetAt = resetAt
    } else {
      state.set(providerID, {
        quota: {
          providerID,
          used: 0,
          limit,
          resetAt,
          costUSD: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
        history: [],
      })
    }

    log.info("quota limit set", {
      providerID,
      limit,
      resetAt,
    })
  }

  /**
   * Get token usage history for a provider
   */
  export function getHistory(providerID: string, options?: {
    sessionID?: string
    since?: number
    limit?: number
  }): TokenUsage[] {
    const entry = state.get(providerID)

    if (!entry) return []

    let history = [...entry.history]

    if (options?.sessionID) {
      history = history.filter((h) => h.sessionID === options.sessionID)
    }

    if (options?.since) {
      history = history.filter((h) => h.timestamp >= options.since!)
    }

    if (options?.limit) {
      history = history.slice(-options.limit)
    }

    return history
  }

  /**
   * Get all provider quotas
   */
  export function getAllStatuses(): Map<string, QuotaStatus> {
    const result = new Map<string, QuotaStatus>()

    for (const providerID of state.keys()) {
      result.set(providerID, getStatus(providerID))
    }

    return result
  }

  /**
   * Reset quota for a provider
   */
  export function reset(providerID: string): void {
    const entry = state.get(providerID)

    if (entry) {
      const limit = entry.quota.limit
      const resetAt = entry.quota.resetAt
      state.set(providerID, {
        quota: {
          providerID,
          used: 0,
          limit,
          resetAt,
          costUSD: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
        history: [],
      })

      log.info("quota reset", { providerID })
    }
  }

  /**
   * Get usage summary for a session
   */
  export function getSessionUsage(sessionID: string): {
    totalTokens: number
    totalCostUSD: number
    providers: Array<{
      providerID: string
      tokens: number
      costUSD: number
    }>
  } {
    const providers: Array<{
      providerID: string
      tokens: number
      costUSD: number
    }> = []

    let totalTokens = 0
    let totalCostUSD = 0

    for (const [providerID, entry] of state.entries()) {
      const sessionHistory = entry.history.filter((h) => h.sessionID === sessionID)
      const tokens = sessionHistory.reduce(
        (sum, h) => sum + h.inputTokens + h.outputTokens,
        0
      )
      const costUSD = sessionHistory.reduce((sum, h) => sum + h.costUSD, 0)

      if (tokens > 0) {
        providers.push({ providerID, tokens, costUSD })
        totalTokens += tokens
        totalCostUSD += costUSD
      }
    }

    return {
      totalTokens,
      totalCostUSD,
      providers,
    }
  }

  /**
   * Clear all quota data
   */
  export function clear(): void {
    state.clear()
    log.info("quota data cleared")
  }
}

export const Event = {
  QuotaWarning: BusEvent.define(
    "quota.warning",
    z.object({
      providerID: z.string(),
      status: z.object({
        providerID: z.string(),
        used: z.number(),
        limit: z.number().optional(),
        utilizationPercent: z.number(),
        costUSD: z.number(),
        warning: z.string().optional(),
        exceeded: z.boolean(),
      }),
      reason: z.enum(["limit_exceeded", "threshold_approaching", "cost_threshold"]),
    }),
  ),
  QuotaExceeded: BusEvent.define(
    "quota.exceeded",
    z.object({
      providerID: z.string(),
      status: z.object({
        providerID: z.string(),
        used: z.number(),
        limit: z.number().optional(),
        utilizationPercent: z.number(),
        costUSD: z.number(),
        warning: z.string().optional(),
        exceeded: z.boolean(),
      }),
      reason: z.enum(["limit_exceeded", "threshold_approaching", "cost_threshold"]),
    }),
  ),
}
