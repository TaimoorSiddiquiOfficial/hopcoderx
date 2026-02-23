import { Hono } from 'hono'
import type { Context } from 'hono'
import { createHash } from 'crypto'
import { getSettings } from '../services/settings'
import { calculateCosts } from '../services/cost'
import { routeRequest } from '../services/router'
import { runInputGuardrails, runOutputGuardrails } from '../services/guardrails'
import { makeCacheKey, getFromCache, setToCache } from '../services/cache'
import type { ProviderConfig, ProviderType } from '../services/provider'
import { resolveAgent, applyAgentPreset } from './agents'
import type { ResolvedAgent } from './agents'

// loadProviders returns DB-configured providers, or falls back to CF AI Gateway compat
// endpoint so traffic always routes through your CF AI Gateway for observability/caching.
async function loadProviders(db: any, settings: Record<string, string>, env?: Env): Promise<ProviderConfig[]> {
  try {
    const { results } = await db.prepare(
      'SELECT id, name, provider, api_key_encrypted as api_key, base_url, weight, priority FROM provider_configs WHERE is_active = 1 ORDER BY priority ASC, weight DESC'
    ).all()
    if (results && results.length > 0) return results as ProviderConfig[]
  } catch { /* table may not exist yet */ }

  // Default: route through CF AI Gateway /compat endpoint.
  // Model format must include provider prefix: "openai/gpt-4o", "anthropic/claude-3-5-sonnet", etc.
  // Provider auth: set api_key on the provider record, or use BYOK/Unified Billing in CF Dashboard.
  const gatewayUrl = env?.CLOUDFLARE_GATEWAY_URL ||
    `https://gateway.ai.cloudflare.com/v1/${env?.CLOUDFLARE_ACCOUNT_ID ?? ''}/${env?.CLOUDFLARE_GATEWAY_ID ?? ''}`
  return [{
    id: 0,
    name: 'CF AI Gateway (default)',
    provider: 'cf-ai-gateway' as ProviderType,
    api_key: settings.openrouter_api_key || '',  // upstream provider key forwarded as Authorization: Bearer
    base_url: gatewayUrl,
    weight: 100,
    priority: 0,
  }]
}

function ipToNum(ip: string): number {
  return ip.split('.').reduce((n, o) => (n << 8) + parseInt(o), 0) >>> 0
}
function cidrMatch(ip: string, cidr: string): boolean {
  if (!cidr.includes('/')) return ip === cidr
  const [base, bits] = cidr.split('/')
  const mask = ~((1 << (32 - parseInt(bits))) - 1)
  return (ipToNum(ip) & mask) === (ipToNum(base) & mask)
}

