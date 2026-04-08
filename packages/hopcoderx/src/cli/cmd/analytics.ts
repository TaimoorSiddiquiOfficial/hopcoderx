import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { AuditLog } from "../../audit/audit"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"
import path from "path"

export const AnalyticsCommand = cmd({
  command: "analytics",
  describe: "show usage analytics: sessions, token usage, cost, tools",
  builder: (yargs: Argv) =>
    yargs
      .option("days", {
        type: "number",
        default: 7,
        describe: "Number of days to analyze",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output as JSON",
      })
      .option("top", {
        type: "number",
        default: 10,
        describe: "Number of top items to show per category",
      }),
  handler: async (args: { days?: number; json?: boolean; top?: number }) => {
    const days = args.days ?? 7
    const jsonOut = args.json ?? false
    const top = args.top ?? 10
    const sinceMs = days * 24 * 60 * 60 * 1000

    // Gather audit log stats
    const logStats = AuditLog.stats(sinceMs)
    const recentEntries = AuditLog.tail(1000)

    // Count sessions (unique sessionIDs)
    const sessionIds = new Set(recentEntries.map((e) => e.sessionID).filter(Boolean))
    const sessionCount = sessionIds.size

    // Count tool executions
    const toolCounts: Record<string, number> = {}
    const toolErrors: Record<string, number> = {}
    const agentCounts: Record<string, number> = {}
    let totalTokens = 0
    let totalCostUsd = 0

    for (const entry of recentEntries) {
      if (!entry.timestamp || entry.timestamp < new Date(Date.now() - sinceMs).toISOString()) continue

      if (entry.tool) {
        toolCounts[entry.tool] = (toolCounts[entry.tool] ?? 0) + 1
        if (entry.result === "error") toolErrors[entry.tool] = (toolErrors[entry.tool] ?? 0) + 1
      }
      if (entry.agent) {
        agentCounts[entry.agent] = (agentCounts[entry.agent] ?? 0) + 1
      }

      const tokens = (entry.args as any)?.tokens as number | undefined
      const cost = (entry.args as any)?.cost as number | undefined
      if (tokens) totalTokens += tokens
      if (cost) totalCostUsd += cost
    }

    // Also try to gather session-level stats from session files
    const sessionStats = await gatherSessionStats(days)

    const data = {
      period: `Last ${days} days`,
      sessions: {
        total: Math.max(sessionCount, sessionStats.sessionCount),
        avgDurationMin: sessionStats.avgDurationMin,
        totalMessages: sessionStats.totalMessages,
      },
      tokens: {
        total: Math.max(totalTokens, sessionStats.totalTokens),
        input: sessionStats.inputTokens,
        output: sessionStats.outputTokens,
      },
      cost: {
        totalUsd: Math.max(totalCostUsd, sessionStats.totalCostUsd),
        avgPerSession: sessionStats.sessionCount > 0 ? sessionStats.totalCostUsd / sessionStats.sessionCount : 0,
      },
      tools: {
        topByUsage: sortedTop(toolCounts, top),
        errorRates: Object.entries(toolErrors)
          .filter(([k]) => toolCounts[k])
          .map(([k, v]) => ({ tool: k, errors: v, total: toolCounts[k] ?? 0, rate: v / (toolCounts[k] ?? 1) }))
          .sort((a, b) => b.rate - a.rate)
          .slice(0, top),
      },
      agents: {
        topByUsage: sortedTop(agentCounts, top),
      },
      providers: sessionStats.providerUsage,
    }

    if (jsonOut) {
      console.log(JSON.stringify(data, null, 2))
      return
    }

    // Human-readable output
    console.log(`\n\x1b[1m📊 HopCoderX Usage Analytics — ${data.period}\x1b[0m\n`)

    // Sessions
    console.log("\x1b[1m Sessions\x1b[0m")
    console.log(`   Total:          ${data.sessions.total}`)
    console.log(`   Messages:       ${data.sessions.totalMessages}`)
    if (data.sessions.avgDurationMin > 0) {
      console.log(`   Avg duration:   ${data.sessions.avgDurationMin.toFixed(1)} min`)
    }

    // Tokens & Cost
    console.log("\n\x1b[1m Tokens\x1b[0m")
    console.log(`   Total:          ${fmtNum(data.tokens.total)}`)
    if (data.tokens.input) console.log(`   Input:          ${fmtNum(data.tokens.input)}`)
    if (data.tokens.output) console.log(`   Output:         ${fmtNum(data.tokens.output)}`)

    if (data.cost.totalUsd > 0) {
      console.log("\n\x1b[1m Cost\x1b[0m")
      console.log(`   Total:          $${data.cost.totalUsd.toFixed(4)}`)
      if (data.cost.avgPerSession > 0) {
        console.log(`   Per session:    $${data.cost.avgPerSession.toFixed(4)}`)
      }
    }

    // Top tools
    if (data.tools.topByUsage.length > 0) {
      console.log("\n\x1b[1m Top Tools\x1b[0m")
      const maxCount = data.tools.topByUsage[0]?.count ?? 1
      for (const { name, count } of data.tools.topByUsage) {
        const bar = "█".repeat(Math.round((count / maxCount) * 20))
        const pct = ((count / logStats.total) * 100).toFixed(0)
        console.log(`   ${name.padEnd(20)} ${bar.padEnd(20)} ${count} (${pct}%)`)
      }
    }

    // Top agents
    if (data.agents.topByUsage.length > 0) {
      console.log("\n\x1b[1m Agents\x1b[0m")
      for (const { name, count } of data.agents.topByUsage) {
        console.log(`   ${name.padEnd(20)} ${count}`)
      }
    }

    // Providers
    if (data.providers.length > 0) {
      console.log("\n\x1b[1m Providers Used\x1b[0m")
      for (const { provider, calls } of data.providers.slice(0, top)) {
        console.log(`   ${provider.padEnd(20)} ${calls} calls`)
      }
    }

    console.log()
  },
})

