/**
 * Lightweight structured telemetry for HopCoderX.
 *
 * Tracks tool execution latency, agent loop iterations, and session lifetime
 * without requiring an external OpenTelemetry collector. Metrics are kept in
 * memory and can be read via Telemetry.metrics() or cleared via Telemetry.flush().
 */
export namespace Telemetry {
  // ─── Types ────────────────────────────────────────────────────────────────

  export interface SpanRecord {
    name: string
    startMs: number
    endMs?: number
    durationMs?: number
    error?: string
    attributes: Record<string, string | number | boolean>
  }

  export interface ToolStats {
    calls: number
    errors: number
    errorRate: number
    avgMs: number
    totalMs: number
  }

  export interface SessionStats {
    sessionID: string
    startMs: number
    steps: number
    toolCalls: number
    errors: number
  }

  export interface Metrics {
    tools: Record<string, ToolStats>
    sessions: SessionStats[]
    recentSpans: SpanRecord[]
  }

  // ─── State ────────────────────────────────────────────────────────────────

  const MAX_SPANS = 1000
  const recentSpans: SpanRecord[] = []

  const toolStats = new Map<string, { calls: number; errors: number; totalMs: number }>()
  const activeSessions = new Map<string, { startMs: number; steps: number; toolCalls: number; errors: number }>()

  // ─── Spans ────────────────────────────────────────────────────────────────

  export interface Span {
    end(error?: string): void
    setAttribute(key: string, value: string | number | boolean): void
  }

  /** Start a named span. Call span.end() when done. */
  export function startSpan(name: string, attributes: Record<string, string | number | boolean> = {}): Span {
    const record: SpanRecord = { name, startMs: Date.now(), attributes: { ...attributes } }
    if (recentSpans.length >= MAX_SPANS) recentSpans.shift()
    recentSpans.push(record)
    return {
      end(error?: string) {
        record.endMs = Date.now()
        record.durationMs = record.endMs - record.startMs
        if (error) record.error = error
      },
      setAttribute(key, value) {
        record.attributes[key] = value
      },
    }
  }

  // ─── Tool telemetry ───────────────────────────────────────────────────────

  /** Record the result of a single tool call. */
  export function recordToolCall(toolId: string, durationMs: number, error?: string) {
    const s = toolStats.get(toolId) ?? { calls: 0, errors: 0, totalMs: 0 }
    s.calls++
    s.totalMs += durationMs
    if (error) s.errors++
    toolStats.set(toolId, s)
  }

  // ─── Session telemetry ────────────────────────────────────────────────────

  /** Mark a session as started. */
  export function sessionStart(sessionID: string) {
    activeSessions.set(sessionID, { startMs: Date.now(), steps: 0, toolCalls: 0, errors: 0 })
  }

  /** Increment the loop-step counter for a session. */
  export function sessionStep(sessionID: string) {
    const s = activeSessions.get(sessionID)
    if (s) s.steps++
  }

  /** Record a tool call within a session. */
  export function sessionToolCall(sessionID: string, error?: string) {
    const s = activeSessions.get(sessionID)
    if (!s) return
    s.toolCalls++
    if (error) s.errors++
  }

  /** Mark a session as ended and remove it from the active map. */
  export function sessionEnd(sessionID: string) {
    activeSessions.delete(sessionID)
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  /** Return a snapshot of all collected metrics. */
  export function metrics(): Metrics {
    const tools: Record<string, ToolStats> = {}
    for (const [id, s] of toolStats) {
      tools[id] = {
        calls: s.calls,
        errors: s.errors,
        errorRate: s.calls ? s.errors / s.calls : 0,
        avgMs: s.calls ? Math.round(s.totalMs / s.calls) : 0,
        totalMs: s.totalMs,
      }
    }
    const sessions: SessionStats[] = []
    for (const [sessionID, s] of activeSessions) {
      sessions.push({ sessionID, ...s })
    }
    return { tools, sessions, recentSpans: recentSpans.slice(-50) }
  }

  /** Clear all collected telemetry. */
  export function flush() {
    recentSpans.length = 0
    toolStats.clear()
    activeSessions.clear()
  }
}
