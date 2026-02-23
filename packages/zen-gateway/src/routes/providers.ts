import { Hono } from 'hono'
import { requireAdmin } from '../auth/middleware'
import { callProvider } from '../services/provider'
import type { ProviderType } from '../services/provider'

export function providerRoutes() {
  const app = new Hono()

  // List all provider configs
  app.get('/', async (c) => {
    const admin = await requireAdmin(c)
    if (!admin) return c.json({ error: 'Forbidden' }, 403)
    const { results } = await c.env.DB.prepare(
      `SELECT id, name, provider, base_url, weight, priority, is_active, created_at FROM provider_configs ORDER BY priority ASC, weight DESC`
    ).all()
    return c.json({ providers: results || [] })
  })

  // Create provider config
  app.post('/', async (c) => {
    const admin = await requireAdmin(c)
    if (!admin) return c.json({ error: 'Forbidden' }, 403)
    const body = await c.req.json<{
      name: string
      provider: ProviderType
      api_key: string
      base_url?: string
      weight?: number
      priority?: number
      is_active?: boolean
    }>()
    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400)
    if (!body.provider) return c.json({ error: 'provider is required' }, 400)
    if (!body.api_key?.trim() && body.provider !== 'workers-ai') return c.json({ error: 'api_key is required' }, 400)

    const result = await c.env.DB.prepare(
      `INSERT INTO provider_configs (name, provider, api_key_encrypted, base_url, weight, priority, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      body.name.trim(), body.provider,
      body.api_key?.trim() ?? '',
      body.base_url?.trim() ?? null,
      body.weight ?? 100,
      body.priority ?? 0,
      body.is_active !== false ? 1 : 0
    ).run()
    return c.json({ id: result.meta?.last_row_id }, 201)
  })

  // Update provider config
  app.patch('/:id', async (c) => {
    const admin = await requireAdmin(c)
    if (!admin) return c.json({ error: 'Forbidden' }, 403)
    const id = parseInt(c.req.param('id'))
    const body = await c.req.json<{
      name?: string; api_key?: string; base_url?: string
      weight?: number; priority?: number; is_active?: boolean
    }>()

    const row = await c.env.DB.prepare('SELECT id FROM provider_configs WHERE id = ?').bind(id).first()
    if (!row) return c.json({ error: 'Provider not found' }, 404)

    const updates: string[] = []
    const values: any[] = []
    if (body.name !== undefined) { updates.push('name = ?'); values.push(body.name.trim()) }
    if (body.api_key !== undefined) { updates.push('api_key_encrypted = ?'); values.push(body.api_key.trim()) }
    if (body.base_url !== undefined) { updates.push('base_url = ?'); values.push(body.base_url.trim() || null) }
    if (body.weight !== undefined) { updates.push('weight = ?'); values.push(body.weight) }
    if (body.priority !== undefined) { updates.push('priority = ?'); values.push(body.priority) }
    if (body.is_active !== undefined) { updates.push('is_active = ?'); values.push(body.is_active ? 1 : 0) }
    if (!updates.length) return c.json({ error: 'No fields to update' }, 400)

    values.push(id)
    await c.env.DB.prepare(`UPDATE provider_configs SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
    return c.json({ ok: true })
  })

  // Delete provider config
  app.delete('/:id', async (c) => {
    const admin = await requireAdmin(c)
    if (!admin) return c.json({ error: 'Forbidden' }, 403)
    const id = parseInt(c.req.param('id'))
    const row = await c.env.DB.prepare('SELECT id FROM provider_configs WHERE id = ?').bind(id).first()
    if (!row) return c.json({ error: 'Provider not found' }, 404)
    await c.env.DB.prepare('DELETE FROM provider_configs WHERE id = ?').bind(id).run()
    return c.json({ ok: true })
  })

  // Test provider with a minimal chat call
  app.post('/:id/test', async (c) => {
    const admin = await requireAdmin(c)
    if (!admin) return c.json({ error: 'Forbidden' }, 403)
    const id = parseInt(c.req.param('id'))
    const row = await c.env.DB.prepare(
      'SELECT id, name, provider, api_key_encrypted as api_key, base_url FROM provider_configs WHERE id = ?'
    ).bind(id).first<{ id: number; name: string; provider: ProviderType; api_key: string; base_url: string | null }>()
    if (!row) return c.json({ error: 'Provider not found' }, 404)

    const t0 = Date.now()
    try {
      const resp = await callProvider({ ...row, weight: 100, priority: 0 }, {
        model: row.provider === 'anthropic' ? 'claude-3-haiku-20240307'
          : row.provider === 'gemini' ? 'gemini-1.5-flash'
          : row.provider === 'workers-ai' ? '@cf/meta/llama-3.1-8b-instruct'
          : 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Respond with only "ok"' }],
        max_tokens: 10,
      })
      const latency = Date.now() - t0
      if (resp.ok) {
        const data: any = await resp.json()
        return c.json({ ok: true, latency_ms: latency, response: data.choices?.[0]?.message?.content || 'no content' })
      }
      const err = await resp.text()
      return c.json({ ok: false, latency_ms: latency, status: resp.status, error: err }, 200)
    } catch (e: any) {
      return c.json({ ok: false, latency_ms: Date.now() - t0, error: e.message }, 200)
    }
  })

  return app
}
