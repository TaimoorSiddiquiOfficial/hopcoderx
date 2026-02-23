import Stripe from 'stripe';

export function createStripe(secretKey: string): Stripe {
  return new Stripe(secretKey, { apiVersion: '2023-10-16' });
}

/**
 * Create a Stripe Checkout session for adding credits
 */
export async function createCheckoutSession(
  stripe: Stripe,
  userId: string,
  amountCents: number,
  successUrl: string,
  cancelUrl: string
) {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: 'HopCoderX Credits',
          description: `Add $${(amountCents / 100).toFixed(2)} credits to your account`,
        },
        unit_amount: amountCents,
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId, amountCents: amountCents.toString() },
  });

  return session;
}

/**
 * Handle Stripe webhook events
 */
export async function handleStripeWebhook(
  stripe: Stripe,
  payload: string,
  signature: string,
  webhookSecret: string,
  db: any
) {
  const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);

  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const amountCents = parseInt(session.metadata?.amountCents || '0');

      if (userId && amountCents > 0) {
        // Add credits to user balance
        await db.prepare(`
          UPDATE users SET balance_cents = balance_cents + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).bind(amountCents, userId).run();

        // Log transaction
        await db.prepare(`
          INSERT INTO transactions (user_id, type, amount_cents, stripe_payment_id, description)
          VALUES (?, 'credit_add', ?, ?, 'Stripe payment - Credit top-up')
        `).bind(userId, amountCents, session.payment_intent as string).run();
      }
      break;

    case 'invoice.payment_succeeded':
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      const user = await db.prepare(
        'SELECT id FROM users WHERE stripe_customer_id = ?'
      ).bind(customerId).first();

      if (user && invoice.amount_paid) {
        const amountCents = invoice.amount_paid;
        await db.prepare(`
          INSERT INTO transactions (user_id, type, amount_cents, stripe_payment_id, description)
          VALUES (?, 'usage_payment', ?, ?, 'Monthly usage invoice')
        `).bind(user.id, -amountCents, invoice.payment_intent as string).run();
      }
      break;
  }

  return { received: true };
}
