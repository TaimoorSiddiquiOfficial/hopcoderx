/**
 * Agent Presets — admin CRUD + shared helpers consumed by gateway.ts
 *
 * Admin endpoints (mounted at /api/admin/agents):
 *   GET    /all                   – list every preset (admin)
 *   GET    /:id                   – single preset (admin)
 *   POST   /                      – create (admin)
 *   PUT    /:id                   – full/partial update (admin)
 *   DELETE /:id                   – delete (admin)
 *   POST   /:id/toggle            – activate / deactivate
 *   POST   /:id/duplicate         – copy with a new slug
 *   GET    /:id/analytics         – usage stats for the preset
 *
 * Public endpoint (mounted at /v1/agents via index.ts):
 *   GET    /                      – list active public presets
 */
import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'

// ── Database row type ────────────────────────────────────────────────────────
type AgentRow = {
  id: number
  slug: string
  name: string
  description: string | null
  system_prompt: string | null
  system_prompt_mode: string
  model: string | null
  temperature: number | null
  max_tokens: number | null
  top_p: number | null
  frequency_penalty: number | null
  presence_penalty: number | null
  stop_sequences: string | null        // stored as JSON string
  tools: string | null                 // stored as JSON string
  tool_choice: string | null           // stored as JSON string or literal
  mcp_servers: string | null           // stored as JSON string
  fallback_models: string | null       // stored as JSON string
  allowed_key_ids: string | null       // stored as JSON string
  allowed_user_ids: string | null      // stored as JSON string
  tags: string | null                  // stored as JSON string
  metadata: string | null              // stored as JSON string
  is_active: number
  is_public: number
  sort_order: number
  created_by: string | null
  created_at: string
  updated_at: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function jsonOrNull(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v  // already serialised (from existing row)
  return JSON.stringify(v)
}

function parseOrNull<T>(s: string | null): T | null {
  if (!s) return null
  try { return JSON.parse(s) as T } catch { return null }
}

// ── Shared: resolve a preset by slug ────────────────────────────────────────
export async function resolveAgent(db: D1Database, slug: string) {
  const row = await db
    .prepare('SELECT * FROM agent_presets WHERE slug = ? AND is_active = 1')
    .bind(slug)
    .first<AgentRow>()
    .catch(() => null)
  if (!row) return null
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    system_prompt: row.system_prompt,
    system_prompt_mode: row.system_prompt_mode || 'prepend',
    model: row.model,
    temperature: row.temperature,
    max_tokens: row.max_tokens,
    top_p: row.top_p,
    frequency_penalty: row.frequency_penalty,
    presence_penalty: row.presence_penalty,
    stop_sequences: parseOrNull<string[]>(row.stop_sequences),
    tools: parseOrNull<any[]>(row.tools),
    tool_choice: (() => {
      if (!row.tool_choice) return null
      try { return JSON.parse(row.tool_choice) } catch { return row.tool_choice }
    })(),
    mcp_servers: parseOrNull<any[]>(row.mcp_servers),
    fallback_models: parseOrNull<string[]>(row.fallback_models),
    allowed_key_ids: parseOrNull<number[]>(row.allowed_key_ids),
    allowed_user_ids: parseOrNull<string[]>(row.allowed_user_ids),
  }
}

export type ResolvedAgent = NonNullable<Awaited<ReturnType<typeof resolveAgent>>>

