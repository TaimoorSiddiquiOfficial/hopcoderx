# Token/Cost Tracking

## Overview

HopCoderX now includes comprehensive token/cost tracking with quota management and OpenTelemetry export capabilities.

## Features

### 1. Quota Tracker

Tracks token usage and costs across providers with:
- Per-provider quota limits
- Utilization thresholds with warnings (80% warn, 100% block)
- Cost estimation in USD
- Reset time tracking
- TUI toast notifications

### 2. OpenTelemetry Exporter

Exports telemetry data to OTLP-compatible backends:
- HTTP OTLP exporter (generic)
- Jaeger, Zipkin support
- Prometheus metrics
- Configurable export intervals
- Batch exports for efficiency

## Configuration

### Quota Tracking

```typescript
export default defineConfig({
  telemetry: {
    quota: {
      warnPercent: 80,        // Warn at 80% utilization
      blockPercent: 100,      // Block at 100% utilization
      maxCostUSD: 10,         // Warn when cost exceeds $10
    },
  },
})
```

### OpenTelemetry

```typescript
export default defineConfig({
  telemetry: {
    openTelemetry: {
      enabled: true,
      endpoint: "http://localhost:4318/v1/traces",
      protocol: "http",
      serviceName: "hopcoderx",
      apiKey: "your-api-key",  // Optional
      exportIntervalMs: 30000, // 30 seconds
      tracing: true,
      metrics: true,
    },
  },
})
```

## QuotaTracker API

### `track(usage)`

Record token usage for a provider.

```typescript
QuotaTracker.track({
  providerID: "anthropic",
  sessionID: "session-123",
  inputTokens: 1000,
  outputTokens: 500,
  cacheHitTokens: 200,
  cacheMissTokens: 100,
  costUSD: 0.015,
})
```

### `getStatus(providerID)`

Get current quota status.

```typescript
const status = QuotaTracker.getStatus("anthropic")
console.log(`Used: ${status.used}, Limit: ${status.limit}`)
console.log(`Utilization: ${status.utilizationPercent}%`)
console.log(`Cost: $${status.costUSD}`)
if (status.warning) console.log(status.warning)
```

### `setLimit(providerID, limit, resetAt?)`

Set quota limit for a provider.

```typescript
QuotaTracker.setLimit("anthropic", 100000, Date.now() + 24 * 60 * 60 * 1000)
```

### `getHistory(providerID, options?)`

Get token usage history.

```typescript
const history = QuotaTracker.getHistory("anthropic", {
  sessionID: "session-123",
  since: Date.now() - 24 * 60 * 60 * 1000,
  limit: 100,
})
```

### `getSessionUsage(sessionID)`

Get usage summary for a session.

```typescript
const usage = QuotaTracker.getSessionUsage("session-123")
console.log(`Total tokens: ${usage.totalTokens}`)
console.log(`Total cost: $${usage.totalCostUSD}`)
for (const provider of usage.providers) {
  console.log(`${provider.providerID}: ${provider.tokens} tokens, $${provider.costUSD}`)
}
```

### `reset(providerID)`

Reset quota for a provider.

```typescript
QuotaTracker.reset("anthropic")
```

## OpenTelemetryExporter API

### `init(config?)`

Initialize the exporter.

```typescript
await OpenTelemetryExporter.init({
  endpoint: "http://localhost:4318/v1/traces",
  serviceName: "hopcoderx",
})
```

### `recordSpan(span)`

Export a span.

```typescript
OpenTelemetryExporter.recordSpan({
  traceId: "abc123",
  spanId: "def456",
  name: "agent.run",
  kind: "INTERNAL",
  startTime: Date.now(),
  endTime: Date.now() + 1000,
  attributes: { sessionID: "123", model: "claude-sonnet" },
  status: "OK",
})
```

### `recordMetric(metric)`

Export a metric.

```typescript
OpenTelemetryExporter.recordMetric({
  name: "hopcoderx.tokens.used",
  type: "counter",
  value: 1500,
  timestamp: Date.now(),
  attributes: { provider: "anthropic" },
})
```

### `exportAll()`

Export all buffered data.

```typescript
await OpenTelemetryExporter.exportAll()
```

### `shutdown()`

Shutdown the exporter.

```typescript
await OpenTelemetryExporter.shutdown()
```

## Events

### `quota.warning`

Fired when approaching quota threshold.

```typescript
Bus.event.listen((event) => {
  if (event.type === "quota.warning") {
    console.log(`Warning: ${event.properties.status.warning}`)
  }
})
```

### `quota.exceeded`

Fired when quota is exceeded.

```typescript
Bus.event.listen((event) => {
  if (event.type === "quota.exceeded") {
    console.log(`Exceeded: ${event.properties.status.warning}`)
  }
})
```

## TUI Integration

Quota warnings and exceeded events automatically show as toast notifications in the TUI:
- **Warning** (yellow): Approaching quota limit
- **Exceeded** (red): Quota exceeded, action required

## Integration Points

1. **Session Processor**: Automatically tracks token usage after each step
2. **TUI**: Shows quota warnings via toast notifications
3. **Config**: Configurable thresholds and limits
4. **Bootstrap**: Auto-initialized on startup

## Example: Setting Provider Limits

```typescript
import { QuotaTracker } from "@hopcoderx/telemetry/quota"

// Set daily token limit
QuotaTracker.setLimit(
  "anthropic",
  100000,  // 100k tokens
  Date.now() + 24 * 60 * 60 * 1000  // Reset in 24 hours
)

// Set cost limit
QuotaTracker.setLimit(
  "openai",
  undefined,  // No token limit
  Date.now() + 24 * 60 * 60 * 1000
)
// Cost warning will trigger at maxCostUSD from config
```

## Example: Monitoring Dashboard

Query quota data for monitoring:

```typescript
// Get all provider statuses
const statuses = QuotaTracker.getAllStatuses()
for (const [providerID, status] of statuses.entries()) {
  console.log(`${providerID}: ${status.utilizationPercent.toFixed(1)}% used, $${status.costUSD.toFixed(4)}`)
}

// Get session usage
const sessionUsage = QuotaTracker.getSessionUsage(sessionID)
console.log(`Session ${sessionID}: ${sessionUsage.totalTokens} tokens, $${sessionUsage.totalCostUSD}`)
```

## Best Practices

1. **Set appropriate limits**: Base limits on your budget and typical usage patterns.

2. **Monitor regularly**: Check `getAllStatuses()` periodically or set up alerts via the event system.

3. **Use cost tracking**: Enable `maxCostUSD` to catch unexpected cost spikes.

4. **Export to observability**: Configure OpenTelemetry to export to your existing observability stack (Jaeger, Grafana, etc.).

5. **Reset on billing cycle**: Call `reset()` when your provider's billing cycle resets.

## OpenTelemetry Compatible Backends

| Backend | Endpoint | Notes |
|---------|----------|-------|
| Jaeger | `http://localhost:16686` | Use OTLP HTTP endpoint |
| Zipkin | `http://localhost:9411` | Via OpenTelemetry collector |
| Grafana Tempo | `http://localhost:3200` | Native OTLP support |
| Honeycomb | `https://api.honeycomb.io` | Requires API key |
| Lightstep | `https://ingest.lightstep.com` | Requires access token |
