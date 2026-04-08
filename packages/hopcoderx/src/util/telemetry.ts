/**
 * OpenTelemetry tracing + Prometheus /metrics endpoint.
 *
 * Usage:
 *   import { Telemetry } from "../util/telemetry"
 *   await Telemetry.init()
 *
 *   const span = Telemetry.startSpan("agent.run", { sessionID, model })
 *   // ... do work ...
 *   span.end()
 *
 *   // Start Prometheus metrics server (separate port)
 *   await Telemetry.startMetricsServer(9090)
 */

import { createServer } from "http"
import { Log } from "./log"

const log = Log.create({ service: "telemetry" })

// ─── Span / Trace types ──────────────────────────────────────────────────────

export interface SpanContext {
  traceId: string
  spanId: string
  parentSpanId?: string
}

export interface Span {
  context: SpanContext
  name: string
  startTime: number
  attributes: Record<string, string | number | boolean>
  end(errorMsg?: string): void
}

// ─── In-memory trace store ───────────────────────────────────────────────────

interface FinishedSpan extends Span {
  endTime: number
  durationMs: number
  status: "ok" | "error"
  error?: string
}

const MAX_SPANS = 2000
const finishedSpans: FinishedSpan[] = []

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// ─── Prometheus metrics ──────────────────────────────────────────────────────

interface Counter {
  name: string
  help: string
  labels: Record<string, number>
  inc(labelValues?: Record<string, string>, by?: number): void
}

interface Histogram {
  name: string
  help: string
  buckets: number[]
  observations: number[]
  sum: number
  count: number
  observe(value: number): void
}

const counters = new Map<string, Counter>()
const histograms = new Map<string, Histogram>()

function createCounter(name: string, help: string): Counter {
  const c: Counter = {
    name,
    help,
    labels: {},
    inc(labelValues?: Record<string, string>, by = 1) {
      const key = labelValues ? Object.entries(labelValues).map(([k, v]) => `${k}="${v}"`).join(",") : ""
      c.labels[key] = (c.labels[key] ?? 0) + by
    },
  }
  counters.set(name, c)
  return c
}

function createHistogram(name: string, help: string, buckets = [1, 5, 10, 50, 100, 500, 1000, 5000]): Histogram {
  const h: Histogram = {
    name,
    help,
    buckets,
    observations: [],
    sum: 0,
    count: 0,
    observe(value: number) {
      h.observations.push(value)
      h.sum += value
      h.count++
    },
  }
  histograms.set(name, h)
  return h
}

// Built-in metrics
export const Metrics = {
  agentRuns: createCounter("hopcoderx_agent_runs_total", "Total agent invocations"),
  toolCalls: createCounter("hopcoderx_tool_calls_total", "Total tool executions by tool name"),
  toolErrors: createCounter("hopcoderx_tool_errors_total", "Tool execution errors by tool name"),
  tokensUsed: createCounter("hopcoderx_tokens_used_total", "Total tokens consumed by model"),
  costUsd: createCounter("hopcoderx_cost_usd_total", "Total cost in USD by model"),
  agentLatency: createHistogram("hopcoderx_agent_latency_ms", "Agent turn latency in milliseconds"),
  toolLatency: createHistogram("hopcoderx_tool_latency_ms", "Tool execution latency in milliseconds"),
}

function renderPrometheus(): string {
  const lines: string[] = []

  for (const c of counters.values()) {
    lines.push(`# HELP ${c.name} ${c.help}`)
    lines.push(`# TYPE ${c.name} counter`)
    for (const [label, value] of Object.entries(c.labels)) {
      lines.push(label ? `${c.name}{${label}} ${value}` : `${c.name} ${value}`)
    }
    if (Object.keys(c.labels).length === 0) lines.push(`${c.name} 0`)
  }

  for (const h of histograms.values()) {
    lines.push(`# HELP ${h.name} ${h.help}`)
    lines.push(`# TYPE ${h.name} histogram`)
    const sorted = [...h.observations].sort((a, b) => a - b)
    let cumCount = 0
    for (const bucket of h.buckets) {
      while (cumCount < sorted.length && sorted[cumCount] <= bucket) cumCount++
      lines.push(`${h.name}_bucket{le="${bucket}"} ${cumCount}`)
    }
    lines.push(`${h.name}_bucket{le="+Inf"} ${h.count}`)
    lines.push(`${h.name}_sum ${h.sum}`)
    lines.push(`${h.name}_count ${h.count}`)
  }

  return lines.join("\n") + "\n"
}

