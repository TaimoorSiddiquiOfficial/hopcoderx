/**
 * Per-session token cost tracking + `hopcoderx cost` CLI report.
 *
 * Tracks token usage and USD cost per session, model, and provider.
 * Data persists in SQLite at $XDG_CONFIG/hopcoderx/cost.db
 *
 * Commands:
 *   hopcoderx cost               — show cost summary for today
 *   hopcoderx cost --days 7      — last 7 days
 *   hopcoderx cost --session <id>— cost for a specific session
 *   hopcoderx cost --json        — machine-readable output
 *   hopcoderx cost clear         — wipe all cost history
 */

import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Global } from "../../global"
import { UI } from "../ui"
import path from "path"
import { existsSync } from "fs"
import { Database } from "bun:sqlite"

// ─── Cost DB ─────────────────────────────────────────────────────────────────

function openDb(): Database {
  const dbPath = path.join(Global.Path.config, "cost.db")
  const db = new Database(dbPath, { create: true })
  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      session_id TEXT,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ts ON cost_events(ts);
    CREATE INDEX IF NOT EXISTS idx_session ON cost_events(session_id);
  `)
  return db
}

export namespace CostTracker {
  export interface CostEvent {
    sessionId?: string
    model: string
    provider: string
    inputTokens: number
    outputTokens: number
    costUsd: number
  }

  export function record(event: CostEvent): void {
    try {
      const db = openDb()
      db.prepare(
        `INSERT INTO cost_events (ts, session_id, model, provider, input_tokens, output_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(Date.now(), event.sessionId ?? null, event.model, event.provider, event.inputTokens, event.outputTokens, event.costUsd)
      db.close()
    } catch {
      // non-fatal
    }
  }

  export interface CostSummary {
    totalInputTokens: number
    totalOutputTokens: number
    totalCostUsd: number
    sessionCount: number
    topModels: Array<{ model: string; costUsd: number; tokens: number }>
    topSessions: Array<{ sessionId: string; costUsd: number; tokens: number }>
    dailyBreakdown: Array<{ date: string; costUsd: number; tokens: number }>
  }

  export function query(opts: { days?: number; sessionId?: string } = {}): CostSummary {
    const db = openDb()
    const days = opts.days ?? 30
    const since = Date.now() - days * 86_400_000

    let where = "WHERE ts >= ?"
    const params: (number | string)[] = [since]
    if (opts.sessionId) {
      where += " AND session_id = ?"
      params.push(opts.sessionId)
    }

    const totals = db
      .prepare(
        `SELECT SUM(input_tokens) as inp, SUM(output_tokens) as out,
                SUM(cost_usd) as cost, COUNT(DISTINCT session_id) as sessions
         FROM cost_events ${where}`,
      )
      .get(...params) as { inp: number; out: number; cost: number; sessions: number } | null

    const topModels = db
      .prepare(
        `SELECT model, SUM(cost_usd) as costUsd, SUM(input_tokens+output_tokens) as tokens
         FROM cost_events ${where}
         GROUP BY model ORDER BY costUsd DESC LIMIT 10`,
      )
      .all(...params) as Array<{ model: string; costUsd: number; tokens: number }>

    const topSessions = db
      .prepare(
        `SELECT session_id as sessionId, SUM(cost_usd) as costUsd, SUM(input_tokens+output_tokens) as tokens
         FROM cost_events ${where} AND session_id IS NOT NULL
         GROUP BY session_id ORDER BY costUsd DESC LIMIT 10`,
      )
      .all(...params) as Array<{ sessionId: string; costUsd: number; tokens: number }>

    const dailyBreakdown = db
      .prepare(
        `SELECT date(ts/1000, 'unixepoch') as date, SUM(cost_usd) as costUsd, SUM(input_tokens+output_tokens) as tokens
         FROM cost_events ${where}
         GROUP BY date ORDER BY date DESC LIMIT ${days}`,
      )
      .all(...params) as Array<{ date: string; costUsd: number; tokens: number }>

    db.close()

    return {
      totalInputTokens: totals?.inp ?? 0,
      totalOutputTokens: totals?.out ?? 0,
      totalCostUsd: totals?.cost ?? 0,
      sessionCount: totals?.sessions ?? 0,
      topModels,
      topSessions,
      dailyBreakdown,
    }
  }

  export function clear(): void {
    const db = openDb()
    db.exec("DELETE FROM cost_events")
    db.close()
  }
}