// ── Shared: apply a preset's overrides to a request body ────────────────────
// Returns { body, error } — error is set when access is denied.
export function applyAgentPreset(
  preset: ResolvedAgent,
  body: {
    model: string
    messages: any[]
    temperature?: number
    max_tokens?: number
    top_p?: number
    frequency_penalty?: number
    presence_penalty?: number
    tools?: any[]
    tool_choice?: any
    stop?: any
    stream?: boolean
    [key: string]: unknown
  },
  keyId?: number,
  userId?: string,
): { body: typeof body; error?: string } {
  // Access control
  if (preset.allowed_key_ids && keyId != null && !preset.allowed_key_ids.includes(keyId)) {
    return { body, error: `API key not permitted to use agent preset '${preset.slug}'` }
  }
  if (preset.allowed_user_ids && userId && !preset.allowed_user_ids.includes(userId)) {
    return { body, error: `User not permitted to use agent preset '${preset.slug}'` }
  }

  const next = { ...body }

  // ── Model override ────────────────────────────────────────────────────────
  if (preset.model) next.model = preset.model

  // ── Generation parameters (preset wins over client) ───────────────────────
  if (preset.temperature   != null) next.temperature   = preset.temperature
  if (preset.max_tokens    != null) next.max_tokens    = preset.max_tokens
  if (preset.top_p         != null) next.top_p         = preset.top_p
  if (preset.frequency_penalty != null) next.frequency_penalty = preset.frequency_penalty
  if (preset.presence_penalty  != null) next.presence_penalty  = preset.presence_penalty
  if (preset.stop_sequences)            next.stop = preset.stop_sequences

  // ── Tools (preset tools merged first; client tools deduplicated after) ────
  if (preset.tools?.length) {
    const clientTools = (body.tools || []).filter(
      t => !preset.tools!.find(pt => pt.function?.name === t.function?.name),
    )
    next.tools = [...preset.tools, ...clientTools]
    if (preset.tool_choice != null) next.tool_choice = preset.tool_choice
  }

  // ── System prompt injection ───────────────────────────────────────────────
  if (preset.system_prompt) {
    const msgs = [...next.messages]
    const si = msgs.findIndex(m => m.role === 'system')
    const mode = preset.system_prompt_mode

    if (mode === 'replace') {
      if (si >= 0) msgs[si] = { role: 'system', content: preset.system_prompt }
      else msgs.unshift({ role: 'system', content: preset.system_prompt })
    } else if (mode === 'append') {
      if (si >= 0) msgs[si] = { ...msgs[si], content: msgs[si].content + '\n\n' + preset.system_prompt }
      else msgs.push({ role: 'system', content: preset.system_prompt })
    } else {
      // prepend (default)
      if (si >= 0) msgs[si] = { ...msgs[si], content: preset.system_prompt + '\n\n' + msgs[si].content }
      else msgs.unshift({ role: 'system', content: preset.system_prompt })
    }

    next.messages = msgs
  }

  return { body: next }
}

