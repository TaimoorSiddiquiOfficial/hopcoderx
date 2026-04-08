/**
 * Pricing cache — tracks per-model token costs + session budgets.
 *
 * Usage:
 *   PricingCache.record({ provider, model, inputTokens, outputTokens })
 *   PricingCache.sessionSummary(sessionId)
 *   PricingCache.totals()
 */

import { join } from "path"
import { Global } from "../global"

export interface UsageRecord {
  ts: number
  sessionId: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** USD cost */
  estimatedCost: number
}

// Static pricing data (USD per 1M tokens) for popular models.
// Missing models default to 0 (free / unknown).
const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead?: number }> = {
  // Anthropic
  "claude-opus-4-5":      { input: 15.0,   output: 75.0,   cacheRead: 1.5  },
  "claude-sonnet-4-5":    { input: 3.0,    output: 15.0,   cacheRead: 0.3  },
  "claude-haiku-3-5":     { input: 0.8,    output: 4.0,    cacheRead: 0.08 },
  // OpenAI
  "gpt-4o":               { input: 2.5,    output: 10.0                     },
  "gpt-4o-mini":          { input: 0.15,   output: 0.6                      },
  "gpt-4-turbo":          { input: 10.0,   output: 30.0                     },
  "o1":                   { input: 15.0,   output: 60.0                     },
  "o1-mini":              { input: 1.1,    output: 4.4                      },
  // Google
  "gemini-2.5-pro":       { input: 1.25,   output: 10.0                     },
  "gemini-1.5-pro":       { input: 3.5,    output: 10.5                     },
  "gemini-1.5-flash":     { input: 0.075,  output: 0.3                      },
  // DeepSeek
  "deepseek-chat":        { input: 0.14,   output: 0.28                     },
  "deepseek-reasoner":    { input: 0.55,   output: 2.19                     },
  // Groq
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79                   },
  // Mistral
  "mistral-large-latest": { input: 2.0,    output: 6.0                      },
  "codestral-latest":     { input: 0.2,    output: 0.6                      },
}

function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
): number {
  // Try exact match first, then prefix match
  const key = Object.keys(MODEL_PRICING).find(
    (k) => model === k || model.startsWith(k) || k.startsWith(model.split("@")[0]),
  )
  if (!key) return 0
  const p = MODEL_PRICING[key]
  const inputCost   = (inputTokens    / 1_000_000) * p.input
  const outputCost  = (outputTokens   / 1_000_000) * p.output
  const cacheCost   = (cacheReadTokens / 1_000_000) * (p.cacheRead ?? 0)
  return inputCost + outputCost + cacheCost
}

function logPath(): string {
  return join(Global.Path.data, "pricing.jsonl")
}

export const PricingCache = {
  /** Record a usage event. Call this after each LLM response. */
  record(params: {
    sessionId: string
    provider: string
    model: string
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }): UsageRecord {
    const inputTokens       = params.inputTokens       ?? 0
    const outputTokens      = params.outputTokens      ?? 0
    const cacheReadTokens   = params.cacheReadTokens   ?? 0
    const cacheWriteTokens  = params.cacheWriteTokens  ?? 0
    const estimatedCost = estimateCost(params.model, inputTokens, outputTokens, cacheReadTokens)
    const rec: UsageRecord = {
      ts: Date.now(),
      sessionId: params.sessionId,
      provider: params.provider,
      model: params.model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      estimatedCost,
    }
    try {
      const fs = require("fs") as typeof import("fs")
      fs.mkdirSync(Global.Path.data, { recursive: true })
      fs.appendFileSync(logPath(), JSON.stringify(rec) + "\n", "utf8")
    } catch { /* non-fatal */ }
    return rec
  },

  /** Read all records from the pricing log. */
  all(): UsageRecord[] {
    try {
      const fs = require("fs") as typeof import("fs")
      const raw = fs.readFileSync(logPath(), "utf8")
      return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as UsageRecord)
    } catch {
      return []
    }
  },

  /** Aggregate cost / tokens for a specific session. */
  sessionSummary(sessionId: string): {
    totalCost: number
    inputTokens: number
    outputTokens: number
    turns: number
  } {
    const recs = this.all().filter((r) => r.sessionId === sessionId)
    return {
      totalCost:    recs.reduce((s, r) => s + r.estimatedCost, 0),
      inputTokens:  recs.reduce((s, r) => s + r.inputTokens, 0),
      outputTokens: recs.reduce((s, r) => s + r.outputTokens, 0),
      turns: recs.length,
    }
  },

  /** Global totals across all sessions. */
  totals(): {
    totalCost: number
    inputTokens: number
    outputTokens: number
    turns: number
    byModel: Record<string, { cost: number; turns: number }>
    byProvider: Record<string, { cost: number; turns: number }>
  } {
    const recs = this.all()
    const byModel: Record<string, { cost: number; turns: number }> = {}
    const byProvider: Record<string, { cost: number; turns: number }> = {}
    for (const r of recs) {
      const m = (byModel[r.model] ??= { cost: 0, turns: 0 })
      m.cost += r.estimatedCost; m.turns++
      const p = (byProvider[r.provider] ??= { cost: 0, turns: 0 })
      p.cost += r.estimatedCost; p.turns++
    }
    return {
      totalCost:    recs.reduce((s, r) => s + r.estimatedCost, 0),
      inputTokens:  recs.reduce((s, r) => s + r.inputTokens, 0),
      outputTokens: recs.reduce((s, r) => s + r.outputTokens, 0),
      turns: recs.length,
      byModel,
      byProvider,
    }
  },

  /** Alert if session cost exceeds a budget (USD). Returns null if no budget set or under limit. */
  budgetAlert(sessionId: string, budgetUSD: number): string | null {
    const { totalCost } = this.sessionSummary(sessionId)
    if (totalCost >= budgetUSD) {
      return `⚠ Session cost $${totalCost.toFixed(4)} has reached budget limit of $${budgetUSD.toFixed(2)}`
    }
    return null
  },
}
