import { Hono } from 'hono'
import { createHash, randomBytes } from 'crypto'
import { requireAuth } from '../auth/middleware'

export function virtualKeyRoutes() {
  const app = new Hono<{ Bindings: Env }>()

  // List user's virtual keys
  app.get('/', async (c) => {
    const user = await requireAuth(c)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    const userId = user.id
    const { results } = await c.env.DB.prepare(
      `SELECT vk.id, vk.name, vk.slug, vk.allowed_models, vk.monthly_limit_cents,
              vk.rate_limit_per_min, vk.is_active, vk.expires_at, vk.created_at,
              pc.name as provider_name
       FROM virtual_keys vk
       LEFT JOIN provider_configs pc ON vk.provider_config_id = pc.id
       WHERE vk.user_id = ?
       ORDER BY vk.created_at DESC`
    ).bind(userId).all()
    return c.json({ keys: results || [] })
  })

  // Create virtual key
  app.post('/', async (c) => {
    const user = await requireAuth(c)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    const userId = user.id
    const body = await c.req.json<{
      name: string
      provider_config_id?: number
      allowed_models?: string[]
      monthly_limit_cents?: number
      rate_limit_per_min?: number
      expires_hours?: number
    }>()

    if (!body.name?.trim()) return c.json({ error: 'Name is required' }, 400)

    const raw = randomBytes(24).toString('hex')
    const slug = randomBytes(4).toString('hex')
    const key = `vk-${slug}-${raw}`
    const hash = createHash('sha256').update(key).digest('hex')
    const expiresAt = body.expires_hours
      ? new Date(Date.now() + body.expires_hours * 3600000).toISOString()
      : null
    const allowedModels = body.allowed_models?.length
      ? JSON.stringify(body.allowed_models)
      : null

    const result = await c.env.DB.prepare(
      `INSERT INTO virtual_keys (name, slug, key_hash, provider_config_id, allowed_models, monthly_limit_cents, rate_limit_per_min, user_id, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      body.name.trim(), slug, hash,
      body.provider_config_id ?? null,
      allowedModels,
      body.monthly_limit_cents ?? null,
      body.rate_limit_per_min ?? null,
      userId, expiresAt
    ).run()

    return c.json({ id: result.meta?.last_row_id, key }, 201)
  })

  // Update virtual key (toggle active, rename, update limits)
  app.patch('/:id', async (c) => {
    const user = await requireAuth(c)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    const userId = user.id
    const id = parseInt(c.req.param('id'))
    const body = await c.req.json<{
      name?: string
      is_active?: boolean
      allowed_models?: string[]
      monthly_limit_cents?: number
      rate_limit_per_min?: number
    }>()

    const vk = await c.env.DB.prepare(
      'SELECT id FROM virtual_keys WHERE id = ? AND user_id = ?'
    ).bind(id, userId).first()
    if (!vk) return c.json({ error: 'Virtual key not found' }, 404)

    const updates: string[] = []
    const values: any[] = []
    if (body.name !== undefined) { updates.push('name = ?'); values.push(body.name.trim()) }
    if (body.is_active !== undefined) { updates.push('is_active = ?'); values.push(body.is_active ? 1 : 0) }
    if (body.allowed_models !== undefined) { updates.push('allowed_models = ?'); values.push(body.allowed_models.length ? JSON.stringify(body.allowed_models) : null) }
    if (body.monthly_limit_cents !== undefined) { updates.push('monthly_limit_cents = ?'); values.push(body.monthly_limit_cents) }
    if (body.rate_limit_per_min !== undefined) { updates.push('rate_limit_per_min = ?'); values.push(body.rate_limit_per_min) }

    if (!updates.length) return c.json({ error: 'No fields to update' }, 400)
    values.push(id)
    await c.env.DB.prepare(`UPDATE virtual_keys SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
    return c.json({ ok: true })
  })

  // Revoke / delete virtual key
  app.delete('/:id', async (c) => {
    const user = await requireAuth(c)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    const userId = user.id
    const id = parseInt(c.req.param('id'))
    const vk = await c.env.DB.prepare(
      'SELECT id FROM virtual_keys WHERE id = ? AND user_id = ?'
    ).bind(id, userId).first()
    if (!vk) return c.json({ error: 'Virtual key not found' }, 404)
    await c.env.DB.prepare('DELETE FROM virtual_keys WHERE id = ?').bind(id).run()
    return c.json({ ok: true })
  })

  return app
}