// ── Route factory ────────────────────────────────────────────────────────────
export function agentRoutes() {
  const app = new Hono<{ Bindings: Env }>()

  // ── Public ────────────────────────────────────────────────────────────────
  // GET /v1/agents  →  list active public presets
  app.get('/', async (c) => {
    const { results } = await c.env.DB
      .prepare(
        'SELECT id,slug,name,description,model,tags,sort_order FROM agent_presets WHERE is_active=1 AND is_public=1 ORDER BY sort_order ASC, name ASC',
      )
      .all()
    return c.json({ object: 'list', data: (results || []).map(r => ({ ...(r as any), tags: parseOrNull((r as any).tags) })) })
  })

  // ── Admin ─────────────────────────────────────────────────────────────────
  // GET /api/admin/agents/all  →  every preset including inactive
  app.get('/all', async (c) => {
    const user = await requireAuth(c)
    if (!user) return c.json({ error: 'Admin only' }, 403)
    const { results } = await c.env.DB
      .prepare('SELECT * FROM agent_presets ORDER BY sort_order ASC, name ASC')
      .all()
    return c.json({ agents: results || [] })
  })

  // GET /api/admin/agents/:id
  app.get('/:id', async (c) => {
    const user = await requireAuth(c)
    if (!user) return c.json({ error: 'Admin only' }, 403)
    const row = await c.env.DB
      .prepare('SELECT * FROM agent_presets WHERE id = ?')
      .bind(c.req.param('id'))
      .first()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json(row)
  })

  // POST /api/admin/agents  →  create
  app.post('/', async (c) => {
    const user = await requireAuth(c)
    if (!user) return c.json({ error: 'Admin only' }, 403)

    const body = await c.req.json<{
      slug?: string
      name: string
      description?: string
      system_prompt?: string
      system_prompt_mode?: string
      model?: string
      temperature?: number
      max_tokens?: number
      top_p?: number
      frequency_penalty?: number
      presence_penalty?: number
      stop_sequences?: string[]
      tools?: any[]
      tool_choice?: any
      mcp_servers?: any[]
      fallback_models?: string[]
      allowed_key_ids?: number[]
      allowed_user_ids?: string[]
      tags?: string[]
      metadata?: any
      is_active?: boolean
      is_public?: boolean
      sort_order?: number
    }>()

    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400)

    const slug = (body.slug?.trim() || slugify(body.name)).replace(/[^a-z0-9_-]/g, '')
    if (!slug) return c.json({ error: 'Could not derive a valid slug from the name' }, 400)

    const conflict = await c.env.DB
      .prepare('SELECT id FROM agent_presets WHERE slug = ?')
      .bind(slug)
      .first()
    if (conflict) return c.json({ error: `Slug '${slug}' is already taken` }, 409)

    const row = await c.env.DB.prepare(
      `INSERT INTO agent_presets
         (slug,name,description,system_prompt,system_prompt_mode,
          model,temperature,max_tokens,top_p,frequency_penalty,presence_penalty,
          stop_sequences,tools,tool_choice,mcp_servers,fallback_models,
          allowed_key_ids,allowed_user_ids,tags,metadata,
          is_active,is_public,sort_order,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       RETURNING *`,
    ).bind(
      slug,
      body.name.trim(),
      body.description ?? null,
      body.system_prompt ?? null,
      body.system_prompt_mode ?? 'prepend',
      body.model ?? null,
      body.temperature ?? null,
      body.max_tokens ?? null,
      body.top_p ?? null,
      body.frequency_penalty ?? null,
      body.presence_penalty ?? null,
      jsonOrNull(body.stop_sequences),
      jsonOrNull(body.tools),
      body.tool_choice != null
        ? (typeof body.tool_choice === 'string' ? body.tool_choice : JSON.stringify(body.tool_choice))
        : null,
      jsonOrNull(body.mcp_servers),
      jsonOrNull(body.fallback_models),
      jsonOrNull(body.allowed_key_ids),
      jsonOrNull(body.allowed_user_ids),
      jsonOrNull(body.tags),
      jsonOrNull(body.metadata),
      body.is_active !== false ? 1 : 0,
      body.is_public ? 1 : 0,
      body.sort_order ?? 0,
      user.id,
    ).first()

    return c.json(row, 201)
  })

  // PUT /api/admin/agents/:id  →  update (all fields, partial ok)
  app.put('/:id', async (c) => {
    const user = await requireAuth(c)
    if (!user) return c.json({ error: 'Admin only' }, 403)

    const existing = await c.env.DB
      .prepare('SELECT * FROM agent_presets WHERE id = ?')
      .bind(c.req.param('id'))
      .first<AgentRow>()
    if (!existing) return c.json({ error: 'Not found' }, 404)

    const patch = await c.req.json<Partial<AgentRow & { stop_sequences: any; tools: any; tool_choice: any; mcp_servers: any; fallback_models: any; allowed_key_ids: any; allowed_user_ids: any; tags: any; metadata: any }>>()
    const m = { ...existing, ...patch }

    await c.env.DB.prepare(
      `UPDATE agent_presets SET
         slug=?,name=?,description=?,system_prompt=?,system_prompt_mode=?,
         model=?,temperature=?,max_tokens=?,top_p=?,frequency_penalty=?,presence_penalty=?,
         stop_sequences=?,tools=?,tool_choice=?,mcp_servers=?,fallback_models=?,
         allowed_key_ids=?,allowed_user_ids=?,tags=?,metadata=?,
         is_active=?,is_public=?,sort_order=?,updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
    ).bind(
      m.slug, m.name, m.description ?? null,
      m.system_prompt ?? null, m.system_prompt_mode || 'prepend',
      m.model ?? null, m.temperature ?? null, m.max_tokens ?? null,
      m.top_p ?? null, m.frequency_penalty ?? null, m.presence_penalty ?? null,
      jsonOrNull(m.stop_sequences),
      jsonOrNull(m.tools),
      m.tool_choice != null
        ? (typeof m.tool_choice === 'object' ? JSON.stringify(m.tool_choice) : m.tool_choice)
        : null,
      jsonOrNull(m.mcp_servers),
      jsonOrNull(m.fallback_models),
      jsonOrNull(m.allowed_key_ids),
      jsonOrNull(m.allowed_user_ids),
      jsonOrNull(m.tags),
      jsonOrNull(m.metadata),
      m.is_active ? 1 : 0,
      m.is_public ? 1 : 0,
      m.sort_order ?? 0,
      c.req.param('id'),
    ).run()

    return c.json(
      await c.env.DB.prepare('SELECT * FROM agent_presets WHERE id = ?').bind(c.req.param('id')).first(),
    )
  })

  // DELETE /api/admin/agents/:id
  app.delete('/:id', async (c) => {
    const user = await requireAuth(c)
    if (!user) return c.json({ error: 'Admin only' }, 403)
    const row = await c.env.DB.prepare('SELECT id FROM agent_presets WHERE id = ?').bind(c.req.param('id')).first()
    if (!row) return c.json({ error: 'Not found' }, 404)
    await c.env.DB.prepare('DELETE FROM agent_presets WHERE id = ?').bind(c.req.param('id')).run()
    return c.json({ deleted: true })
  })

  // POST /api/admin/agents/:id/toggle  →  flip is_active
  app.post('/:id/toggle', async (c) => {
    const user = await requireAuth(c)
    if (!user) return c.json({ error: 'Admin only' }, 403)
    const row = await c.env.DB
      .prepare('SELECT id, is_active FROM agent_presets WHERE id = ?')
      .bind(c.req.param('id'))
      .first<{ id: number; is_active: number }>()
    if (!row) return c.json({ error: 'Not found' }, 404)
    const next = row.is_active ? 0 : 1
    await c.env.DB
      .prepare('UPDATE agent_presets SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(next, row.id)
      .run()
    return c.json({ id: row.id, is_active: next === 1 })
  })

  // POST /api/admin/agents/:id/duplicate  →  copy with a new slug
  app.post('/:id/duplicate', async (c) => {
    const user = await requireAuth(c)
    if (!user) return c.json({ error: 'Admin only' }, 403)

    const orig = await c.env.DB
      .prepare('SELECT * FROM agent_presets WHERE id = ?')
      .bind(c.req.param('id'))
      .first<AgentRow>()
    if (!orig) return c.json({ error: 'Not found' }, 404)

    let newSlug = orig.slug + '-copy'
    let i = 2
    while (await c.env.DB.prepare('SELECT id FROM agent_presets WHERE slug = ?').bind(newSlug).first()) {
      newSlug = `${orig.slug}-copy-${i++}`
    }

    const row = await c.env.DB.prepare(
      `INSERT INTO agent_presets
         (slug,name,description,system_prompt,system_prompt_mode,
          model,temperature,max_tokens,top_p,frequency_penalty,presence_penalty,
          stop_sequences,tools,tool_choice,mcp_servers,fallback_models,
          allowed_key_ids,allowed_user_ids,tags,metadata,
          is_active,is_public,sort_order,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       RETURNING *`,
    ).bind(
      newSlug, orig.name + ' (copy)', orig.description,
      orig.system_prompt, orig.system_prompt_mode,
      orig.model, orig.temperature, orig.max_tokens,
      orig.top_p, orig.frequency_penalty, orig.presence_penalty,
      orig.stop_sequences, orig.tools, orig.tool_choice,
      orig.mcp_servers, orig.fallback_models,
      orig.allowed_key_ids, orig.allowed_user_ids, orig.tags, orig.metadata,
      0,  // start inactive
      orig.is_public, orig.sort_order, user.id,
    ).first()

    return c.json(row, 201)
  })

  // GET /api/admin/agents/:id/analytics
  app.get('/:id/analytics', async (c) => {
    const user = await requireAuth(c)
    if (!user) return c.json({ error: 'Admin only' }, 403)

    const agent = await c.env.DB
      .prepare('SELECT id, name, slug FROM agent_presets WHERE id = ?')
      .bind(c.req.param('id'))
      .first<{ id: number; name: string; slug: string }>()
    if (!agent) return c.json({ error: 'Not found' }, 404)

    const days = parseInt(c.req.query('days') || '30')
    const since = new Date(Date.now() - days * 86400000).toISOString()

    const [totals, byModel, byDay] = await Promise.all([
      c.env.DB.prepare(
        `SELECT COUNT(*) as requests,
                COALESCE(SUM(total_tokens),0) as tokens,
                COALESCE(SUM(cost_cents),0) as cost_cents
         FROM usage_logs WHERE agent_id = ? AND created_at >= ?`,
      ).bind(agent.id, since).first<{ requests: number; tokens: number; cost_cents: number }>(),

      c.env.DB.prepare(
        `SELECT model,
                COUNT(*) as requests,
                COALESCE(SUM(total_tokens),0) as tokens,
                COALESCE(SUM(cost_cents),0) as cost_cents
         FROM usage_logs WHERE agent_id = ? AND created_at >= ?
         GROUP BY model ORDER BY requests DESC LIMIT 10`,
      ).bind(agent.id, since).all(),

      c.env.DB.prepare(
        `SELECT strftime('%Y-%m-%d', created_at) as day,
                COUNT(*) as requests,
                COALESCE(SUM(cost_cents),0) as cost_cents
         FROM usage_logs WHERE agent_id = ? AND created_at >= ?
         GROUP BY day ORDER BY day ASC`,
      ).bind(agent.id, since).all(),
    ])

    return c.json({
      agent: { id: agent.id, name: agent.name, slug: agent.slug },
      period_days: days,
      totals,
      by_model: byModel.results,
      by_day: byDay.results,
    })
  })

  return app
}
