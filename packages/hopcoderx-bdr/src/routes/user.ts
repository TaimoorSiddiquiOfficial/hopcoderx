import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { createHash } from 'crypto';

export function userRoutes() {
  const user = new Hono<{ Bindings: Env }>();

  // List user's API keys
  user.get('/api-keys', async (c) => {
    const auth = await requireAuth(c);
    if (!auth) return c.json({ error: 'Unauthorized' }, 401);

    const keys = (await c.env.DB.prepare(`
      SELECT id, key_prefix, name, is_active, last_used, created_at,
             expires_at, allowed_models, max_budget_cents, budget_period, budget_used_cents,
             note, rpm_limit, tpm_limit
      FROM api_keys
      WHERE user_id = ? AND is_active = 1
      ORDER BY created_at DESC
    `).bind(auth.id).all()).results;

    return c.json(keys);
  });

  // Create new API key
  user.post('/api-keys', async (c) => {
    const auth = await requireAuth(c);
    if (!auth) return c.json({ error: 'Unauthorized' }, 401);

    const { name, expires_hours, allowed_models, max_budget_cents, budget_period, note, rpm_limit, tpm_limit } = await c.req.json<{
      name?: string; expires_hours?: number; allowed_models?: string[];
      max_budget_cents?: number; budget_period?: string; note?: string;
      rpm_limit?: number; tpm_limit?: number;
    }>();
    const rawKey = `hx_${crypto.randomUUID().replace(/-/g, '')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.slice(0, 8);

    const expiresAt = expires_hours ? new Date(Date.now() + expires_hours * 3600000).toISOString() : null;
    const allowedModelsJson = allowed_models?.length ? JSON.stringify(allowed_models) : null;

    await c.env.DB.prepare(`
      INSERT INTO api_keys (user_id, key_hash, key_prefix, name, expires_at, allowed_models, max_budget_cents, budget_period, note, rpm_limit, tpm_limit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(auth.id, keyHash, keyPrefix, name || 'API Key', expiresAt, allowedModelsJson,
        max_budget_cents || 0, budget_period || null, note || null, rpm_limit || 0, tpm_limit || 0).run();

    // Return FULL KEY ONLY ONCE
    return c.json({
      key: rawKey,
      prefix: keyPrefix,
      name: name || 'API Key',
      expires_at: expiresAt,
      allowed_models: allowed_models || null,
      max_budget_cents: max_budget_cents || 0,
      budget_period: budget_period || null,
      note: note || null,
      warning: 'Store this key securely. It will not be shown again.',
    });
  });

  // Revoke API key
  user.delete('/api-keys/:id', async (c) => {
    const auth = await requireAuth(c);
    if (!auth) return c.json({ error: 'Unauthorized' }, 401);

    const keyId = c.req.param('id');
    const result = await c.env.DB.prepare(
      'UPDATE api_keys SET is_active = 0 WHERE id = ? AND user_id = ?'
    ).bind(keyId, auth.id).run();

    if ((result.meta?.changes ?? 0) === 0) {
      return c.json({ error: 'Key not found or already revoked' }, 404);
    }

    return c.json({ success: true });
  });

  // Get usage history
  user.get('/usage', async (c) => {
    const auth = await requireAuth(c);
    if (!auth) return c.json({ error: 'Unauthorized' }, 401);

    const { days = '30', limit = '50' } = c.req.query();
    const since = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000).toISOString();

    const logs = (await c.env.DB.prepare(`
      SELECT
        u.model, u.prompt_tokens, u.completion_tokens, u.total_tokens,
        u.cost_cents, u.gateway_cache_hit, u.created_at,
        a.key_prefix
      FROM usage_logs u
      LEFT JOIN api_keys a ON u.api_key_id = a.id
      WHERE u.user_id = ? AND u.created_at > ?
      ORDER BY u.created_at DESC
      LIMIT ?
    `).bind(auth.id, since, parseInt(limit)).all()).results;

    // Summary stats
    const stats = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total_requests,
        SUM(prompt_tokens) as total_prompt_tokens,
        SUM(completion_tokens) as total_completion_tokens,
        SUM(cost_cents) as total_cost_cents,
        SUM(gateway_cache_hit) as cache_hits
      FROM usage_logs
      WHERE user_id = ? AND created_at > ?
    `).bind(auth.id, since).first();

    return c.json({ logs, stats });
  });

  // Get detailed balance + monthly usage
  user.get('/balance', async (c) => {
    const auth = await requireAuth(c);
    if (!auth) return c.json({ error: 'Unauthorized' }, 401);

    const user = await c.env.DB.prepare(
      'SELECT balance_cents, monthly_limit_cents FROM users WHERE id = ?'
    ).bind(auth.id).first<{ balance_cents: number; monthly_limit_cents: number }>();

    // Current month usage
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const monthUsage = await c.env.DB.prepare(`
      SELECT
        SUM(cost_cents) as spent,
        COUNT(*) as requests
      FROM usage_logs
      WHERE user_id = ? AND created_at >= ?
    `).bind(auth.id, monthStart).first<{ spent: number; requests: number }>();

    return c.json({
      balance_cents: user?.balance_cents || 0,
      monthly_limit_cents: user?.monthly_limit_cents || 10000,
      month_spent_cents: monthUsage?.spent || 0,
      month_requests: monthUsage?.requests || 0,
      month_remaining_cents: (user?.monthly_limit_cents || 10000) - (monthUsage?.spent || 0),
    });
  });

  // Get user settings (for future: per-user OpenRouter key if we allow it)
  user.get('/settings', async (c) => {
    const auth = await requireAuth(c);
    if (!auth) return c.json({ error: 'Unauthorized' }, 401);

    const dbUser = await c.env.DB.prepare(
      'SELECT email, role, balance_cents, monthly_limit_cents, auto_reload_enabled, auto_reload_amount_cents FROM users WHERE id = ?'
    ).bind(auth.id).first();

    return c.json(dbUser);
  });

  // List models available to this user
  // By default returns only featured models; add ?all=1 to see all active models.
  user.get('/models', async (c) => {
    const auth = await requireAuth(c);
    if (!auth) return c.json({ error: 'Unauthorized' }, 401);

    const showAll = c.req.query('all') === '1';

    const where = showAll
      ? 'WHERE is_active = 1'
      : 'WHERE is_active = 1 AND is_featured = 1';

    const { results } = await c.env.DB.prepare(
      `SELECT model_id, name, description, provider, context_length,
              pricing_input_cents_per_m, pricing_output_cents_per_m,
              is_featured, sort_order
       FROM models ${where}
       ORDER BY is_featured DESC, sort_order ASC, name ASC`,
    ).all();

    // If key has allowed_models restriction, annotate each model
    const keyHeader = c.req.header('x-hopcoderx-key') || c.req.header('Authorization')?.replace('Bearer ', '') || '';
    let allowedSet: Set<string> | null = null
    if (keyHeader) {
      const { createHash } = await import('crypto')
      const kHash = createHash('sha256').update(keyHeader).digest('hex')
      const keyRow = await c.env.DB.prepare(
        'SELECT allowed_models FROM api_keys WHERE key_hash = ? AND is_active = 1',
      ).bind(kHash).first<{ allowed_models: string | null }>().catch(() => null)
      if (keyRow?.allowed_models) {
        try { allowedSet = new Set(JSON.parse(keyRow.allowed_models)) } catch { /* ignore */ }
      }
    }

    const data = (results || []).map((m: any) => ({
      id: m.model_id,
      name: m.name,
      description: m.description,
      provider: m.provider,
      context_length: m.context_length,
      is_featured: !!m.is_featured,
      pricing: {
        input_per_1m: (m.pricing_input_cents_per_m as number) / 100,
        output_per_1m: (m.pricing_output_cents_per_m as number) / 100,
      },
      // allowed: null means no restriction on key; true/false when key has restrictions
      allowed: allowedSet ? allowedSet.has(m.model_id) : null,
    }))

    return c.json({
      object: 'list',
      total: data.length,
      featured_only: !showAll,
      data,
    })
  });

  return user;
}
