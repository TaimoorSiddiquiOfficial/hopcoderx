/**
 * OpenTelemetry Exporter for HopCoderX
 *
 * Exports telemetry data to OpenTelemetry-compatible backends:
 * - HTTP OTLP exporter (generic)
 * - Jaeger
 * - Zipkin
 * - Prometheus (metrics)
 *
 * Inspired by:
 * - opencode-plugin-otel (OpenTelemetry exporter)
 */

import { Log } from "../util/log"
import { Config } from "../config/config"
import { Telemetry } from "./telemetry"

const log = Log.create({ service: "telemetry-otel" })

/**
 * OpenTelemetry configuration
 */
export interface OtelConfig {
  /** Exporter endpoint URL */
  endpoint: string
  /** Exporter protocol: 'http' | 'grpc' */
  protocol?: "http" | "grpc"
  /** Service name for traces */
  serviceName: string
  /** Optional API key/header */
  apiKey?: string
  /** Additional headers */
  headers?: Record<string, string>
  /** Export interval in ms */
  exportIntervalMs?: number
  /** Batch size for exports */
  batchSize?: number
  /** Enable/disable tracing */
  tracing?: boolean
  /** Enable/disable metrics */
  metrics?: boolean
}

/**
 * Span data for export
 */
interface OtelSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: "INTERNAL" | "SERVER" | "CLIENT" | "PRODUCER" | "CONSUMER"
  startTime: number
  endTime: number
  attributes: Record<string, string | number | boolean>
  status: "OK" | "ERROR"
  errorMessage?: string
}

/**
 * Metric data for export
 */
interface OtelMetric {
  name: string
  type: "counter" | "gauge" | "histogram"
  value: number
  timestamp: number
  attributes: Record<string, string | number | boolean>
}

const DEFAULT_CONFIG: OtelConfig = {
  endpoint: "http://localhost:4318/v1/traces",
  protocol: "http",
  serviceName: "hopcoderx",
  exportIntervalMs: 30000,
  batchSize: 100,
  tracing: true,
  metrics: true,
}

let config: OtelConfig | null = null
let exportTimer: NodeJS.Timeout | null = null
let spanBuffer: OtelSpan[] = []
let metricBuffer: OtelMetric[] = []
let initialized = false

export namespace OpenTelemetryExporter {
  /**
   * Initialize OpenTelemetry exporter
   */
  export async function init(cfg?: Partial<OtelConfig>): Promise<void> {
    if (initialized) {
      log.warn("OpenTelemetry exporter already initialized")
      return
    }

    const hopcoderxConfig = await Config.get()
    const otelConfig = hopcoderxConfig.telemetry?.openTelemetry

    if (!otelConfig?.enabled) {
      log.info("OpenTelemetry disabled in config")
      return
    }

    config = {
      ...DEFAULT_CONFIG,
      ...otelConfig,
      ...cfg,
    }

    log.info("OpenTelemetry exporter initialized", {
      endpoint: config.endpoint,
      serviceName: config.serviceName,
      protocol: config.protocol,
    })

    // Start periodic export
    if (config.exportIntervalMs) {
      exportTimer = setInterval(exportAll, config.exportIntervalMs)
    }

    initialized = true
  }

  /**
   * Export a span
   */
  export function recordSpan(span: OtelSpan): void {
    if (!initialized || !config?.tracing) return

    spanBuffer.push(span)

    if (spanBuffer.length >= (config?.batchSize ?? 100)) {
      exportSpans().catch((err) => {
        log.error("span export failed", { error: err })
      })
    }
  }

  /**
   * Record a metric
   */
  export function recordMetric(metric: OtelMetric): void {
    if (!initialized || !config?.metrics) return

    metricBuffer.push(metric)

    if (metricBuffer.length >= (config?.batchSize ?? 100)) {
      exportMetrics().catch((err) => {
        log.error("metric export failed", { error: err })
      })
    }
  }

  /**
   * Export all buffered data
   */
  export async function exportAll(): Promise<void> {
    await Promise.all([exportSpans(), exportMetrics()])
  }

