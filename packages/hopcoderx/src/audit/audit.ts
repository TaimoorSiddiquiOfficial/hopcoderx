import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import { randomUUID } from "crypto"
import { appendFileSync, existsSync, readFileSync, statSync, renameSync, mkdirSync, readdirSync } from "fs"

const log = Log.create({ service: "audit" })

export namespace AuditLog {
  export interface Entry {
    id: string
    timestamp: string
    sessionID?: string
    user?: string
    action: string
    agent?: string
    tool?: string
    args?: Record<string, unknown>
    result?: "success" | "error" | "denied"
    detail?: string
    project?: string
    durationMs?: number
  }

  const logPath = () => {
    const dir = Global.Path.config
    try { mkdirSync(dir, { recursive: true }) } catch {}
    return path.join(dir, "audit.jsonl")
  }

  /** Append a single audit entry (fire-and-forget) */
  export function record(entry: Omit<Entry, "id" | "timestamp">): void {
    const full: Entry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    }
    try {
      appendFileSync(logPath(), JSON.stringify(full) + "\n", "utf8")
    } catch (err) {
      log.warn("audit log write failed", { err: String(err) })
    }
  }

  /** Read last N entries from the audit log */
  export function tail(n = 50): Entry[] {
    const p = logPath()
    if (!existsSync(p)) return []
    try {
      const lines = readFileSync(p, "utf8").trim().split("\n").filter(Boolean)
      return lines.slice(-n).map((l) => JSON.parse(l) as Entry).reverse()
    } catch {
      return []
    }
  }

  /** Search entries by field value */
  export function search(
    filter: Partial<Pick<Entry, "action" | "agent" | "tool" | "result" | "sessionID">>,
  ): Entry[] {
    const p = logPath()
    if (!existsSync(p)) return []
    try {
      const entries = readFileSync(p, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => { try { return JSON.parse(l) as Entry } catch { return null } })
        .filter(Boolean) as Entry[]

      return entries.filter((e) => {
        for (const [k, v] of Object.entries(filter)) {
          if ((e as any)[k] !== v) return false
        }
        return true
      }).reverse()
    } catch {
      return []
    }
  }

  /** Get summary stats for a time window */
  export function stats(sinceMs = 24 * 60 * 60 * 1000): {
    total: number
    byAction: Record<string, number>
    byAgent: Record<string, number>
    byResult: Record<string, number>
    errors: number
  } {
    const since = new Date(Date.now() - sinceMs).toISOString()
    const p = logPath()
    if (!existsSync(p)) return { total: 0, byAction: {}, byAgent: {}, byResult: {}, errors: 0 }

    const entries = readFileSync(p, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l) as Entry } catch { return null } })
      .filter((e) => e && e.timestamp >= since) as Entry[]

    const byAction: Record<string, number> = {}
    const byAgent: Record<string, number> = {}
    const byResult: Record<string, number> = {}

    for (const e of entries) {
      byAction[e.action] = (byAction[e.action] ?? 0) + 1
      if (e.agent) byAgent[e.agent] = (byAgent[e.agent] ?? 0) + 1
      if (e.result) byResult[e.result] = (byResult[e.result] ?? 0) + 1
    }

    return { total: entries.length, byAction, byAgent, byResult, errors: byResult.error ?? 0 }
  }

  /** Rotate the log file if it exceeds maxBytes */
  export function rotate(maxBytes = 50 * 1024 * 1024): void {
    const p = logPath()
    if (!existsSync(p)) return
    try {
      const size = statSync(p).size
      if (size < maxBytes) return
      const rotated = p + "." + Date.now() + ".bak"
      renameSync(p, rotated)
      log.info("audit log rotated", { from: p, to: rotated, size })
    } catch (err) {
      log.warn("audit log rotation failed", { err: String(err) })
    }
  }
}