// ── Shared chat handler ─────────────────────────────────────────────────────
// Registered on both /v1/chat/completions and /v1/agents/:slug/chat/completions.
// agentSlugHint is set when the slug comes from the URL path rather than a header.
async function chatHandler(
  c: Context<{ Bindings: Env }>,
  agentSlugHint?: string,
): Promise<Response> {
    const settings = await getSettings(c.env.DB)

    if (settings.maintenance_mode === '1') {
      return c.json({ error: 'Service temporarily unavailable (maintenance mode).' }, 503)
    }

    let apiKey = c.req.header('x-hopcoderx-key')
    if (!apiKey) {
      const auth = c.req.header('Authorization')
      if (auth?.startsWith('Bearer ')) apiKey = auth.slice(7)
    }
    if (!apiKey) return c.json({ error: 'Missing API key. Use x-hopcoderx-key or Authorization: Bearer <key>' }, 401)

    const keyHash = createHash('sha256').update(apiKey).digest('hex')

    let virtualKey: any = null
    try {
      virtualKey = await c.env.DB.prepare(
        `SELECT vk.*, pc.provider, pc.api_key_encrypted as vk_provider_key, pc.base_url as vk_base_url, pc.name as vk_provider_name
         FROM virtual_keys vk
         LEFT JOIN provider_configs pc ON vk.provider_config_id = pc.id
         WHERE vk.key_hash = ? AND vk.is_active = 1 AND (vk.expires_at IS NULL OR vk.expires_at > datetime('now'))`
      ).bind(keyHash).first()
    } catch { /* virtual_keys not yet migrated */ }

    const keyRecord = await c.env.DB.prepare(
      `SELECT ak.id, ak.user_id, ak.expires_at, ak.allowed_models, ak.max_budget_cents,
              ak.budget_period, ak.budget_start_at, ak.budget_used_cents, ak.rpm_limit, ak.tpm_limit,
              u.balance_cents, u.monthly_limit_cents, u.role, u.suspended
       FROM api_keys ak JOIN users u ON ak.user_id = u.id
       WHERE ak.key_hash = ? AND ak.is_active = 1`
    ).bind(keyHash).first<{
      id: number; user_id: string; balance_cents: number; monthly_limit_cents: number; role: string; suspended: number;
      expires_at: string | null; allowed_models: string | null; max_budget_cents: number;
      budget_period: string | null; budget_start_at: string | null; budget_used_cents: number;
      rpm_limit: number; tpm_limit: number;
    }>()

    if (!keyRecord && !virtualKey) return c.json({ error: 'Invalid API key' }, 401)
    if (keyRecord?.suspended) return c.json({ error: 'Account suspended. Contact admin.' }, 403)

    // Key expiry
    if (keyRecord?.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      return c.json({ error: 'API key has expired' }, 401)
    }

    // Per-key budget period reset
    if (keyRecord && keyRecord.budget_period && keyRecord.budget_start_at) {
      const periodMap: Record<string, number> = { '1d': 86400, '7d': 604800, '30d': 2592000 }
      const secs = periodMap[keyRecord.budget_period] || 0
      const elapsed = (Date.now() - new Date(keyRecord.budget_start_at).getTime()) / 1000
      if (secs > 0 && elapsed > secs) {
        c.env.DB.prepare(
          'UPDATE api_keys SET budget_used_cents = 0, budget_start_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).bind(keyRecord.id).run().catch(() => {})
        keyRecord.budget_used_cents = 0
      }
    }

    // Per-key max budget check
    if (keyRecord && keyRecord.max_budget_cents > 0 && keyRecord.budget_used_cents >= keyRecord.max_budget_cents) {
      return c.json({ error: 'API key budget exhausted', max_budget_cents: keyRecord.max_budget_cents, used_cents: keyRecord.budget_used_cents }, 402)
    }

    const userId = keyRecord?.user_id ?? virtualKey?.user_id
    const balance = keyRecord?.balance_cents ?? 0
    const monthlyLimit = virtualKey?.monthly_limit_cents || keyRecord?.monthly_limit_cents || 0

    if (settings.ip_allowlist?.trim()) {
      const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || ''
      const cidrs = settings.ip_allowlist.split(',').map((s: string) => s.trim()).filter(Boolean)
      if (cidrs.length && !cidrs.some(cidr => cidrMatch(clientIp, cidr))) {
        return c.json({ error: 'IP address not in allowlist' }, 403)
      }
    }

    const rateLimit = virtualKey?.rate_limit_per_min || (keyRecord?.rpm_limit && keyRecord.rpm_limit > 0 ? keyRecord.rpm_limit : null) || parseInt(settings.rate_limit_per_min || '60')
    const minuteAgo = new Date(Date.now() - 60000).toISOString()
    const rateCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM usage_logs WHERE user_id = ? AND created_at > ?'
    ).bind(userId, minuteAgo).first<{ count: number }>()
    if ((rateCount?.count || 0) >= rateLimit) {
      c.header('Retry-After', '60')
      return c.json({ error: `Rate limit exceeded (${rateLimit} req/min)`, retry_after: 60 }, 429)
    }

    // TPM (tokens-per-minute) enforcement
    if (keyRecord && keyRecord.tpm_limit > 0) {
      const tpmRow = await c.env.DB.prepare(
        'SELECT COALESCE(SUM(total_tokens),0) as tokens FROM usage_logs WHERE api_key_id=? AND created_at>?'
      ).bind(keyRecord.id, minuteAgo).first<{ tokens: number }>()
      if ((tpmRow?.tokens || 0) >= keyRecord.tpm_limit) {
        c.header('Retry-After', '60')
        c.header('X-RateLimit-Limit-Tokens', String(keyRecord.tpm_limit))
        c.header('X-RateLimit-Remaining-Tokens', '0')
        return c.json({ error: `Token rate limit exceeded (${keyRecord.tpm_limit} TPM)` }, 429)
      }
    }

    const rawBody = await c.req.json<{
      model: string; messages: any[]
      max_tokens?: number; temperature?: number; top_p?: number
      frequency_penalty?: number; presence_penalty?: number
      stop?: any; tools?: any[]; tool_choice?: any; stream?: boolean
    }>()
    if (!rawBody.model || !Array.isArray(rawBody.messages)) {
      return c.json({ error: 'Invalid request: model and messages are required' }, 400)
    }

    // ── Agent preset resolution ──────────────────────────────────────────────
    // Priority: URL slug param → x-hopcoderx-agent header → none
    const agentSlug = agentSlugHint ?? c.req.header('x-hopcoderx-agent') ?? null
    let preset: ResolvedAgent | null = null
    let agentId: number | null = null

    let body = rawBody
    if (agentSlug) {
      preset = await resolveAgent(c.env.DB, agentSlug)
      if (!preset) return c.json({ error: `Agent preset '${agentSlug}' not found or inactive` }, 404)
      const applied = applyAgentPreset(
        preset, body,
        keyRecord?.id ?? undefined,
        keyRecord?.user_id ?? virtualKey?.user_id ?? undefined,
      )
      if (applied.error) return c.json({ error: applied.error }, 403)
      body = applied.body
      agentId = preset.id
    }

    // Parse metadata and tag from request headers
    const requestMetadata = (() => { try { return JSON.parse(c.req.header('x-hopcoderx-metadata') || 'null') } catch { return null } })()
    const requestTag = c.req.header('x-hopcoderx-tag') || null

    // ── Step 1: Resolve model alias → real model_id ──────────────────────
    // Errors only caught for "table doesn't exist yet" case (migration not run locally)
    let resolvedModel = body.model
    const aliasRow = await c.env.DB.prepare(
      'SELECT model_id FROM model_aliases WHERE alias = ? AND is_active = 1'
    ).bind(body.model).first<{ model_id: string }>().catch(() => null)
    if (aliasRow?.model_id) resolvedModel = aliasRow.model_id

    // ── Step 2: Apply conditional routing rules ───────────────────────────
    // Checked after alias resolution so rules can match either alias OR resolved name.
    // First matching rule (lowest priority number) wins.
    let routingProviderOverride: number | null = null
    const rulesResult = await c.env.DB.prepare(
      'SELECT * FROM routing_rules WHERE is_active = 1 ORDER BY priority ASC LIMIT 20'
    ).all().catch(() => ({ results: [] as any[] }))

    for (const rule of (rulesResult.results as any[])) {
      let fieldVal: string | null = null

      if (rule.condition_field.startsWith('metadata.')) {
        const key = rule.condition_field.slice(9)
        const v = requestMetadata?.[key]
        fieldVal = v != null ? String(v) : null
      } else if (rule.condition_field === 'tag') {
        fieldVal = requestTag
      } else if (rule.condition_field === 'params.model') {
        // Match against BOTH the alias sent by client AND the resolved model name
        // so rules like "if model = openai/gpt-4o-mini" work whether sent directly or via alias
        fieldVal = resolvedModel
      }

      if (fieldVal === null) continue

      const evaluateOp = (val: string): boolean => {
        switch (rule.condition_op) {
          case 'eq':         return val === rule.condition_value
          case 'neq':        return val !== rule.condition_value
          case 'in':         return rule.condition_value.split(',').map((s: string) => s.trim()).includes(val)
          case 'startswith': return val.startsWith(rule.condition_value)
          case 'regex':      try { return new RegExp(rule.condition_value).test(val) } catch { return false }
          default:           return false
        }
      }

      // For params.model: also test the original alias name (body.model) so
      // rules targeting the alias string explicitly still fire
      const matched = evaluateOp(fieldVal) ||
        (rule.condition_field === 'params.model' && body.model !== resolvedModel && evaluateOp(body.model))

      if (matched) {
        if (rule.target_model) resolvedModel = rule.target_model
        if (rule.target_provider_id) routingProviderOverride = Number(rule.target_provider_id)
        break
      }
    }

    // Allowed-models check against the resolved model (supports aliases transparently)
    if (virtualKey?.allowed_models) {
      const allowed: string[] = JSON.parse(virtualKey.allowed_models)
      if (!allowed.includes(resolvedModel)) {
        return c.json({ error: `Model '${resolvedModel}' not permitted by this virtual key` }, 403)
      }
    }

    if (keyRecord?.allowed_models) {
      const allowed: string[] = JSON.parse(keyRecord.allowed_models)
      if (!allowed.includes(resolvedModel)) {
        return c.json({ error: `Model '${resolvedModel}' not permitted by this API key` }, 403)
      }
    }

    let model = await c.env.DB.prepare(
      'SELECT * FROM models WHERE model_id = ? AND is_active = 1'
    ).bind(resolvedModel).first<{ id: number; model_id: string; pricing_input_cents_per_m: number; pricing_output_cents_per_m: number }>()
    if (!model) return c.json({ error: `Model '${resolvedModel}' not found or inactive. GET /v1/models for available models.` }, 404)

    const maxTokensSetting = parseInt(settings.max_tokens_per_request || '0')
    const effectiveMaxTokens = maxTokensSetting > 0
      ? (body.max_tokens ? Math.min(body.max_tokens, maxTokensSetting) : maxTokensSetting)
      : body.max_tokens

    let messages = [...body.messages]
    if (settings.custom_system_prompt?.trim()) {
      const sysIdx = messages.findIndex((m: any) => m.role === 'system')
      if (sysIdx >= 0) {
        messages[sysIdx] = { ...messages[sysIdx], content: settings.custom_system_prompt + '\n\n' + messages[sysIdx].content }
      } else {
        messages = [{ role: 'system', content: settings.custom_system_prompt }, ...messages]
      }
    }

    const guardIn = runInputGuardrails(messages, settings)
    if (!guardIn.allowed) return c.json({ error: guardIn.reason || 'Request blocked by input guardrails' }, 400)
    messages = guardIn.messages

    const markupType = settings.markup_type || 'none'
    const markupValue = parseFloat(settings.markup_value || '0')

    const billingEnabled = settings.billing_enabled === '1'
    if (billingEnabled) {
      const { charged_cost_cents: minCost } = calculateCosts(model.pricing_input_cents_per_m, model.pricing_output_cents_per_m, 1000, 200, markupType, markupValue)
      if (balance < minCost) {
        return c.json({ error: 'Insufficient balance', balance_cents: balance, required_cents: minCost, top_up_url: '/dashboard' }, 402)
      }
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
      const spent = await c.env.DB.prepare(
        'SELECT COALESCE(SUM(cost_cents), 0) as total FROM usage_logs WHERE user_id = ? AND created_at >= ?'
      ).bind(userId, monthStart).first<{ total: number }>()
      if (monthlyLimit > 0 && (spent?.total || 0) >= monthlyLimit) {
        return c.json({ error: 'Monthly spending limit reached', monthly_limit_cents: monthlyLimit }, 429)
      }
    }

    const cacheEnabled = settings.cache_enabled === '1'
    const cacheTtl = parseInt(settings.cache_ttl_seconds || '300')
    // Cache key uses resolvedModel so aliases sharing the same target share cached responses
    const cacheKey = makeCacheKey(resolvedModel, messages)
    if (cacheEnabled && !body.stream) {
      const cached = await getFromCache((c.env as any).CACHE, cacheKey)
      if (cached) {
        c.env.DB.prepare(
          'INSERT INTO usage_logs (user_id, api_key_id, model, total_tokens, cost_cents, gateway_cache_hit, response_time_ms, provider) VALUES (?, ?, ?, 0, 0, 1, 0, ?)'
        ).bind(userId, keyRecord?.id ?? null, body.model, 'cache').run().catch(() => {})
        c.header('x-hopcoderx-cache', 'HIT')
        return cached
      }
    }

    let providers = await loadProviders(c.env.DB, settings, c.env)
    if (!providers.length) {
      return c.json({ error: 'No providers configured. Add a provider in Admin → Providers.' }, 503)
    }
    if (virtualKey?.vk_provider_key) {
      providers = [{
        id: virtualKey.provider_config_id ?? 0,
        name: virtualKey.vk_provider_name || 'virtual',
        provider: virtualKey.provider as ProviderType,
        api_key: virtualKey.vk_provider_key,
        base_url: virtualKey.vk_base_url ?? null,
        weight: 100, priority: 0,
      }]
    }

    // Apply routing rule provider pin (only when not already pinned by virtual key)
    if (routingProviderOverride && !virtualKey?.vk_provider_key) {
      const pinned = providers.filter(p => p.id === routingProviderOverride)
      if (!pinned.length) {
        return c.json({ error: `Routing rule target provider (id=${routingProviderOverride}) not found or inactive` }, 503)
      }
      providers = pinned
    }

    // ── Call upstream (with agent preset model fallback if configured) ────────
    const routeOpts = {
      messages,
      max_tokens: effectiveMaxTokens,
      temperature: body.temperature,
      top_p: body.top_p,
      frequency_penalty: body.frequency_penalty,
      presence_penalty: body.presence_penalty,
      stop: body.stop,
      tools: body.tools,
      tool_choice: body.tool_choice,
      stream: body.stream,
      retry_attempts: parseInt(settings.retry_attempts || '2'),
      timeout_ms: parseInt(settings.request_timeout_ms || '30000'),
      kv: (c.env as any).CACHE,
      cb_threshold: parseInt(settings.cb_failure_threshold || '5'),
      cb_cooldown_ms: parseInt(settings.cb_cooldown_ms || '60000'),
      env: c.env as unknown as Record<string, unknown>,
    }

    // Build the ordered model list: preset's main model → fallbacks → original resolvedModel
    const fallbackChain: string[] = preset?.fallback_models?.filter(m => m !== resolvedModel) ?? []
    const modelsToTry = [...new Set([resolvedModel, ...fallbackChain])]

    let result = await routeRequest(providers, { ...routeOpts, model: modelsToTry[0] })

    // If first attempt failed and we have fallbacks, try each in order
    if (!result.response.ok && modelsToTry.length > 1) {
      for (const fallbackModel of modelsToTry.slice(1)) {
        // Verify fallback model exists before attempting
        const fallbackRow = await c.env.DB.prepare(
          'SELECT model_id FROM models WHERE model_id = ? AND is_active = 1'
        ).bind(fallbackModel).first<{ model_id: string }>().catch(() => null)
        if (!fallbackRow) continue
        const fallbackResult = await routeRequest(providers, { ...routeOpts, model: fallbackModel }).catch(() => null)
        if (fallbackResult?.response.ok) {
          result = fallbackResult
          resolvedModel = fallbackModel
          // Re-fetch pricing for the model that actually handled the request
          const fallbackModelRecord = await c.env.DB.prepare(
            'SELECT * FROM models WHERE model_id = ? AND is_active = 1'
          ).bind(fallbackModel).first<typeof model>().catch(() => null)
          if (fallbackModelRecord) model = fallbackModelRecord
          break
        }
      }
    }

    const { response, provider_name, attempt_count, latency_ms } = result

    const extraHeaders: Record<string, string> = {
      'x-hopcoderx-provider': provider_name,
      'x-hopcoderx-attempts': String(attempt_count),
      'x-hopcoderx-latency': String(latency_ms),
      'x-hopcoderx-cache': 'MISS',
      'x-hopcoderx-resolved-model': resolvedModel,
      ...(resolvedModel !== body.model ? { 'x-hopcoderx-original-model': body.model } : {}),
      ...(agentId ? { 'x-hopcoderx-agent-id': String(agentId), 'x-hopcoderx-agent-slug': agentSlug! } : {}),
      'X-RateLimit-Limit-Requests': String(rateLimit),
      'X-RateLimit-Remaining-Requests': String(Math.max(0, rateLimit - (rateCount?.count || 0) - 1)),
      'X-RateLimit-Reset': '60',
      ...(keyRecord && keyRecord.tpm_limit > 0 ? { 'X-RateLimit-Limit-Tokens': String(keyRecord.tpm_limit) } : {}),
    }

    if (body.stream) {
      if (response.ok) {
        c.env.DB.prepare(
          'INSERT INTO usage_logs (user_id, api_key_id, model, total_tokens, cost_cents, response_time_ms, provider, metadata, tag, agent_id) VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?, ?)'
        ).bind(userId, keyRecord?.id ?? null, resolvedModel, latency_ms, provider_name, requestMetadata ? JSON.stringify(requestMetadata) : null, requestTag, agentId).run().catch(() => {})
        if (keyRecord) c.env.DB.prepare('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?').bind(keyRecord.id).run().catch(() => {})
      }
      const streamHeaders = new Headers(response.headers)
      for (const [k, v] of Object.entries(extraHeaders)) streamHeaders.set(k, v)
      return new Response(response.body, { status: response.status, headers: streamHeaders })
    }

    const responseText = await response.text()
    if (!response.ok) {
      return new Response(responseText, { status: response.status, headers: { 'Content-Type': 'application/json', ...extraHeaders } })
    }

    let responseData: any = {}
    try { responseData = JSON.parse(responseText) } catch { /* passthrough */ }

    const usage = responseData.usage || {}
    const promptT = usage.prompt_tokens || 0
    const completionT = usage.completion_tokens || 0
    const totalT = usage.total_tokens || (promptT + completionT)
    const { provider_cost_cents, charged_cost_cents } = calculateCosts(
      model.pricing_input_cents_per_m, model.pricing_output_cents_per_m,
      promptT, completionT, markupType, markupValue
    )

    const outContent = responseData.choices?.[0]?.message?.content || ''
    const guardOut = runOutputGuardrails(outContent, settings)
    if (!guardOut.allowed) return c.json({ error: guardOut.reason || 'Response blocked by output guardrails' }, 400)

    if (billingEnabled && charged_cost_cents > 0) {
      c.env.DB.prepare('UPDATE users SET balance_cents = balance_cents - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(charged_cost_cents, userId).run().catch(() => {})
    }

    // Increment per-key budget spend
    if (keyRecord && keyRecord.max_budget_cents > 0 && charged_cost_cents > 0) {
      c.env.DB.prepare(
        'UPDATE api_keys SET budget_used_cents = budget_used_cents + ?, budget_start_at = COALESCE(budget_start_at, CURRENT_TIMESTAMP) WHERE id = ?'
      ).bind(charged_cost_cents, keyRecord.id).run().catch(() => {})
    }

    c.env.DB.prepare(
      `INSERT INTO usage_logs (user_id, api_key_id, model, prompt_tokens, completion_tokens, total_tokens, cost_cents, provider_cost_cents, gateway_cache_hit, response_time_ms, provider, metadata, tag, agent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
    ).bind(userId, keyRecord?.id ?? null, resolvedModel, promptT, completionT, totalT, charged_cost_cents, provider_cost_cents, latency_ms, provider_name, requestMetadata ? JSON.stringify(requestMetadata) : null, requestTag, agentId)
      .run().catch(() => {})

    if (keyRecord) c.env.DB.prepare('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?').bind(keyRecord.id).run().catch(() => {})

    if (cacheEnabled && cacheTtl > 0) await setToCache((c.env as any).CACHE, cacheKey, responseText, cacheTtl)

    return new Response(responseText, { status: 200, headers: { 'Content-Type': 'application/json', ...extraHeaders } })
}

// ── Route factory ────────────────────────────────────────────────────────────
export function gatewayRoutes() {
  const app = new Hono<{ Bindings: Env }>()

  // Standard OpenAI-compatible endpoint; optionally selects an agent preset
  // via the x-hopcoderx-agent header.
  app.post('/chat/completions', (c) => chatHandler(c))

  // Dedicated per-agent endpoint — slug is embedded in the URL path so the
  // client doesn't need to know about headers at all.
  // Usage: POST /v1/agents/coder/chat/completions
  app.post('/agents/:slug/chat/completions', (c) => chatHandler(c, c.req.param('slug')))

  // Public: list all active public agent presets
  // Usage: GET /v1/agents
  app.get('/agents', async (c) => {
    const { results } = await c.env.DB.prepare(
      'SELECT id,slug,name,description,model,tags,sort_order,metadata FROM agent_presets WHERE is_active=1 AND is_public=1 ORDER BY sort_order ASC, name ASC',
    ).all()
    return c.json({
      object: 'list',
      data: (results || []).map((r: any) => ({
        ...r,
        tags: r.tags ? (() => { try { return JSON.parse(r.tags) } catch { return [] } })() : [],
        metadata: r.metadata ? (() => { try { return JSON.parse(r.metadata) } catch { return null } })() : null,
      })),
    })
  })

  app.get('/models', async (c) => {
    const { results } = await c.env.DB.prepare(
      'SELECT model_id, name, description, context_length, pricing_input_cents_per_m, pricing_output_cents_per_m FROM models WHERE is_active = 1 ORDER BY sort_order ASC, name ASC'
    ).all()
    return c.json({
      object: 'list',
      data: (results || []).map((m: any) => ({
        id: m.model_id, object: 'model', created: 0,
        owned_by: (m.model_id as string).split('/')[0] || 'hopcoderx',
        name: m.name, description: m.description, context_length: m.context_length,
        pricing: {
          prompt: (m.pricing_input_cents_per_m as number) / 100,
          completion: (m.pricing_output_cents_per_m as number) / 100,
        },
      })),
    })
  })

  return app
}