  /**
   * Export spans to OTLP endpoint
   */
  async function exportSpans(): Promise<void> {
    if (spanBuffer.length === 0 || !config) return

    const spans = [...spanBuffer]
    spanBuffer = []

    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: { stringValue: config.serviceName },
              },
            ],
          },
          scopeSpans: [
            {
              scope: {
                name: "hopcoderx",
                version: "1.0.0",
              },
              spans: spans.map((span) => ({
                traceId: span.traceId,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId,
                name: span.name,
                kind: span.kind,
                startTimeUnixNano: span.startTime * 1e6,
                endTimeUnixNano: span.endTime * 1e6,
                attributes: Object.entries(span.attributes).map(([key, value]) => ({
                  key,
                  value: otelValue(value),
                })),
                status: {
                  code: span.status === "OK" ? 1 : 2,
                  message: span.errorMessage,
                },
              })),
            },
          ],
        },
      ],
    }

    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
          ...config.headers,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      })

      if (response.ok) {
        log.debug("spans exported", { count: spans.length })
      } else {
        const body = await response.text()
        log.error("span export failed", { status: response.status, body })
        // Re-add failed spans to buffer
        spanBuffer = [...spans, ...spanBuffer]
      }
    } catch (err) {
      log.error("span export error", {
        error: err instanceof Error ? err.message : String(err),
      })
      // Re-add failed spans to buffer
      spanBuffer = [...spans, ...spanBuffer]
    }
  }

  /**
   * Export metrics to OTLP endpoint
   */
  async function exportMetrics(): Promise<void> {
    if (metricBuffer.length === 0 || !config) return

    const metrics = [...metricBuffer]
    metricBuffer = []

    const payload = {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: { stringValue: config.serviceName },
              },
            ],
          },
          scopeMetrics: [
            {
              scope: {
                name: "hopcoderx",
                version: "1.0.0",
              },
              metrics: metrics.map((metric) => ({
                name: metric.name,
                data: {
                  [metric.type]: metricDataPoint(metric),
                },
              })),
            },
          ],
        },
      ],
    }

    try {
      const response = await fetch(config.endpoint.replace("/traces", "/metrics"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
          ...config.headers,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      })

      if (response.ok) {
        log.debug("metrics exported", { count: metrics.length })
      } else {
        const body = await response.text()
        log.error("metric export failed", { status: response.status, body })
        // Re-add failed metrics to buffer
        metricBuffer = [...metrics, ...metricBuffer]
      }
    } catch (err) {
      log.error("metric export error", {
        error: err instanceof Error ? err.message : String(err),
      })
      // Re-add failed metrics to buffer
      metricBuffer = [...metrics, ...metricBuffer]
    }
  }

  /**
   * Convert value to OTLP format
   */
  function otelValue(value: string | number | boolean): any {
    if (typeof value === "string") {
      return { stringValue: value }
    }
    if (typeof value === "number") {
      return { doubleValue: value }
    }
    if (typeof value === "boolean") {
      return { boolValue: value }
    }
    return { stringValue: String(value) }
  }

  /**
   * Create metric data point
   */
  function metricDataPoint(metric: OtelMetric): any {
    const point = {
      asInt: metric.type === "counter" ? Math.round(metric.value) : undefined,
      asDouble: metric.type === "gauge" || metric.type === "histogram" ? metric.value : undefined,
      timeUnixNano: metric.timestamp * 1e6,
      attributes: Object.entries(metric.attributes).map(([key, value]) => ({
        key,
        value: otelValue(value),
      })),
    }

    if (metric.type === "histogram") {
      // Simplified histogram - just record the value
      return {
        dataPoints: [point],
        aggregationTemporality: 2, // CUMULATIVE
      }
    }

    return {
      dataPoints: [point],
      aggregationTemporality: 2, // CUMULATIVE
    }
  }

  /**
   * Stop the exporter
   */
  export async function shutdown(): Promise<void> {
    if (exportTimer) {
      clearInterval(exportTimer)
      exportTimer = null
    }

    // Export remaining data
    await exportAll()

    spanBuffer = []
    metricBuffer = []
    initialized = false
    config = null

    log.info("OpenTelemetry exporter shutdown")
  }

  /**
   * Check if exporter is initialized
   */
  export function isInitialized(): boolean {
    return initialized
  }

  /**
   * Create a span from Telemetry span
   */
  export function createSpan(telemetrySpan: Telemetry.SpanRecord, traceId: string, spanId: string, parentSpanId?: string): OtelSpan {
    return {
      traceId,
      spanId,
      parentSpanId,
      name: telemetrySpan.name,
      kind: "INTERNAL",
      startTime: telemetrySpan.startMs,
      endTime: telemetrySpan.endMs ?? Date.now(),
      attributes: telemetrySpan.attributes,
      status: telemetrySpan.error ? "ERROR" : "OK",
      errorMessage: telemetrySpan.error,
    }
  }
}
