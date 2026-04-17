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
    latencyBreakdown.length = 0
    modelPerfEntries.length = 0
  }

  // ─── Latency breakdown ──────────────────────────────────────────────────

  interface LatencyEntry {
    sessionID: string
    phase: "llm" | "tool" | "db" | "compaction"
    durationMs: number
    ts: number
  }

  const MAX_LATENCY = 500
  const latencyBreakdown: LatencyEntry[] = []

  /** Record a phase-level latency entry for breakdown analysis. */
  export function recordLatency(sessionID: string, phase: LatencyEntry["phase"], durationMs: number) {
    if (latencyBreakdown.length >= MAX_LATENCY) latencyBreakdown.shift()
    latencyBreakdown.push({ sessionID, phase, durationMs, ts: Date.now() })
  }

  /** Get latency breakdown summary per phase. */
  export function latencySummary(sessionID?: string) {
    const entries = sessionID
      ? latencyBreakdown.filter(e => e.sessionID === sessionID)
      : latencyBreakdown

    const phases: Record<string, { count: number; totalMs: number; maxMs: number }> = {}
    for (const e of entries) {
      const p = phases[e.phase] ?? { count: 0, totalMs: 0, maxMs: 0 }
      p.count++
      p.totalMs += e.durationMs
      p.maxMs = Math.max(p.maxMs, e.durationMs)
      phases[e.phase] = p
    }

    const result: Record<string, { count: number; avgMs: number; maxMs: number; totalMs: number }> = {}
    for (const [phase, s] of Object.entries(phases)) {
      result[phase] = {
        count: s.count,
        avgMs: s.count ? Math.round(s.totalMs / s.count) : 0,
        maxMs: s.maxMs,
        totalMs: s.totalMs,
      }
    }
    return result
  }

  /** Top N slowest tools by average execution time. */
  export function slowestTools(n = 5): Array<{ tool: string } & ToolStats> {
    return Object.entries(metrics().tools)
      .map(([tool, stats]) => ({ tool, ...stats }))
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, n)
  }

  // ─── Model performance comparison ─────────────────────────────────────────

  interface ModelPerfEntry {
    providerID: string
    modelID: string
    latencyMs: number
    inputTokens: number
    outputTokens: number
    tokensPerSec: number
    error?: string
    ts: number
  }

  const MAX_MODEL_PERF = 200
  const modelPerfEntries: ModelPerfEntry[] = []

  /** Record a model invocation's performance. */
  export function recordModelPerf(input: {
    providerID: string
    modelID: string
    latencyMs: number
    inputTokens: number
    outputTokens: number
    error?: string
  }) {
    if (modelPerfEntries.length >= MAX_MODEL_PERF) modelPerfEntries.shift()
    const tokensPerSec = input.latencyMs > 0
      ? Math.round((input.outputTokens / input.latencyMs) * 1000)
      : 0
    modelPerfEntries.push({
      ...input,
      tokensPerSec,
      ts: Date.now(),
    })
  }

  export interface ModelPerfSummary {
    providerID: string
    modelID: string
    invocations: number
    errors: number
    errorRate: number
    avgLatencyMs: number
    p95LatencyMs: number
    avgTokensPerSec: number
    totalInputTokens: number
    totalOutputTokens: number
  }

  /** Get per-model performance comparison summary. */
  export function modelPerf(): ModelPerfSummary[] {
    const map = new Map<string, ModelPerfEntry[]>()
    for (const e of modelPerfEntries) {
      const key = `${e.providerID}:${e.modelID}`
      const arr = map.get(key) ?? []
      arr.push(e)
      map.set(key, arr)
    }

    const results: ModelPerfSummary[] = []
    for (const [, entries] of map) {
      const first = entries[0]
      const errors = entries.filter(e => e.error).length
      const latencies = entries.map(e => e.latencyMs).sort((a, b) => a - b)
      const p95idx = Math.min(Math.floor(latencies.length * 0.95), latencies.length - 1)
      results.push({
        providerID: first.providerID,
        modelID: first.modelID,
        invocations: entries.length,
        errors,
        errorRate: entries.length ? errors / entries.length : 0,
        avgLatencyMs: Math.round(entries.reduce((s, e) => s + e.latencyMs, 0) / entries.length),
        p95LatencyMs: latencies[p95idx],
        avgTokensPerSec: Math.round(entries.reduce((s, e) => s + e.tokensPerSec, 0) / entries.length),
        totalInputTokens: entries.reduce((s, e) => s + e.inputTokens, 0),
        totalOutputTokens: entries.reduce((s, e) => s + e.outputTokens, 0),
      })
    }

    return results.sort((a, b) => b.avgTokensPerSec - a.avgTokensPerSec)
  }
}
