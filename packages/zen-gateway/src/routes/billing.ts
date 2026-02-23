import { Hono } from 'hono';
import { requireAuth } from '../auth/middleware';
import { createStripe, createCheckoutSession, handleStripeWebhook } from '../services/stripe';
import { getSettings } from '../services/settings';

export function billingRoutes() {
  const billing = new Hono();

  // Get billing packages (public)
  billing.get('/packages', async (c) => {
    const settings = await getSettings(c.env.DB);
    const billingEnabled = settings.billing_enabled === '1';

    const packages = [
      { amount_cents: 500, amount_usd: 5.00, label: '$5' },
      { amount_cents: 1000, amount_usd: 10.00, label: '$10' },
      { amount_cents: 2000, amount_usd: 20.00, label: '$20' },
      { amount_cents: 5000, amount_usd: 50.00, label: '$50' },
      { amount_cents: 10000, amount_usd: 100.00, label: '$100' },
    ];

    return c.json({ billing_enabled: billingEnabled, packages });
  });

  // Create checkout session (requires auth)
  billing.post('/create-checkout', async (c) => {
    const auth = await requireAuth(c);
    if (!auth) return c.json({ error: 'Unauthorized' }, 401);

    const { amountCents } = await c.req.json<{ amountCents: number }>();

    // Validate amount (must be in allowed packages)
    const validAmounts = [500, 1000, 2000, 5000, 10000];
    if (!validAmounts.includes(amountCents)) {
      return c.json({ error: 'Invalid amount. Choose from preset packages.' }, 400);
    }

    const settings = await getSettings(c.env.DB);
    if (settings.billing_enabled !== '1') {
      return c.json({ error: 'Billing is currently disabled' }, 403);
    }

    const stripeSecret = settings.stripe_secret_key;
    if (!stripeSecret) {
      return c.json({ error: 'Stripe not configured' }, 500);
    }

    const siteUrl = settings.site_url || 'http://localhost:8787';
    const stripe = createStripe(stripeSecret);

    try {
      const session = await createCheckoutSession(
        stripe,
        auth.id,
        amountCents,
        `${siteUrl}/dashboard?success=1`,
        `${siteUrl}/dashboard?canceled=1`
      );

      return c.json({ url: session.url });
    } catch (error: any) {
      console.error('Stripe checkout error:', error);
      return c.json({ error: 'Failed to create checkout session' }, 500);
    }
  });

  // Stripe webhook (no auth, signature verified)
  billing.post('/webhook', async (c) => {
    const settings = await getSettings(c.env.DB);
    const webhookSecret = settings.stripe_webhook_secret;

    if (!webhookSecret) {
      return c.json({ error: 'Webhook secret not configured' }, 500);
    }

    const payload = await c.req.text();
    const signature = c.req.header('stripe-signature') || '';

    try {
      const stripe = createStripe(settings.stripe_secret_key);
      await handleStripeWebhook(stripe, payload, signature, webhookSecret, c.env.DB);
      return c.json({ received: true });
    } catch (err: any) {
      console.error('Webhook error:', err);
      return c.json({ error: 'Webhook failed' }, 400);
    }
  });

  // Get user's transaction history
  billing.get('/transactions', async (c) => {
    const auth = await requireAuth(c);
    if (!auth) return c.json({ error: 'Unauthorized' }, 401);

    const transactions = (await c.env.DB.prepare(`
      SELECT * FROM transactions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).bind(auth.id).all()).results;

    return c.json(transactions);
  });

  // Admin: Update user's balance (stripe webhook will also do this)
  billing.post('/admin/users/:userId/adjust-balance', async (c) => {
    const auth = await requireAuth(c);
    if (!auth || auth.role !== 'admin') {
      return c.json({ error: 'Admin only' }, 403);
    }

    const userId = c.req.param('userId');
    const { amount_cents, description } = await c.req.json<{
      amount_cents: number;
      description?: string;
    }>();

    // Update balance
    await c.env.DB.prepare(
      'UPDATE users SET balance_cents = balance_cents + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(amount_cents, userId).run();

    // Log transaction
    await c.env.DB.prepare(`
      INSERT INTO transactions (user_id, type, amount_cents, description)
      VALUES (?, 'admin_adjust', ?, ?)
    `).bind(userId, amount_cents, description || 'Manual adjustment by admin').run();

    return c.json({ success: true });
  });

  return billing;
}