// ─── CLI command ─────────────────────────────────────────────────────────────

export const CostCommand = cmd({
  command: "cost [action]",
  describe: "show per-session token cost report",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        type: "string",
        describe: "Action: clear (wipe cost history)",
        choices: ["clear"],
      })
      .option("days", {
        type: "number",
        default: 7,
        describe: "Number of days to include in report",
      })
      .option("session", {
        type: "string",
        describe: "Show cost for a specific session ID",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output as JSON",
      }),
  handler: async (args: { action?: string; days?: number; session?: string; json?: boolean }) => {
    if (args.action === "clear") {
      CostTracker.clear()
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓ Cost history cleared" + UI.Style.TEXT_NORMAL)
      return
    }

    const summary = CostTracker.query({ days: args.days ?? 7, sessionId: args.session })

    if (args.json) {
      UI.println(JSON.stringify(summary, null, 2))
      return
    }

    const days = args.days ?? 7
    const period = args.session ? `Session: ${args.session}` : `Last ${days} day${days === 1 ? "" : "s"}`

    UI.println(UI.Style.TEXT_INFO_BOLD + `\n💰 Cost Report — ${period}` + UI.Style.TEXT_NORMAL)
    UI.println("")
    UI.println(
      `  ${UI.Style.TEXT_NORMAL}Total cost:     ${UI.Style.TEXT_WARNING_BOLD}$${summary.totalCostUsd.toFixed(4)}${UI.Style.TEXT_NORMAL}`,
    )
    UI.println(`  Total tokens:   ${(summary.totalInputTokens + summary.totalOutputTokens).toLocaleString()}`)
    UI.println(`    Input:        ${summary.totalInputTokens.toLocaleString()}`)
    UI.println(`    Output:       ${summary.totalOutputTokens.toLocaleString()}`)
    UI.println(`  Sessions:       ${summary.sessionCount}`)

    if (summary.topModels.length > 0) {
      UI.println("")
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Top Models" + UI.Style.TEXT_NORMAL)
      for (const m of summary.topModels) {
        const bar = "█".repeat(Math.min(20, Math.round((m.costUsd / summary.totalCostUsd) * 20)))
        UI.println(`    ${m.model.padEnd(35)} $${m.costUsd.toFixed(4).padStart(8)}  ${UI.Style.TEXT_DIM}${bar}${UI.Style.TEXT_NORMAL}`)
      }
    }

    if (summary.dailyBreakdown.length > 0 && !args.session) {
      UI.println("")
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Daily Breakdown" + UI.Style.TEXT_NORMAL)
      for (const d of summary.dailyBreakdown.slice(0, 7)) {
        UI.println(
          `    ${d.date}   $${d.costUsd.toFixed(4).padStart(8)}   ${d.tokens.toLocaleString().padStart(10)} tokens`,
        )
      }
    }

    if (summary.topSessions.length > 0 && !args.session) {
      UI.println("")
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Top Sessions by Cost" + UI.Style.TEXT_NORMAL)
      for (const s of summary.topSessions.slice(0, 5)) {
        UI.println(`    ${s.sessionId.slice(0, 32).padEnd(34)} $${s.costUsd.toFixed(4).padStart(8)}`)
      }
    }

    UI.println("")
    UI.println(
      UI.Style.TEXT_DIM +
        `  Run ${UI.Style.TEXT_NORMAL}hopcoderx cost --days 30${UI.Style.TEXT_DIM} for a longer history, or ${UI.Style.TEXT_NORMAL}hopcoderx cost clear${UI.Style.TEXT_DIM} to reset.` +
        UI.Style.TEXT_NORMAL,
    )
  },
})
