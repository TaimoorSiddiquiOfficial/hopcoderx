// Smart request router — weighted load balancing + fallback + retry + circuit breaker

import { callProvider, ProviderConfig, CallOptions } from './provider'
import { checkCircuit, recordFailure, recordSuccess } from './circuit_breaker'

export interface RouteResult {
  response: Response
  provider_id: number
  provider_name: string
  attempt_count: number
  latency_ms: number
  error?: string
}

export interface RouterOptions extends CallOptions {
  retry_attempts?: number
  timeout_ms?: number
  kv?: any                    // Cloudflare KV for circuit breaker state
  cb_threshold?: number       // failures before opening (default: 5)
  cb_cooldown_ms?: number     // cooldown before retry (default: 60s)
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}

// Weighted random selection within a group of providers
function pickWeighted(providers: ProviderConfig[]): ProviderConfig {
  const total = providers.reduce((s, p) => s + p.weight, 0)
  if (total === 0) return providers[0]
  let rand = Math.random() * total
  for (const p of providers) {
    rand -= p.weight
    if (rand <= 0) return p
  }
  return providers[providers.length - 1]
}

// Group providers by priority (lower = tried first)
function groupByPriority(providers: ProviderConfig[]): ProviderConfig[][] {
  const map = new Map<number, ProviderConfig[]>()
  for (const p of providers) {
    const arr = map.get(p.priority) ?? []
    arr.push(p)
    map.set(p.priority, arr)
  }
  return [...map.entries()].sort(([a], [b]) => a - b).map(([, v]) => v)
}

export async function routeRequest(
  providers: ProviderConfig[],
  opts: RouterOptions,
): Promise<RouteResult> {
  const active = providers.filter(p => p.weight > 0)
  if (!active.length) {
    return {
      response: new Response(JSON.stringify({ error: 'No providers configured. Add one in Admin → Providers.' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      }),
      provider_id: 0, provider_name: 'none', attempt_count: 0, latency_ms: 0,
      error: 'No active providers',
    }
  }

  const maxRetries = opts.retry_attempts ?? 2
  const timeoutMs = opts.timeout_ms ?? 30000
  const kv = opts.kv ?? null
  const cbThreshold = opts.cb_threshold ?? 5
  const cbCooldown = opts.cb_cooldown_ms ?? 60_000
  const groups = groupByPriority(active)
  let globalAttempt = 0
  let lastError = ''

  for (const group of groups) {
    const tried = new Set<number>()
    while (tried.size < group.length) {
      const remaining = group.filter(p => !tried.has(p.id))
      const provider = pickWeighted(remaining)
      tried.add(provider.id)

      // Circuit breaker check — skip this provider if circuit is open
      const { allowed } = await checkCircuit(kv, provider.id, cbThreshold, cbCooldown)
      if (!allowed) {
        lastError = `${provider.name} circuit open — skipping`
        continue
      }

      globalAttempt++
      const t0 = Date.now()
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        const response = await callProvider(provider, { ...opts, signal: controller.signal })
        clearTimeout(timer)
        const latency = Date.now() - t0

        // Retry on 5xx or 429 (upstream rate-limited), but pass 4xx back immediately
        if (response.status === 429 || response.status >= 500) {
          lastError = `${provider.name} → HTTP ${response.status}`
          await recordFailure(kv, provider.id, cbThreshold)
          if (globalAttempt <= maxRetries) await sleep(100 * Math.pow(2, globalAttempt - 1))
          continue
        }

        await recordSuccess(kv, provider.id)
        return { response, provider_id: provider.id, provider_name: provider.name, attempt_count: globalAttempt, latency_ms: latency }
      } catch (err: any) {
        lastError = `${provider.name} → ${err.message || 'timeout'}`
        await recordFailure(kv, provider.id, cbThreshold)
        if (globalAttempt <= maxRetries) await sleep(100 * Math.pow(2, globalAttempt - 1))
      }
    }
  }

  return {
    response: new Response(JSON.stringify({ error: 'All providers failed', details: lastError }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    }),
    provider_id: 0, provider_name: 'none', attempt_count: globalAttempt, latency_ms: 0,
    error: lastError,
  }
}
