// Rich analytics service — used by admin and dashboard

export interface AnalyticsTotals {
  total_requests: number
  total_tokens: number
  total_cost_cents: number          // what we charged users (with markup)
  total_provider_cost_cents: number // what we paid providers (raw)
  total_profit_cents: number        // our margin = charged - provider cost
  profit_margin_pct: number         // (profit / charged) * 100
  active_users: number
  avg_latency_ms: number
  error_rate: number        // percentage 0-100
  cache_hit_rate: number    // percentage 0-100
}

export interface AnalyticsStats {
  totals: AnalyticsTotals
  top_models: { model: string; requests: number; tokens: number; cost_cents: number; provider_cost_cents: number; profit_cents: number }[]
  top_providers: { provider: string; requests: number; cost_cents: number; provider_cost_cents: number }[]
  daily: { date: string; requests: number; tokens: number; cost_cents: number; provider_cost_cents: number }[]
  recent: { created_at: string; email: string; model: string; total_tokens: number; cost_cents: number; provider_cost_cents: number; response_time_ms: number; provider: string; cache_hit: number }[]
  latency: { p50: number; p95: number; p99: number }
}

export async function getAnalytics(db: any, userId?: string, days = 30): Promise<AnalyticsStats> {
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const uf = userId ? 'AND ul.user_id = ?' : ''
  const bind1 = userId ? [since, userId] : [since]

  const [totR, modR, provR, dayR, recR, latR] = await Promise.all([
    // Totals (include provider_cost_cents for profit calculation)
    db.prepare(`
      SELECT
        COUNT(*) as total_requests,
        COALESCE(SUM(ul.total_tokens), 0) as total_tokens,
        COALESCE(SUM(ul.cost_cents), 0) as total_cost_cents,
        COALESCE(SUM(ul.provider_cost_cents), 0) as total_provider_cost_cents,
        COUNT(DISTINCT ul.user_id) as active_users,
        COALESCE(AVG(CASE WHEN ul.response_time_ms > 0 THEN ul.response_time_ms END), 0) as avg_latency_ms,
        ROUND(100.0 * SUM(CASE WHEN ul.cost_cents = 0 AND ul.total_tokens = 0 AND ul.gateway_cache_hit = 0 THEN 1 ELSE 0 END) / MAX(COUNT(*), 1), 1) as error_rate,
        ROUND(100.0 * SUM(ul.gateway_cache_hit) / MAX(COUNT(*), 1), 1) as cache_hit_rate
      FROM usage_logs ul WHERE ul.created_at >= ? ${uf}
    `).bind(...bind1).first(),

    // Top models with profit
    db.prepare(`
      SELECT model,
        COUNT(*) as requests,
        COALESCE(SUM(total_tokens), 0) as tokens,
        COALESCE(SUM(cost_cents), 0) as cost_cents,
        COALESCE(SUM(provider_cost_cents), 0) as provider_cost_cents,
        COALESCE(SUM(cost_cents), 0) - COALESCE(SUM(provider_cost_cents), 0) as profit_cents
      FROM usage_logs ul WHERE ul.created_at >= ? ${uf}
      GROUP BY model ORDER BY requests DESC LIMIT 10
    `).bind(...bind1).all(),

    // Provider breakdown with profit
    db.prepare(`
      SELECT COALESCE(provider, 'openrouter') as provider,
        COUNT(*) as requests,
        COALESCE(SUM(cost_cents), 0) as cost_cents,
        COALESCE(SUM(provider_cost_cents), 0) as provider_cost_cents
      FROM usage_logs ul WHERE ul.created_at >= ? ${uf}
      GROUP BY provider ORDER BY requests DESC
    `).bind(...bind1).all(),

    // Daily trend with profit
    db.prepare(`
      SELECT substr(created_at, 1, 10) as date,
        COUNT(*) as requests,
        COALESCE(SUM(total_tokens), 0) as tokens,
        COALESCE(SUM(cost_cents), 0) as cost_cents,
        COALESCE(SUM(provider_cost_cents), 0) as provider_cost_cents
      FROM usage_logs ul WHERE ul.created_at >= ? ${uf}
      GROUP BY date ORDER BY date ASC
    `).bind(...bind1).all(),

    // Recent requests with provider cost
    db.prepare(`
      SELECT ul.created_at, COALESCE(u.email, 'unknown') as email,
        ul.model, ul.total_tokens, ul.cost_cents,
        COALESCE(ul.provider_cost_cents, 0) as provider_cost_cents,
        COALESCE(ul.response_time_ms, 0) as response_time_ms,
        COALESCE(ul.provider, 'openrouter') as provider,
        ul.gateway_cache_hit as cache_hit
      FROM usage_logs ul
      LEFT JOIN users u ON ul.user_id = u.id
      WHERE ul.created_at >= ? ${uf}
      ORDER BY ul.created_at DESC LIMIT 25
    `).bind(...bind1).all(),

    // Latency percentiles via SQLite window-friendly query
    db.prepare(`
      SELECT
        (SELECT response_time_ms FROM usage_logs WHERE created_at >= ? ${uf ? 'AND user_id = ?' : ''} AND response_time_ms > 0 ORDER BY response_time_ms ASC LIMIT 1 OFFSET MAX(0, (SELECT COUNT(*) FROM usage_logs WHERE created_at >= ? ${uf ? 'AND user_id = ?' : ''} AND response_time_ms > 0) * 50 / 100 - 1)) as p50,
        (SELECT response_time_ms FROM usage_logs WHERE created_at >= ? ${uf ? 'AND user_id = ?' : ''} AND response_time_ms > 0 ORDER BY response_time_ms ASC LIMIT 1 OFFSET MAX(0, (SELECT COUNT(*) FROM usage_logs WHERE created_at >= ? ${uf ? 'AND user_id = ?' : ''} AND response_time_ms > 0) * 95 / 100 - 1)) as p95,
        (SELECT response_time_ms FROM usage_logs WHERE created_at >= ? ${uf ? 'AND user_id = ?' : ''} AND response_time_ms > 0 ORDER BY response_time_ms ASC LIMIT 1 OFFSET MAX(0, (SELECT COUNT(*) FROM usage_logs WHERE created_at >= ? ${uf ? 'AND user_id = ?' : ''} AND response_time_ms > 0) * 99 / 100 - 1)) as p99
    `).bind(...(userId
      ? [since, userId, since, userId, since, userId, since, userId, since, userId, since, userId]
      : [since, since, since, since, since, since]
    )).first(),
  ])

  const charged = (totR as any)?.total_cost_cents || 0
  const provCost = (totR as any)?.total_provider_cost_cents || 0
  const profit = charged - provCost

  return {
    totals: {
      total_requests: (totR as any)?.total_requests || 0,
      total_tokens: (totR as any)?.total_tokens || 0,
      total_cost_cents: charged,
      total_provider_cost_cents: provCost,
      total_profit_cents: profit,
      profit_margin_pct: charged > 0 ? Math.round((profit / charged) * 1000) / 10 : 0,
      active_users: (totR as any)?.active_users || 0,
      avg_latency_ms: Math.round((totR as any)?.avg_latency_ms || 0),
      error_rate: (totR as any)?.error_rate || 0,
      cache_hit_rate: (totR as any)?.cache_hit_rate || 0,
    },
    top_models: (modR as any).results || [],
    top_providers: (provR as any).results || [],
    daily: (dayR as any).results || [],
    recent: (recR as any).results || [],
    latency: {
      p50: (latR as any)?.p50 || 0,
      p95: (latR as any)?.p95 || 0,
      p99: (latR as any)?.p99 || 0,
    },
  }
}