// ─── Telemetry namespace ─────────────────────────────────────────────────────

let metricsServer: ReturnType<typeof createServer> | null = null
let otelExporterUrl: string | null = null
const exportQueue: FinishedSpan[] = []
let exportTimer: ReturnType<typeof setInterval> | null = null

export namespace Telemetry {
  export function init(opts?: { otlpEndpoint?: string }) {
    otelExporterUrl = opts?.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? null
    if (otelExporterUrl) {
      log.info("OTel exporter configured", { endpoint: otelExporterUrl })
      // Flush every 5 seconds
      exportTimer = setInterval(() => flushSpans(), 5000)
    }
  }

  export function startSpan(name: string, attributes: Record<string, string | number | boolean> = {}): Span {
    const traceId = randomHex(16)
    const spanId = randomHex(8)
    const startTime = Date.now()

    const span: FinishedSpan = {
      context: { traceId, spanId },
      name,
      startTime,
      endTime: 0,
      durationMs: 0,
      attributes,
      status: "ok",
      end(errorMsg?: string) {
        span.endTime = Date.now()
        span.durationMs = span.endTime - startTime
        span.status = errorMsg ? "error" : "ok"
        span.error = errorMsg
        if (finishedSpans.length >= MAX_SPANS) finishedSpans.shift()
        finishedSpans.push(span)
        if (otelExporterUrl) exportQueue.push(span)
      },
    }
    return span
  }

  export function getRecentSpans(limit = 100): FinishedSpan[] {
    return finishedSpans.slice(-limit)
  }

  export async function startMetricsServer(port = 9090): Promise<void> {
    if (metricsServer) return
    metricsServer = createServer((req, res) => {
      if (req.url === "/metrics" && req.method === "GET") {
        const body = renderPrometheus()
        res.writeHead(200, {
          "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
        })
        res.end(body)
      } else if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ status: "ok", spans: finishedSpans.length }))
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>((resolve, reject) => {
      metricsServer!.listen(port, () => {
        log.info(`Prometheus metrics server listening on :${port}/metrics`)
        resolve()
      })
      metricsServer!.on("error", reject)
    })
  }

  export async function stopMetricsServer(): Promise<void> {
    if (exportTimer) { clearInterval(exportTimer); exportTimer = null }
    await new Promise<void>((resolve) => metricsServer?.close(() => resolve()) ?? resolve())
    metricsServer = null
  }

  /** Export pending spans to OTLP endpoint */
  async function flushSpans(): Promise<void> {
    if (!otelExporterUrl || exportQueue.length === 0) return
    const batch = exportQueue.splice(0, 100)
    try {
      const resourceSpans = [{
        resource: { attributes: [{ key: "service.name", value: { stringValue: "hopcoderx" } }] },
        scopeSpans: [{
          scope: { name: "hopcoderx" },
          spans: batch.map((s) => ({
            traceId: s.context.traceId,
            spanId: s.context.spanId,
            name: s.name,
            startTimeUnixNano: String(s.startTime * 1_000_000),
            endTimeUnixNano: String(s.endTime * 1_000_000),
            attributes: Object.entries(s.attributes).map(([k, v]) => ({
              key: k,
              value: typeof v === "number" ? { doubleValue: v } : typeof v === "boolean" ? { boolValue: v } : { stringValue: String(v) },
            })),
            status: { code: s.status === "error" ? 2 : 0, message: s.error ?? "" },
          })),
        }],
      }]
      await fetch(`${otelExporterUrl}/v1/traces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceSpans }),
        signal: AbortSignal.timeout(5000),
      }).catch((err) => log.warn("OTLP export failed", { err: String(err) }))
    } catch (err) {
      log.warn("OTLP flush error", { err: String(err) })
    }
  }
}