function sortedTop(counts: Record<string, number>, n: number): Array<{ name: string; count: number }> {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }))
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return String(n)
}

interface SessionStats {
  sessionCount: number
  totalMessages: number
  avgDurationMin: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  totalCostUsd: number
  providerUsage: Array<{ provider: string; calls: number }>
}

async function gatherSessionStats(days: number): Promise<SessionStats> {
  const result: SessionStats = {
    sessionCount: 0,
    totalMessages: 0,
    avgDurationMin: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalCostUsd: 0,
    providerUsage: [],
  }

  const sessionsDir = path.join(Global.Path.data, "sessions")
  const exists = await Filesystem.exists(sessionsDir)
  if (!exists) return result

  let files: string[]
  try {
    files = (require("fs")).readdirSync(sessionsDir).filter((f: string) => f.endsWith(".jsonl"))
  } catch {
    return result
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const providerMap: Record<string, number> = {}
  const durations: number[] = []

  for (const file of files) {
    const filePath = path.join(sessionsDir, file)
    try {
      const stat = (require("fs")).statSync(filePath)
      if (stat.mtimeMs < cutoff.getTime()) continue

      const content = await Filesystem.readText(filePath)
      const events = content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l: string) => {
          try { return JSON.parse(l) } catch { return null }
        })
        .filter(Boolean)

      if (events.length === 0) continue
      result.sessionCount++
      result.totalMessages += events.filter((e: any) => e.type === "message").length

      // Gather token usage from events
      for (const event of events) {
        const usage = event.usage ?? event.metadata?.usage
        if (usage) {
          result.inputTokens += usage.promptTokens ?? usage.input_tokens ?? 0
          result.outputTokens += usage.completionTokens ?? usage.output_tokens ?? 0
          result.totalTokens += (usage.promptTokens ?? usage.input_tokens ?? 0) + (usage.completionTokens ?? usage.output_tokens ?? 0)
          result.totalCostUsd += usage.cost ?? 0
        }
        const provider = event.providerID ?? event.provider
        if (provider) {
          providerMap[provider] = (providerMap[provider] ?? 0) + 1
        }
      }

      // Duration from first to last timestamp
      const timestamps = events
        .map((e: any) => e.timestamp)
        .filter(Boolean)
        .map((t: string) => new Date(t).getTime())
        .filter((t: number) => !isNaN(t))
      if (timestamps.length >= 2) {
        const duration = (Math.max(...timestamps) - Math.min(...timestamps)) / 60000
        durations.push(duration)
      }
    } catch {
      // skip unreadable session
    }
  }

  if (durations.length > 0) {
    result.avgDurationMin = durations.reduce((a, b) => a + b, 0) / durations.length
  }

  result.providerUsage = Object.entries(providerMap)
    .sort((a, b) => b[1] - a[1])
    .map(([provider, calls]) => ({ provider, calls }))

  return result
}
