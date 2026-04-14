/**
 * Audit & Compliance System for HopCoderX
 *
 * Features:
 *   - Append-only audit log (JSONL format)
 *   - Cryptographic hashing for event integrity
 *   - SOC2 compliance report generation
 *   - Query functionality with filters
 *   - Export to multiple formats
 *
 * Event Types:
 *   - session_start, session_end
 *   - tool_call, tool_result
 *   - model_call, model_result
 *   - policy_violation, policy_check
 *   - memory_read, memory_write
 *   - file_read, file_write, file_delete
 *   - command_exec, command_result
 *   - auth_event, config_change
 */

import z from "zod"
import { promises as fs } from "fs"
import path from "path"
import { createHash } from "crypto"
import { Global } from "../global"
import { Log } from "../util/log"
import yaml from "yaml"

const log = Log.create({ service: "audit" })

// ─── Types ────────────────────────────────────────────────────────────────────

export const AuditEventType = z.enum([
  "session_start",
  "session_end",
  "tool_call",
  "tool_result",
  "model_call",
  "model_result",
  "policy_violation",
  "policy_check",
  "memory_read",
  "memory_write",
  "file_read",
  "file_write",
  "file_delete",
  "command_exec",
  "command_result",
  "auth_event",
  "config_change",
  "macro_record",
  "macro_playback",
  "team_sync",
  "error",
])

export type AuditEventType = z.infer<typeof AuditEventType>

export const AuditEvent = z.object({
  id: z.string(),
  type: AuditEventType,
  timestamp: z.number(),
  sessionId: z.string().optional(),
  actor: z.object({
    type: z.enum(["user", "agent", "system"]),
    id: z.string(),
    name: z.string().optional(),
  }),
  action: z.string(),
  details: z.record(z.string(), z.any()).optional(),
  result: z.enum(["success", "failure", "denied"]).optional(),
  error: z.string().optional(),
  duration: z.number().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  previousHash: z.string().optional(),
  hash: z.string(),
})

export type AuditEvent = z.infer<typeof AuditEvent>

export const AuditQuery = z.object({
  startTime: z.number().optional(),
  endTime: z.number().optional(),
  types: z.array(AuditEventType).optional(),
  actorId: z.string().optional(),
  sessionId: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().default(100),
  offset: z.number().default(0),
})

export type AuditQuery = z.infer<typeof AuditQuery>

// ─── Audit Log Storage ────────────────────────────────────────────────────────

const AUDIT_LOG_FILE = () => path.join(Global.Path.data, "audit", "audit.jsonl")
const AUDIT_INDEX_FILE = () => path.join(Global.Path.data, "audit", "index.json")

export class AuditLog {
  private events: AuditEvent[] = []
  private lastHash: string | null = null
  private eventCount: number = 0

  /**
   * Initialize audit log
   */
  async init(): Promise<void> {
    await this.ensureDir()
    await this.loadIndex()
    log.info("audit log initialized", { eventCount: this.eventCount })
  }

  /**
   * Append event to audit log
   */
  async append(event: Omit<AuditEvent, "id" | "timestamp" | "hash" | "previousHash">): Promise<AuditEvent> {
    const id = this.generateId()
    const timestamp = Date.now()
    const previousHash = this.lastHash

    // Create event without hash first
    const eventWithoutHash: Omit<AuditEvent, "hash"> = {
      ...event,
      id,
      timestamp,
      previousHash: previousHash || undefined,
    }

    // Calculate hash
    const hash = this.calculateHash(eventWithoutHash)

    const fullEvent: AuditEvent = {
      ...eventWithoutHash,
      hash,
    }

    // Append to file (JSONL format)
    await this.appendToFile(fullEvent)

    // Update in-memory state
    this.events.push(fullEvent)
    this.lastHash = hash
    this.eventCount++

    // Update index periodically
    if (this.eventCount % 100 === 0) {
      await this.saveIndex()
    }

    log.debug("event appended", { type: event.type, action: event.action })

    return fullEvent
  }

