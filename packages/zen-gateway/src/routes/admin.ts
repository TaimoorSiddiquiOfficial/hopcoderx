import { Hono } from 'hono';
import { hash } from 'bcryptjs';
import { requireAuth } from '../auth/middleware';
import { getSettings, setSettings } from '../services/settings';
import { getAnalytics } from '../services/analytics';
import { getAllCircuitStates, resetCircuit } from '../services/circuit_breaker';

const WORKERS_AI_MODELS = [
  { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B Instruct', context_length: 128000, pricing_input: 0, pricing_output: 0 },
  { id: '@cf/meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B Instruct', context_length: 128000, pricing_input: 0, pricing_output: 0 },
  { id: '@cf/microsoft/phi-3.5-mini-instruct', name: 'Phi-3.5 Mini Instruct', context_length: 4096, pricing_input: 0, pricing_output: 0 },
  { id: '@cf/google/gemma-7b-it', name: 'Gemma 7B IT', context_length: 8192, pricing_input: 0, pricing_output: 0 },
  { id: '@cf/mistral/mistral-7b-instruct-v0.2', name: 'Mistral 7B Instruct v0.2', context_length: 32768, pricing_input: 0, pricing_output: 0 },
  { id: '@cf/qwen/qwen1.5-14b-chat-awq', name: 'Qwen 1.5 14B Chat', context_length: 32768, pricing_input: 0, pricing_output: 0 },
];
export { WORKERS_AI_MODELS };

export function adminRoutes() {
  const admin = new Hono();

  // ── Models ────────────────────────────────────────────────────────────
  admin.get('/models', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const curated = (await c.env.DB.prepare('SELECT * FROM models ORDER BY sort_order, name').all()).results;
    const settings = await getSettings(c.env.DB);
    let openrouterModels: any[] = [];
    if (settings.openrouter_api_key) {
      try {
        openrouterModels = (await fetchOpenRouterModels(settings.openrouter_api_key)).map(m => ({
          provider: 'openrouter', model_id: m.id, name: m.name, description: m.description,
          context_length: m.context_length, base_pricing_input: m.pricing?.prompt || 0,
          base_pricing_output: m.pricing?.completion || 0, is_imported: true,
        }));
      } catch (e) { console.error('OpenRouter fetch failed:', e); }
    }
    return c.json({ curated, openrouter: openrouterModels, workers_ai: WORKERS_AI_MODELS.map(m => ({ ...m, provider: 'workers-ai' })) });
  });

  admin.post('/models/import/openrouter', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const body = await c.req.json<{ model_ids: string[] }>();
    const settings = await getSettings(c.env.DB);
    if (!settings.openrouter_api_key) return c.json({ error: 'OpenRouter API key not configured' }, 400);
    const allModels = await fetchOpenRouterModels(settings.openrouter_api_key);
    const selected = allModels.filter(m => body.model_ids.includes(m.id));
    for (const model of selected) {
      await c.env.DB.prepare(
        'INSERT OR REPLACE INTO models (provider,model_id,name,description,context_length,pricing_input_cents_per_m,pricing_output_cents_per_m,is_featured,is_active) VALUES (?,?,?,?,?,?,?,?,?)'
      ).bind('openrouter', model.id, model.name, model.description || '', model.context_length || 0,
        Math.round((model.pricing?.prompt || 0) * 100), Math.round((model.pricing?.completion || 0) * 100), 0, 1).run();
    }
    return c.json({ imported: selected.length });
  });

  admin.post('/models/import/workers-ai', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    for (const model of WORKERS_AI_MODELS) {
      await c.env.DB.prepare(
        'INSERT OR REPLACE INTO models (provider,model_id,name,description,context_length,pricing_input_cents_per_m,pricing_output_cents_per_m,is_featured,is_active) VALUES (?,?,?,?,?,?,?,?,?)'
      ).bind('workers-ai', model.id, model.name, '', model.context_length, model.pricing_input, model.pricing_output, 0, 1).run();
    }
    return c.json({ imported: WORKERS_AI_MODELS.length });
  });

  // Sync OpenRouter model pricing to latest values
  admin.post('/models/sync-prices', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const settings = await getSettings(c.env.DB);
    if (!settings.openrouter_api_key) return c.json({ error: 'OpenRouter API key not configured' }, 400);
    const allModels = await fetchOpenRouterModels(settings.openrouter_api_key);
    const priceMap = new Map(allModels.map((m: any) => [m.id, m]));
    const { results } = await c.env.DB.prepare(
      "SELECT id, model_id FROM models WHERE provider = 'openrouter'"
    ).all();
    let updated = 0;
    for (const row of (results || []) as any[]) {
      const or = priceMap.get(row.model_id);
      if (!or) continue;
      const inputCents = Math.round((or.pricing?.prompt || 0) * 100);
      const outputCents = Math.round((or.pricing?.completion || 0) * 100);
      await c.env.DB.prepare(
        'UPDATE models SET pricing_input_cents_per_m = ?, pricing_output_cents_per_m = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(inputCents, outputCents, row.id).run();
      updated++;
    }
    return c.json({ updated, total: results?.length || 0 });
  });

  admin.patch('/models/:id', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const id = c.req.param('id');
    const updates = await c.req.json<{ is_featured?: boolean; is_active?: boolean; pricing_input_cents_per_m?: number; pricing_output_cents_per_m?: number; sort_order?: number }>();
    const set: string[] = [];
    const values: any[] = [];
    if (updates.is_featured !== undefined) { set.push('is_featured = ?'); values.push(updates.is_featured ? 1 : 0); }
    if (updates.is_active !== undefined) { set.push('is_active = ?'); values.push(updates.is_active ? 1 : 0); }
    if (updates.pricing_input_cents_per_m !== undefined) { set.push('pricing_input_cents_per_m = ?'); values.push(updates.pricing_input_cents_per_m); }
    if (updates.pricing_output_cents_per_m !== undefined) { set.push('pricing_output_cents_per_m = ?'); values.push(updates.pricing_output_cents_per_m); }
    if (updates.sort_order !== undefined) { set.push('sort_order = ?'); values.push(updates.sort_order); }
    if (set.length > 0) {
      set.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);
      await c.env.DB.prepare(`UPDATE models SET ${set.join(', ')} WHERE id = ?`).bind(...values).run();
    }
    return c.json({ success: true });
  });

  admin.delete('/models/:id', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    await c.env.DB.prepare('DELETE FROM models WHERE id = ?').bind(c.req.param('id')).run();
    return c.json({ success: true });
  });

  // ── Users ─────────────────────────────────────────────────────────────
  admin.get('/users', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const users = (await c.env.DB.prepare(`
      SELECT u.id, u.email, u.role, u.balance_cents, u.monthly_limit_cents,
             u.suspended, u.email_verified, u.auth_provider, u.auto_reload_enabled,
             u.created_at, COUNT(a.id) as api_key_count
      FROM users u
      LEFT JOIN api_keys a ON u.id = a.user_id AND a.is_active = 1
      GROUP BY u.id ORDER BY u.created_at DESC
    `).all()).results;
    return c.json(users);
  });

  admin.get('/users/:id', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const user = await c.env.DB.prepare(`
      SELECT u.*, COUNT(a.id) as api_key_count
      FROM users u LEFT JOIN api_keys a ON u.id = a.user_id AND a.is_active = 1
      WHERE u.id = ? GROUP BY u.id
    `).bind(c.req.param('id')).first();
    if (!user) return c.json({ error: 'User not found' }, 404);
    const usage = (await c.env.DB.prepare(`
      SELECT model, SUM(total_tokens) as tokens, SUM(cost_cents) as cost, COUNT(*) as requests
      FROM usage_logs WHERE user_id = ? AND created_at > datetime('now', '-30 days')
      GROUP BY model ORDER BY cost DESC LIMIT 10
    `).bind(c.req.param('id')).all()).results;
    return c.json({ user, usage });
  });

  admin.patch('/users/:id', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const id = c.req.param('id');
    const updates = await c.req.json<{ role?: string; suspended?: boolean; monthly_limit_cents?: number; email_verified?: boolean }>();
    const set: string[] = [];
    const values: any[] = [];
    if (updates.role !== undefined) { set.push('role = ?'); values.push(updates.role); }
    if (updates.suspended !== undefined) { set.push('suspended = ?'); values.push(updates.suspended ? 1 : 0); }
    if (updates.monthly_limit_cents !== undefined) { set.push('monthly_limit_cents = ?'); values.push(updates.monthly_limit_cents); }
    if (updates.email_verified !== undefined) { set.push('email_verified = ?'); values.push(updates.email_verified ? 1 : 0); }
    if (set.length === 0) return c.json({ error: 'Nothing to update' }, 400);
    set.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    await c.env.DB.prepare(`UPDATE users SET ${set.join(', ')} WHERE id = ?`).bind(...values).run();
    return c.json({ success: true });
  });

  admin.post('/users/:id/reset-password', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const tempPw = Array.from(crypto.getRandomValues(new Uint8Array(12))).map(b => chars[b % chars.length]).join('');
    const hashed = await hash(tempPw, 10);
    await c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(hashed, c.req.param('id')).run();
    return c.json({ temp_password: tempPw });
  });

  admin.delete('/users/:id', async (c) => {
    const self = await requireAuth(c);
    if (!self) return c.json({ error: 'Admin only' }, 403);
    const id = c.req.param('id');
    if ((self as any).id === id) return c.json({ error: 'Cannot delete your own account' }, 400);
    await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
    return c.json({ success: true });
  });

  admin.post('/users/:id/adjust-balance', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const userId = c.req.param('id');
    const { amount_cents, description } = await c.req.json<{ amount_cents: number; description?: string }>();
    await c.env.DB.prepare('UPDATE users SET balance_cents = balance_cents + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(amount_cents, userId).run();
    await c.env.DB.prepare("INSERT INTO transactions (user_id,type,amount_cents,description) VALUES (?, 'admin_adjust', ?, ?)").bind(userId, amount_cents, description || 'Admin adjustment').run();
    return c.json({ success: true });
  });

  // ── Invites ───────────────────────────────────────────────────────────
  admin.get('/invites', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const invites = (await c.env.DB.prepare(`
      SELECT i.*, u.email as used_by_email
      FROM invite_tokens i LEFT JOIN users u ON i.used_by = u.id
      ORDER BY i.created_at DESC LIMIT 100
    `).all()).results;
    return c.json(invites);
  });

  admin.post('/invites', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const body = await c.req.json<{ email?: string; expires_hours?: number }>().catch(() => ({ email: undefined, expires_hours: 48 }));
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const expiresAt = new Date(Date.now() + (body.expires_hours || 48) * 3600000).toISOString();
    const adminId = (adminUser as any).id;
    await c.env.DB.prepare('INSERT INTO invite_tokens (token, created_by, email, expires_at) VALUES (?, ?, ?, ?)').bind(token, adminId, body.email || null, expiresAt).run();
    const settings = await getSettings(c.env.DB);
    const url = `${settings.site_url || ''}/login?invite=${token}`;
    return c.json({ token, url, expires_at: expiresAt });
  });

  admin.delete('/invites/:id', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    await c.env.DB.prepare('DELETE FROM invite_tokens WHERE id = ?').bind(c.req.param('id')).run();
    return c.json({ success: true });
  });

  // ── Analytics ─────────────────────────────────────────────────────────
  admin.get('/analytics', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const days = parseInt(c.req.query('days') || '30');
    const stats = await getAnalytics(c.env.DB, undefined, days);
    return c.json(stats);
  });

  // ── Settings ──────────────────────────────────────────────────────────
  const SAFE_KEYS = new Set([
    'billing_enabled','markup_type','markup_value','default_monthly_limit_cents',
    'openrouter_api_key','stripe_secret_key','stripe_webhook_secret','stripe_publishable_key','site_url',
    'registration_mode','required_email_domain','email_verification_required',
    'auth_password','auth_magic_link','auth_google','auth_github',
    'google_client_id','google_client_secret','github_client_id','github_client_secret',
    'smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from',
    'max_tokens_per_request','rate_limit_per_min','cache_enabled','cache_ttl_seconds',
    'ip_allowlist','request_logging_enabled','log_retention_days',
    'maintenance_mode','custom_system_prompt',
    'retry_attempts','request_timeout_ms','cb_failure_threshold','cb_cooldown_ms',
  ]);

  const BOOL_KEYS = new Set([
    'billing_enabled','email_verification_required','auth_password','auth_magic_link',
    'auth_google','auth_github','cache_enabled','request_logging_enabled','maintenance_mode',
  ]);

  admin.get('/settings', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const s = await getSettings(c.env.DB);
    return c.json({
      site_url: s.site_url || '',
      billing_enabled: s.billing_enabled === '1',
      markup_type: s.markup_type || 'percentage',
      markup_value: parseFloat(s.markup_value || '0'),
      default_monthly_limit_cents: parseInt(s.default_monthly_limit_cents || '10000'),
      stripe_publishable_key: s.stripe_publishable_key || '',
      has_openrouter_key: !!s.openrouter_api_key,
      has_stripe_secret: !!s.stripe_secret_key,
      // Auth
      registration_mode: s.registration_mode || 'open',
      required_email_domain: s.required_email_domain || '',
      email_verification_required: s.email_verification_required === '1',
      auth_password: s.auth_password !== '0',
      auth_magic_link: s.auth_magic_link === '1',
      auth_google: s.auth_google === '1',
      auth_github: s.auth_github === '1',
      google_client_id: s.google_client_id || '',
      has_google_secret: !!s.google_client_secret,
      github_client_id: s.github_client_id || '',
      has_github_secret: !!s.github_client_secret,
      // SMTP
      smtp_host: s.smtp_host || '',
      smtp_port: s.smtp_port || '587',
      smtp_user: s.smtp_user || '',
      smtp_from: s.smtp_from || '',
      has_smtp_pass: !!s.smtp_pass,
      // Routing & limits
      max_tokens_per_request: parseInt(s.max_tokens_per_request || '0'),
      rate_limit_per_min: parseInt(s.rate_limit_per_min || '60'),
      cache_enabled: s.cache_enabled === '1',
      cache_ttl_seconds: parseInt(s.cache_ttl_seconds || '300'),
      // Security
      ip_allowlist: s.ip_allowlist || '',
      request_logging_enabled: s.request_logging_enabled !== '0',
      log_retention_days: parseInt(s.log_retention_days || '90'),
      // Misc
      maintenance_mode: s.maintenance_mode === '1',
      custom_system_prompt: s.custom_system_prompt || '',
      // Advanced routing & circuit breaker
      retry_attempts: parseInt(s.retry_attempts || '2'),
      request_timeout_ms: parseInt(s.request_timeout_ms || '30000'),
      cb_failure_threshold: parseInt(s.cb_failure_threshold || '5'),
      cb_cooldown_ms: parseInt(s.cb_cooldown_ms || '60000'),
    });
  });

  admin.patch('/settings', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const updates = await c.req.json<Record<string, string | number | boolean>>();
    for (const [key, value] of Object.entries(updates)) {
      if (!SAFE_KEYS.has(key)) continue;
      const v = BOOL_KEYS.has(key)
        ? (value === true || value === '1' || value === 1) ? '1' : '0'
        : String(value);
      await setSettings(c.env.DB, { [key]: v });
    }
    return c.json({ success: true });
  });

  // ── Transactions ───────────────────────────────────────────────────────
  admin.get('/transactions', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const { user_id, type, limit = '200' } = c.req.query();
    const conds: string[] = [];
    const params: any[] = [];
    if (user_id) { conds.push('t.user_id = ?'); params.push(user_id); }
    if (type) { conds.push('t.type = ?'); params.push(type); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const rows = (await c.env.DB.prepare(`
      SELECT t.id, t.user_id, u.email, t.type, t.amount_cents, t.description, t.created_at
      FROM transactions t
      LEFT JOIN users u ON t.user_id = u.id
      ${where}
      ORDER BY t.created_at DESC LIMIT ?
    `).bind(...params, parseInt(limit)).all()).results;
    return c.json(rows || []);
  });

  // ── Usage export (CSV) ─────────────────────────────────────────────────
  admin.get('/export/usage', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const { days = '30' } = c.req.query();
    const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();
    const rows = (await c.env.DB.prepare(`
      SELECT ul.created_at, u.email, ul.model, ul.provider, ul.prompt_tokens,
             ul.completion_tokens, ul.total_tokens, ul.cost_cents, ul.provider_cost_cents,
             ul.response_time_ms, ul.gateway_cache_hit
      FROM usage_logs ul
      LEFT JOIN users u ON ul.user_id = u.id
      WHERE ul.created_at >= ?
      ORDER BY ul.created_at DESC LIMIT 10000
    `).bind(since).all()).results || [];
    const header = 'created_at,email,model,provider,prompt_tokens,completion_tokens,total_tokens,cost_cents,provider_cost_cents,response_time_ms,cache_hit\n';
    const csv = header + rows.map((r: any) =>
      [r.created_at, r.email, r.model, r.provider, r.prompt_tokens, r.completion_tokens,
       r.total_tokens, r.cost_cents, r.provider_cost_cents, r.response_time_ms, r.gateway_cache_hit]
      .map(v => JSON.stringify(v ?? '')).join(',')
    ).join('\n');
    return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="usage-${days}d.csv"` } });
  });

  // ── API Keys (admin view) ──────────────────────────────────────────────
  admin.get('/keys', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const { user_id } = c.req.query();
    const rows = (await c.env.DB.prepare(`
      SELECT ak.id, ak.user_id, u.email, ak.key_prefix, ak.name, ak.is_active, ak.last_used,
             ak.expires_at, ak.allowed_models, ak.max_budget_cents, ak.budget_period,
             ak.budget_used_cents, ak.rpm_limit, ak.tpm_limit, ak.note, ak.created_at
      FROM api_keys ak
      LEFT JOIN users u ON ak.user_id = u.id
      ${user_id ? 'WHERE ak.user_id = ?' : ''}
      ORDER BY ak.created_at DESC LIMIT 500
    `).bind(...(user_id ? [user_id] : [])).all()).results;
    return c.json(rows || []);
  });

  // Revoke key as admin
  admin.delete('/keys/:id', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    await c.env.DB.prepare('UPDATE api_keys SET is_active = 0 WHERE id = ?').bind(c.req.param('id')).run();
    return c.json({ success: true });
  });

  // ── Spend leaderboard ──────────────────────────────────────────────────
  admin.get('/spend/keys', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const { days = '30' } = c.req.query();
    const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();
    const rows = (await c.env.DB.prepare(`
      SELECT ak.id, ak.key_prefix, ak.name, u.email,
             COUNT(*) as requests,
             SUM(ul.total_tokens) as total_tokens,
             SUM(ul.cost_cents) as cost_cents,
             SUM(ul.provider_cost_cents) as provider_cost_cents,
             MAX(ul.created_at) as last_used
      FROM usage_logs ul
      JOIN api_keys ak ON ul.api_key_id = ak.id
      JOIN users u ON ul.user_id = u.id
      WHERE ul.created_at >= ?
      GROUP BY ak.id
      ORDER BY cost_cents DESC LIMIT 50
    `).bind(since).all()).results;
    return c.json(rows || []);
  });

  admin.get('/spend/models', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const { days = '30' } = c.req.query();
    const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();
    const rows = (await c.env.DB.prepare(`
      SELECT model, COUNT(*) as requests, SUM(total_tokens) as total_tokens,
             SUM(cost_cents) as cost_cents, SUM(provider_cost_cents) as provider_cost_cents,
             AVG(response_time_ms) as avg_latency_ms
      FROM usage_logs WHERE created_at >= ?
      GROUP BY model ORDER BY cost_cents DESC LIMIT 30
    `).bind(since).all()).results;
    return c.json(rows || []);
  });

  // ── Health check ──────────────────────────────────────────────────────
  admin.get('/health', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);

    const { results: providers } = await c.env.DB.prepare(
      'SELECT id, name, provider, api_key_encrypted as api_key, base_url FROM provider_configs WHERE is_active = 1 ORDER BY priority ASC'
    ).all();

    const TEST_MODELS: Record<string, string> = {
      openrouter: 'openai/gpt-4o-mini',
      openai:     'gpt-4o-mini',
      anthropic:  'claude-3-haiku-20240307',
      gemini:     'gemini-1.5-flash-latest',
      'azure-openai': 'gpt-4o-mini',
      'workers-ai': '@cf/meta/llama-3.1-8b-instruct',
    }
    const PROVIDER_URLS: Record<string, string> = {
      openrouter:   'https://openrouter.ai/api/v1/chat/completions',
      openai:       'https://api.openai.com/v1/chat/completions',
      anthropic:    'https://api.anthropic.com/v1/messages',
      gemini:       'https://generativelanguage.googleapis.com/v1beta/chat/completions',
      'workers-ai': 'https://api.cloudflare.com/client/v4/ai/run/',
    }

    const results = await Promise.all((providers || []).map(async (p: any) => {
      const t0 = Date.now()
      try {
        const url = p.base_url || PROVIDER_URLS[p.provider] || ''
        if (!url) return { id: p.id, name: p.name, provider: p.provider, status: 'unknown', latency_ms: 0, error: 'No URL configured' }
        const payload: Record<string, any> = {
          model: TEST_MODELS[p.provider] || 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Say "ok" in one word.' }],
          max_tokens: 5,
        }
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (p.provider === 'anthropic') {
          headers['x-api-key'] = p.api_key
          headers['anthropic-version'] = '2023-06-01'
        } else {
          headers['Authorization'] = `Bearer ${p.api_key}`
        }
        if (p.provider === 'openrouter') {
          headers['HTTP-Referer'] = 'https://hopcoderx.com'
          headers['X-Title'] = 'HopCoderX Health Check'
        }
        const res = await Promise.race([
          fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) }),
          new Promise<Response>((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
        ]) as Response
        const latency_ms = Date.now() - t0
        if (res.ok) return { id: p.id, name: p.name, provider: p.provider, status: 'healthy', latency_ms }
        const txt = await res.text().catch(() => '')
        return { id: p.id, name: p.name, provider: p.provider, status: 'unhealthy', latency_ms, error: `HTTP ${res.status}: ${txt.slice(0, 120)}` }
      } catch (e: any) {
        return { id: p.id, name: p.name, provider: p.provider, status: 'unhealthy', latency_ms: Date.now() - t0, error: e.message }
      }
    }))

    const healthy = results.filter(r => r.status === 'healthy').length
    return c.json({ status: healthy > 0 ? 'ok' : 'degraded', healthy, total: results.length, providers: results, checked_at: new Date().toISOString() })
  });

  // ── Circuit Breaker ───────────────────────────────────────────────────
  admin.get('/circuit-breaker', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const { results } = await c.env.DB.prepare('SELECT id, name FROM provider_configs WHERE is_active = 1').all();
    const providerIds = (results as any[]).map(p => p.id);
    const states = await getAllCircuitStates((c.env as any).CACHE, providerIds);
    const named = (results as any[]).map(p => ({ ...p, circuit: states[p.id] || { state: 'closed', failures: 0, opened_at: null, last_failure: null } }));
    return c.json({ providers: named });
  });

  admin.post('/circuit-breaker/:providerId/reset', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const providerId = parseInt(c.req.param('providerId'));
    await resetCircuit((c.env as any).CACHE, providerId);
    return c.json({ ok: true, providerId, reset_at: new Date().toISOString() });
  });

  // ── Model Aliases ─────────────────────────────────────────────────────
  admin.get('/aliases', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const { results } = await c.env.DB.prepare('SELECT * FROM model_aliases ORDER BY alias ASC').all();
    return c.json({ aliases: results || [] });
  });

  admin.post('/aliases', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const body = await c.req.json<{ alias: string; model_id: string; description?: string }>();
    if (!body.alias || !body.model_id) return c.json({ error: 'alias and model_id required' }, 400);
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO model_aliases (id, alias, model_id, description, is_active, created_at) VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)'
    ).bind(id, body.alias.trim(), body.model_id.trim(), body.description || null).run();
    return c.json({ ok: true, id });
  });

  admin.patch('/aliases/:id', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const body = await c.req.json<{ alias?: string; model_id?: string; description?: string; is_active?: boolean }>();
    const id = c.req.param('id');
    const sets: string[] = [];
    const vals: any[] = [];
    if (body.alias !== undefined) { sets.push('alias = ?'); vals.push(body.alias) }
    if (body.model_id !== undefined) { sets.push('model_id = ?'); vals.push(body.model_id) }
    if (body.description !== undefined) { sets.push('description = ?'); vals.push(body.description) }
    if (body.is_active !== undefined) { sets.push('is_active = ?'); vals.push(body.is_active ? 1 : 0) }
    if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
    vals.push(id);
    await c.env.DB.prepare(`UPDATE model_aliases SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
    return c.json({ ok: true });
  });

  admin.delete('/aliases/:id', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    await c.env.DB.prepare('DELETE FROM model_aliases WHERE id = ?').bind(c.req.param('id')).run();
    return c.json({ ok: true });
  });

  // ── Routing Rules ─────────────────────────────────────────────────────
  admin.get('/routing-rules', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const { results } = await c.env.DB.prepare('SELECT * FROM routing_rules ORDER BY priority ASC, name ASC').all();
    return c.json({ rules: results || [] });
  });

  admin.post('/routing-rules', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const body = await c.req.json<{
      name: string; priority?: number;
      condition_field: string; condition_op: string; condition_value: string;
      target_model: string; target_provider_id?: number;
    }>();
    if (!body.name || !body.condition_field || !body.condition_op || !body.condition_value || !body.target_model)
      return c.json({ error: 'name, condition_field, condition_op, condition_value, target_model required' }, 400);
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO routing_rules (id, name, priority, condition_field, condition_op, condition_value, target_model, target_provider_id, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'
    ).bind(id, body.name, body.priority ?? 0, body.condition_field, body.condition_op, body.condition_value, body.target_model, body.target_provider_id ?? null).run();
    return c.json({ ok: true, id });
  });

  admin.patch('/routing-rules/:id', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    const body = await c.req.json<Record<string, any>>();
    const allowed = ['name','priority','condition_field','condition_op','condition_value','target_model','target_provider_id','is_active'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const key of allowed) {
      if (body[key] !== undefined) { sets.push(`${key} = ?`); vals.push(key === 'is_active' ? (body[key] ? 1 : 0) : body[key]) }
    }
    if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
    vals.push(c.req.param('id'));
    await c.env.DB.prepare(`UPDATE routing_rules SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
    return c.json({ ok: true });
  });

  admin.delete('/routing-rules/:id', async (c) => {
    const adminUser = await requireAuth(c);
    if (!adminUser) return c.json({ error: 'Admin only' }, 403);
    await c.env.DB.prepare('DELETE FROM routing_rules WHERE id = ?').bind(c.req.param('id')).run();
    return c.json({ ok: true });
  });

  return admin;
}

async function fetchOpenRouterModels(apiKey: string): Promise<any[]> {
  const res = await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}
