import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { hash, compare } from 'bcryptjs';
import { verify } from 'jsonwebtoken';
import { isFirstUser, createToken } from '../auth/middleware';
import { getSettings } from '../services/settings';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  invite_token: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export function authRoutes() {
  const app = new Hono<{ Bindings: Env }>();

  // Register
  app.post('/register', zValidator('json', registerSchema), async (c) => {
    const body = c.req.valid('json');
    const settings = await getSettings(c.env.DB);

    // Check registration mode
    const mode = settings.registration_mode || 'open';
    if (mode === 'disabled') return c.json({ error: 'Registration is disabled' }, 403);

    // Invite-only: validate token
    let inviteRow: any = null;
    if (mode === 'invite_only' || body.invite_token) {
      if (!body.invite_token) return c.json({ error: 'Invite token required' }, 403);
      inviteRow = await c.env.DB.prepare(
        'SELECT * FROM invite_tokens WHERE token = ? AND used_by IS NULL AND (expires_at IS NULL OR expires_at > datetime("now"))'
      ).bind(body.invite_token).first();
      if (!inviteRow) return c.json({ error: 'Invalid or expired invite token' }, 403);
      if (inviteRow.email && inviteRow.email !== body.email) return c.json({ error: 'Invite is for a different email' }, 403);
    }

    // Required email domain
    if (settings.required_email_domain) {
      const domain = settings.required_email_domain.startsWith('@') ? settings.required_email_domain : '@' + settings.required_email_domain;
      if (!body.email.endsWith(domain)) return c.json({ error: `Email must be from ${domain}` }, 403);
    }

    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(body.email).first();
    if (existing) return c.json({ error: 'User already exists' }, 400);

    const first = await isFirstUser(c.env);
    const role = first ? 'admin' : 'user';
    const passwordHash = await hash(body.password, 10);
    const id = crypto.randomUUID();
    const emailVerified = first || settings.email_verification_required !== '1' ? 1 : 0;
    const defaultLimit = parseInt(settings.default_monthly_limit_cents || '10000');

    await c.env.DB.prepare(
      'INSERT INTO users (id, email, password_hash, role, balance_cents, monthly_limit_cents, email_verified, invited_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, body.email, passwordHash, role, 10000, defaultLimit, emailVerified, inviteRow?.created_by || null).run();

    // Mark invite as used
    if (inviteRow) {
      await c.env.DB.prepare('UPDATE invite_tokens SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id, inviteRow.id).run();
    }

    // Email verification token (if required and not first user)
    if (settings.email_verification_required === '1' && !first) {
      const bytes = crypto.getRandomValues(new Uint8Array(20));
      const vToken = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const expiresAt = new Date(Date.now() + 24 * 3600000).toISOString();
      await c.env.DB.prepare('INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)').bind(id, vToken, expiresAt).run();
      // TODO: send email via SMTP when configured
    }

    const token = createToken({ id, email: body.email, role }, c.env);
    return c.json({ user: { id, email: body.email, role, balance_cents: 10000, email_verified: emailVerified === 1 }, token });
  });

  // Login
  app.post('/login', zValidator('json', loginSchema), async (c) => {
    const body = c.req.valid('json');
    const settings = await getSettings(c.env.DB);

    const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(body.email).first();
    if (!user || !(await compare(body.password, (user as any).password_hash || ''))) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }
    if ((user as any).suspended) return c.json({ error: 'Account suspended. Contact admin.' }, 403);

    // Email verification gate (skip for admin or first-time)
    if (settings.email_verification_required === '1' && !(user as any).email_verified && (user as any).role !== 'admin') {
      return c.json({ error: 'Email not verified. Check your inbox.', code: 'EMAIL_UNVERIFIED' }, 403);
    }

    const token = createToken({ id: (user as any).id, email: (user as any).email, role: (user as any).role }, c.env);
    return c.json({ user: { id: (user as any).id, email: (user as any).email, role: (user as any).role, balance_cents: (user as any).balance_cents }, token });
  });

  // Verify email
  app.get('/verify-email/:token', async (c) => {
    const token = c.req.param('token');
    const row = await c.env.DB.prepare(
      'SELECT * FROM email_verification_tokens WHERE token = ? AND used_at IS NULL AND expires_at > datetime("now")'
    ).bind(token).first();
    if (!row) return c.json({ error: 'Invalid or expired verification link' }, 400);
    await c.env.DB.prepare('UPDATE users SET email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind((row as any).user_id).run();
    await c.env.DB.prepare('UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?').bind((row as any).id).run();
    return c.redirect('/login?verified=1');
  });

  // Resend verification email
  app.post('/resend-verification', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
    const payload = verify(authHeader.slice(7), c.env.JWT_SECRET) as { id: string };
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    const vToken = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const expiresAt = new Date(Date.now() + 24 * 3600000).toISOString();
    await c.env.DB.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').bind(payload.id).run();
    await c.env.DB.prepare('INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)').bind(payload.id, vToken, expiresAt).run();
    // TODO: send email
    return c.json({ success: true, message: 'Verification email sent (configure SMTP to deliver)' });
  });

  // Password reset request
  app.post('/forgot-password', async (c) => {
    const { email } = await c.req.json<{ email: string }>();
    const user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    // Always return 200 to avoid email enumeration
    if (user) {
      const bytes = crypto.getRandomValues(new Uint8Array(20));
      const rToken = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const expiresAt = new Date(Date.now() + 2 * 3600000).toISOString();
      await c.env.DB.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').bind((user as any).id).run();
      await c.env.DB.prepare('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)').bind((user as any).id, rToken, expiresAt).run();
      // TODO: send email
    }
    return c.json({ success: true, message: 'If that account exists, a reset link has been sent.' });
  });

  // Password reset confirm
  app.post('/reset-password', async (c) => {
    const { token, password } = await c.req.json<{ token: string; password: string }>();
    const row = await c.env.DB.prepare(
      'SELECT * FROM password_reset_tokens WHERE token = ? AND used_at IS NULL AND expires_at > datetime("now")'
    ).bind(token).first();
    if (!row) return c.json({ error: 'Invalid or expired reset token' }, 400);
    const hashed = await hash(password, 10);
    await c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(hashed, (row as any).user_id).run();
    await c.env.DB.prepare('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?').bind((row as any).id).run();
    return c.json({ success: true });
  });

  // Validate invite token (for registration form pre-fill)
  app.get('/invite/:token', async (c) => {
    const token = c.req.param('token');
    const row = await c.env.DB.prepare(
      'SELECT email, expires_at FROM invite_tokens WHERE token = ? AND used_by IS NULL AND (expires_at IS NULL OR expires_at > datetime("now"))'
    ).bind(token).first();
    if (!row) return c.json({ error: 'Invalid or expired invite' }, 404);
    return c.json({ valid: true, email: (row as any).email || null, expires_at: (row as any).expires_at });
  });

  // Get current user
  app.get('/me', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
    const token = authHeader.slice(7);
    // Verify JWT separately so DB errors don't masquerade as 401
    let payload: { id: string; email: string; role: string; exp: number };
    try {
      payload = verify(token, c.env.JWT_SECRET) as typeof payload;
    } catch {
      return c.json({ error: 'Invalid token' }, 401);
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) return c.json({ error: 'Token expired' }, 401);
    const user = await c.env.DB.prepare('SELECT id, email, role, balance_cents, email_verified, suspended FROM users WHERE id = ?').bind(payload.id).first();
    if (!user) return c.json({ error: 'User not found' }, 404);
    if ((user as any).suspended) return c.json({ error: 'Account suspended', code: 'SUSPENDED' }, 403);
    return c.json(user);
  });

  return app;
}