  /**
   * Query audit log
   */
  async query(query: Partial<AuditQuery>): Promise<{
    events: AuditEvent[]
    total: number
    hasMore: boolean
  }> {
    const allEvents = await this.loadAllEvents()
    const filtered = this.filterEvents(allEvents, query)
    const total = filtered.length

    const offset = query.offset || 0
    const limit = query.limit || 100

    const paginated = filtered.slice(offset, offset + limit)

    return {
      events: paginated,
      total,
      hasMore: offset + limit < total,
    }
  }

  /**
   * Get event by ID
   */
  async getEvent(id: string): Promise<AuditEvent | null> {
    const events = await this.loadAllEvents()
    return events.find((e) => e.id === id) || null
  }

  /**
   * Verify event integrity
   */
  async verifyIntegrity(): Promise<{
    valid: boolean
    invalidEvents: Array<{ id: string; index: number; reason: string }>
    totalChecked: number
  }> {
    const events = await this.loadAllEvents()
    const invalidEvents: Array<{ id: string; index: number; reason: string }> = []

    let expectedPreviousHash: string | null = null

    for (let i = 0; i < events.length; i++) {
      const event = events[i]

      // Verify previous hash linkage
      if (event.previousHash !== expectedPreviousHash) {
        invalidEvents.push({
          id: event.id,
          index: i,
          reason: `Previous hash mismatch. Expected: ${expectedPreviousHash}, Got: ${event.previousHash}`,
        })
      }

      // Verify event hash
      const eventWithoutHash = { ...event }
      delete (eventWithoutHash as any).hash
      const calculatedHash = this.calculateHash(eventWithoutHash as unknown as Omit<AuditEvent, "hash">)

      if (calculatedHash !== event.hash) {
        invalidEvents.push({
          id: event.id,
          index: i,
          reason: `Event hash mismatch. Expected: ${calculatedHash}, Got: ${event.hash}`,
        })
      }

      expectedPreviousHash = event.hash
    }

    return {
      valid: invalidEvents.length === 0,
      invalidEvents,
      totalChecked: events.length,
    }
  }

  /**
   * Export audit log
   */
  async export(format: "json" | "csv" | "html" | "yaml", query?: Partial<AuditQuery>): Promise<string> {
    const { events } = await this.query(query || {})

    switch (format) {
      case "json":
        return JSON.stringify(events, null, 2)

      case "csv":
        return this.toCSV(events)

      case "html":
        return this.toHTML(events)

      case "yaml":
        return yaml.stringify(events)

      default:
        throw new Error(`Unsupported export format: ${format}`)
    }
  }

  /**
   * Generate SOC2 compliance report
   */
  async generateSOC2Report(period: { start: number; end: number }): Promise<{
    reportDate: string
    period: { start: string; end: string }
    summary: {
      totalEvents: number
      sessionCount: number
      toolCalls: number
      policyViolations: number
      errorCount: number
      averageSessionDuration: number
    }
    sections: {
      accessControl: { description: string; findings: string[]; status: "pass" | "fail" | "partial" }
      auditLogging: { description: string; findings: string[]; status: "pass" | "fail" | "partial" }
      dataProtection: { description: string; findings: string[]; status: "pass" | "fail" | "partial" }
      systemIntegrity: { description: string; findings: string[]; status: "pass" | "fail" | "partial" }
    }
    recommendations: string[]
  }> {
    const { events } = await this.query({
      startTime: period.start,
      endTime: period.end,
      limit: 100000,
    })

    // Calculate statistics
    const sessions = events.filter((e) => e.type === "session_start")
    const toolCalls = events.filter((e) => e.type === "tool_call")
    const policyViolations = events.filter((e) => e.type === "policy_violation")
    const errors = events.filter((e) => e.type === "error")

    // Calculate average session duration
    const sessionStarts = events.filter((e) => e.type === "session_start")
    const sessionEnds = events.filter((e) => e.type === "session_end")
    let totalDuration = 0
    let durationCount = 0

    for (const start of sessionStarts) {
      const end = sessionEnds.find((e) => e.sessionId === start.sessionId)
      if (end && start.timestamp && end.timestamp) {
        totalDuration += end.timestamp - start.timestamp
        durationCount++
      }
    }

    const integrityCheck = await this.verifyIntegrity()

    return {
      reportDate: new Date().toISOString(),
      period: {
        start: new Date(period.start).toISOString(),
        end: new Date(period.end).toISOString(),
      },
      summary: {
        totalEvents: events.length,
        sessionCount: sessions.length,
        toolCalls: toolCalls.length,
        policyViolations: policyViolations.length,
        errorCount: errors.length,
        averageSessionDuration: durationCount > 0 ? totalDuration / durationCount : 0,
      },
      sections: {
        accessControl: {
          description: "Controls that restrict access to authorized users",
          findings: [
            `Total sessions: ${sessions.length}`,
            `Auth events recorded: ${events.filter((e) => e.type === "auth_event").length}`,
            `Policy violations: ${policyViolations.length}`,
          ],
          status: policyViolations.length === 0 ? "pass" : "partial",
        },
        auditLogging: {
          description: "Systems maintain audit logs of all activities",
          findings: [
            `Total events logged: ${events.length}`,
            `Event integrity: ${integrityCheck.valid ? "Verified" : "Compromised"}`,
            `Events per session (avg): ${sessions.length > 0 ? Math.round(events.length / sessions.length) : 0}`,
          ],
          status: integrityCheck.valid ? "pass" : "fail",
        },
        dataProtection: {
          description: "Controls that protect data confidentiality and integrity",
          findings: [
            `File operations: ${events.filter((e) => e.type.startsWith("file_")).length}`,
            `Memory operations: ${events.filter((e) => e.type.startsWith("memory_")).length}`,
            `Denied operations: ${events.filter((e) => e.result === "denied").length}`,
          ],
          status: "pass",
        },
        systemIntegrity: {
          description: "Systems operate correctly and securely",
          findings: [
            `Error events: ${errors.length}`,
            `Error rate: ${events.length > 0 ? ((errors.length / events.length) * 100).toFixed(2) : 0}%`,
            `Hash chain integrity: ${integrityCheck.valid ? "Intact" : "Broken"}`,
          ],
          status: integrityCheck.valid && errors.length < events.length * 0.01 ? "pass" : "partial",
        },
      },
      recommendations: [
        ...(policyViolations.length > 0 ? ["Review and address policy violations"] : []),
        ...(errors.length > sessions.length * 0.1 ? ["Investigate high error rate"] : []),
        ...(!integrityCheck.valid ? ["Audit log integrity compromised - investigate immediately"] : []),
      ],
    }
  }

  /**
   * Get statistics
   */
  async getStats(timeRange?: { start: number; end: number }): Promise<{
    totalEvents: number
    eventsByType: Record<string, number>
    eventsByResult: Record<string, number>
    topActors: Array<{ id: string; count: number }>
    averageDuration: number
  }> {
    const { events } = await this.query({
      startTime: timeRange?.start,
      endTime: timeRange?.end,
      limit: 100000,
    })

    const eventsByType: Record<string, number> = {}
    const eventsByResult: Record<string, number> = {}
    const actorCounts: Record<string, number> = {}
    let totalDuration = 0
    let durationCount = 0

    for (const event of events) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1
      if (event.result) {
        eventsByResult[event.result] = (eventsByResult[event.result] || 0) + 1
      }
      actorCounts[event.actor.id] = (actorCounts[event.actor.id] || 0) + 1
      if (event.duration) {
        totalDuration += event.duration
        durationCount++
      }
    }

    const topActors = Object.entries(actorCounts)
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    return {
      totalEvents: events.length,
      eventsByType,
      eventsByResult,
      topActors,
      averageDuration: durationCount > 0 ? totalDuration / durationCount : 0,
    }
  }

  /**
   * Clear audit log
   */
  async clear(): Promise<void> {
    await fs.unlink(AUDIT_LOG_FILE()).catch(() => {})
    await fs.unlink(AUDIT_INDEX_FILE()).catch(() => {})

    this.events = []
    this.lastHash = null
    this.eventCount = 0

    log.info("audit log cleared")
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private async ensureDir(): Promise<void> {
    await fs.mkdir(path.join(Global.Path.data, "audit"), { recursive: true })
  }

  private generateId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }

  private calculateHash(event: Omit<AuditEvent, "hash">): string {
    const content = JSON.stringify(event, Object.keys(event).sort())
    return createHash("sha256").update(content).digest("hex")
  }

  private async appendToFile(event: AuditEvent): Promise<void> {
    const line = JSON.stringify(event) + "\n"
    await fs.appendFile(AUDIT_LOG_FILE(), line)
  }

  private async loadAllEvents(): Promise<AuditEvent[]> {
    try {
      const content = await fs.readFile(AUDIT_LOG_FILE(), "utf8")
      const lines = content.trim().split("\n").filter((line) => line.trim())
      return lines.map((line) => JSON.parse(line)).filter((e) => e && typeof e === "object")
    } catch {
      return []
    }
  }

  private async loadIndex(): Promise<void> {
    try {
      const index = JSON.parse(await fs.readFile(AUDIT_INDEX_FILE(), "utf8"))
      this.eventCount = index.eventCount || 0
      this.lastHash = index.lastHash || null
    } catch {
      this.eventCount = 0
      this.lastHash = null
    }
  }

  private async saveIndex(): Promise<void> {
    const index = {
      eventCount: this.eventCount,
      lastHash: this.lastHash,
      updatedAt: Date.now(),
    }
    await fs.writeFile(AUDIT_INDEX_FILE(), JSON.stringify(index, null, 2))
  }

  private filterEvents(events: AuditEvent[], query: Partial<AuditQuery>): AuditEvent[] {
    return events.filter((event) => {
      if (query.startTime && event.timestamp < query.startTime) return false
      if (query.endTime && event.timestamp > query.endTime) return false
      if (query.types && !query.types.includes(event.type)) return false
      if (query.actorId && event.actor.id !== query.actorId) return false
      if (query.sessionId && event.sessionId !== query.sessionId) return false
      if (query.search) {
        const searchLower = query.search.toLowerCase()
        const searchable = JSON.stringify(event).toLowerCase()
        if (!searchable.includes(searchLower)) return false
      }
      return true
    })
  }

  private toCSV(events: AuditEvent[]): string {
    const headers = ["id", "type", "timestamp", "sessionId", "actorId", "action", "result", "duration", "error"]
    const rows = [headers.join(",")]

    for (const event of events) {
      const row = [
        event.id,
        event.type,
        new Date(event.timestamp).toISOString(),
        event.sessionId || "",
        event.actor.id,
        event.action,
        event.result || "",
        event.duration?.toString() || "",
        event.error || "",
      ]
      rows.push(row.map((cell) => `"${cell}"`).join(","))
    }

    return rows.join("\n")
  }

  private toHTML(events: AuditEvent[]): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>HopCoderX Audit Log</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #4CAF50; color: white; }
    tr:nth-child(even) { background-color: #f2f2f2; }
    .success { color: green; }
    .failure { color: red; }
    .denied { color: orange; }
    h1 { color: #333; }
    .meta { color: #666; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>HopCoderX Audit Log</h1>
  <p class="meta">Generated: ${new Date().toISOString()} | Total Events: ${events.length}</p>
  <table>
    <thead>
      <tr>
        <th>Timestamp</th>
        <th>Type</th>
        <th>Actor</th>
        <th>Action</th>
        <th>Result</th>
        <th>Details</th>
      </tr>
    </thead>
    <tbody>
      ${events
        .map(
          (e) => `
        <tr>
          <td>${new Date(e.timestamp).toISOString()}</td>
          <td>${e.type}</td>
          <td>${e.actor.name || e.actor.id}</td>
          <td>${e.action}</td>
          <td class="${e.result || ""}">${e.result || "-"}</td>
          <td>${JSON.stringify(e.details || {}).slice(0, 50)}</td>
        </tr>
      `,
        )
        .join("")}
    </tbody>
  </table>
</body>
</html>
`.trim()
  }
}

// ─── Singleton Instance ───────────────────────────────────────────────────────

export const auditLog = new AuditLog()

// ─── Convenience Functions ────────────────────────────────────────────────────

export async function recordSessionStart(
  sessionId: string,
  userId: string,
  metadata?: Record<string, unknown>,
): Promise<AuditEvent> {
  return auditLog.append({
    type: "session_start",
    sessionId,
    actor: { type: "user", id: userId },
    action: "session_start",
    result: "success",
    details: metadata,
  })
}

export async function recordSessionEnd(
  sessionId: string,
  userId: string,
  duration?: number,
): Promise<AuditEvent> {
  return auditLog.append({
    type: "session_end",
    sessionId,
    actor: { type: "user", id: userId },
    action: "session_end",
    result: "success",
    duration,
  })
}

export async function recordToolCall(
  sessionId: string,
  actor: { type: string; id: string; name?: string },
  toolName: string,
  args?: Record<string, unknown>,
): Promise<AuditEvent> {
  return auditLog.append({
    type: "tool_call",
    sessionId,
    actor: actor as AuditEvent["actor"],
    action: `tool:${toolName}`,
    details: args ? { args } : undefined,
  })
}

export async function recordPolicyViolation(
  sessionId: string,
  actor: { type: string; id: string; name?: string },
  ruleId: string,
  reason: string,
): Promise<AuditEvent> {
  return auditLog.append({
    type: "policy_violation",
    sessionId,
    actor: actor as AuditEvent["actor"],
    action: "policy_violation",
    result: "denied",
    details: { ruleId },
    error: reason,
  })
}

export async function recordError(
  sessionId: string,
  actor: { type: string; id: string; name?: string },
  error: string,
  stack?: string,
): Promise<AuditEvent> {
  return auditLog.append({
    type: "error",
    sessionId,
    actor: actor as AuditEvent["actor"],
    action: "error",
    result: "failure",
    error,
    details: stack ? { stack } : undefined,
  })
}

// ─── CLI Command ──────────────────────────────────────────────────────────────

import { cmd } from "../cli/cmd/cmd"
import { UI } from "../cli/ui"
import * as prompts from "@clack/prompts"
import type { Argv } from "yargs"

export const AuditCommand = cmd({
  command: "audit <action>",
  describe: "View and export audit logs",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        choices: ["view", "export", "stats", "soc2", "verify"] as const,
        describe: "Action to perform",
      })
      .option("start", { type: "string", describe: "Start time (ISO format or timestamp)" })
      .option("end", { type: "string", describe: "End time (ISO format or timestamp)" })
      .option("type", { type: "string", describe: "Filter by event type" })
      .option("session", { type: "string", describe: "Filter by session ID" })
      .option("search", { type: "string", describe: "Search in event details" })
      .option("limit", { type: "number", default: 50, describe: "Max events to show" })
      .option("format", { type: "string", choices: ["json", "csv", "yaml", "html"], describe: "Export format" })
      .option("output", { type: "string", describe: "Output file path" }),
  async handler(args) {
    UI.empty()
    prompts.intro("Audit & Compliance")

    await auditLog.init()

    const action = args.action as string

    // Parse time range
    const parseTime = (value?: string): number | undefined => {
      if (!value) return undefined
      const parsed = Date.parse(value)
      return isNaN(parsed) ? undefined : parsed
    }

    const query: Partial<AuditQuery> = {
      startTime: parseTime(args.start as string),
      endTime: parseTime(args.end as string),
      limit: args.limit as number,
      search: args.search as string | undefined,
      sessionId: args.session as string | undefined,
    }

    if (args.type) {
      query.types = [args.type as AuditEventType]
    }

    switch (action) {
      case "view": {
        const { events, total, hasMore } = await auditLog.query(query)

        if (events.length === 0) {
          prompts.log.warn("No events found")
          break
        }

        prompts.log.info(`Found ${total} events${hasMore ? ` (showing ${events.length})` : ""}`)
        prompts.log.info("")

        for (const event of events) {
          const icon =
            event.result === "success" ? "✓" : event.result === "failure" ? "✗" : event.result === "denied" ? "🚫" : "•"
          const time = new Date(event.timestamp).toLocaleString()
          prompts.log.info(`${icon} [${time}] ${event.type}`)
          prompts.log.info(`  Actor: ${event.actor.name || event.actor.id} (${event.actor.type})`)
          prompts.log.info(`  Action: ${event.action}`)
          if (event.result) prompts.log.info(`  Result: ${event.result}`)
          if (event.error) prompts.log.error(`  Error: ${event.error}`)
          prompts.log.info("")
        }
        break
      }

      case "export": {
        const format = (args.format as string) || "json"
        const content = await auditLog.export(format as "json" | "csv" | "html" | "yaml", query)

        if (args.output) {
          await fs.writeFile(args.output as string, content)
          prompts.log.success(`Exported to ${args.output}`)
        } else {
          prompts.log.info(content.slice(0, 2000) + (content.length > 2000 ? "..." : ""))
        }
        break
      }

      case "stats": {
        const stats = await auditLog.getStats(query.startTime && query.endTime ? {
          start: query.startTime,
          end: query.endTime,
        } : undefined)

        prompts.log.info("Audit Log Statistics")
        prompts.log.info("")
        prompts.log.info(`Total Events: ${stats.totalEvents}`)
        prompts.log.info(`Average Duration: ${stats.averageDuration.toFixed(2)}ms`)
        prompts.log.info("")

        prompts.log.info("Events by Type:")
        for (const [type, count] of Object.entries(stats.eventsByType)) {
          prompts.log.info(`  ${type}: ${count}`)
        }

        prompts.log.info("")
        prompts.log.info("Top Actors:")
        for (const actor of stats.topActors) {
          prompts.log.info(`  ${actor.id}: ${actor.count} events`)
        }
        break
      }

      case "soc2": {
        const now = Date.now()
        const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

        const report = await auditLog.generateSOC2Report({
          start: query.startTime || thirtyDaysAgo,
          end: query.endTime || now,
        })

        prompts.log.info("SOC2 Compliance Report")
        prompts.log.info("")
        prompts.log.info(`Period: ${report.period.start} to ${report.period.end}`)
        prompts.log.info("")

        prompts.log.info("Summary:")
        prompts.log.info(`  Total Events: ${report.summary.totalEvents}`)
        prompts.log.info(`  Sessions: ${report.summary.sessionCount}`)
        prompts.log.info(`  Tool Calls: ${report.summary.toolCalls}`)
        prompts.log.info(`  Policy Violations: ${report.summary.policyViolations}`)
        prompts.log.info(`  Errors: ${report.summary.errorCount}`)
        prompts.log.info("")

        prompts.log.info("Compliance Sections:")
        for (const [key, section] of Object.entries(report.sections)) {
          const icon = section.status === "pass" ? "✓" : section.status === "fail" ? "✗" : "⚠"
          prompts.log.info(`${icon} ${key}: ${section.description}`)
          for (const finding of section.findings) {
            prompts.log.info(`    • ${finding}`)
          }
        }

        if (report.recommendations.length > 0) {
          prompts.log.warn("")
          prompts.log.warn("Recommendations:")
          for (const rec of report.recommendations) {
            prompts.log.warn(`  • ${rec}`)
          }
        }
        break
      }

      case "verify": {
        const { valid, invalidEvents, totalChecked } = await auditLog.verifyIntegrity()

        if (valid) {
          prompts.log.success(`Audit log integrity verified (${totalChecked} events checked)`)
        } else {
          prompts.log.error(`Integrity check failed: ${invalidEvents.length} invalid events found`)
          for (const invalid of invalidEvents.slice(0, 5)) {
            prompts.log.error(`  Event ${invalid.index}: ${invalid.id}`)
            prompts.log.error(`    ${invalid.reason}`)
          }
        }
        break
      }

      default:
        prompts.log.info("Usage: hopcoderx audit <view|export|stats|soc2|verify>")
    }

    prompts.outro("Done")
  },
})
