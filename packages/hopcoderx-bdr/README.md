# HopCoderX BDR Gateway

Self-hosted AI gateway for HopCoderX with admin panel, user dashboard, Stripe billing, and model curation.

## Features

- Web admin panel: manage models, import from OpenRouter/Workers AI, set pricing, manage users
- User dashboard: API key management, usage history, balance, billing
- Stripe integration: credit top-ups, payment processing, webhooks
- Cloudflare AI Gateway: caching, rate limiting, analytics
- Cost tracking: per-request cost calculation, balance deduction, monthly limits
- Play mode: billing can be disabled for testing

## Quick Start

### 1. Install Dependencies

```bash
cd packages/bdr-gateway
bun install
```

### 2. Create D1 Database

```bash
wrangler d1 create hopcoderx-bdr
```

Copy the `database_id` from the output and paste it into `wrangler.toml` under `[[d1_databases]]`.

### 3. Apply Database Schema

```bash
wrangler d1 execute hopcoderx-bdr --file src/db/schema.sql
```

### 4. Set Secrets

Generate a JWT secret (keep this safe!):

```bash
openssl rand -base64 32
```

Then set secrets:

```bash
wrangler secret put JWT_SECRET
wrangler secret put OPENROUTER_API_KEY  # your personal OpenRouter API key
wrangler secret put CLOUDFLARE_GATEWAY_TOKEN  # from AI Gateway settings
```

Also fill in `wrangler.toml`:
- `CLOUDFLARE_ACCOUNT_ID` (your Cloudflare account ID)
- `CLOUDFLARE_GATEWAY_ID` (your AI Gateway ID)

### 5. (Optional) Stripe Setup

If you want billing:

```bash
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
```

Then in `wrangler.toml`, set `STRIPE_PUBLISHABLE_KEY` as a var (not secret) for the client.

Create a Stripe webhook endpoint pointing to:
```
https://your-gateway.workers.dev/api/billing/webhook
```
Select events: `checkout.session.completed`, `invoice.payment_succeeded`.

### 6. Deploy

```bash
wrangler deploy
```

### 7. Initialize Application

1. Visit `https://your-gateway.workers.dev/login`
2. Register the first user – automatically becomes **admin**
3. Login as admin
4. Go to **Settings** → enter your OpenRouter API key
5. Save settings
6. Go to **Models** → import models:
   - Import from OpenRouter (select models)
   - Import Workers AI models
7. For each imported model, toggle **Featured** to show to users
8. (Optional) Adjust pricing and billing settings

### 8. Connect from HopCoderX CLI

The provider `hopcoderx-bdr` is automatically available.

1. In HopCoderX, run: `/connect hopcoderx-bdr`
2. Enter the API key from your user dashboard
3. Run `/models` to see available models
4. Start chatting!

## Environment Variables (for HopCoderX CLI)

When running HopCoderX CLI, you may need to set:

```bash
export HOPCODERX_BDR_GATEWAY_URL="https://your-gateway.workers.dev/v1"
```

If not set, defaults to `https://bdr.hopcoder.dev/v1`.

## Cloudflare AI Gateway Configuration

1. In Cloudflare Dashboard → AI → AI Gateway, create a new gateway
2. Choose provider: **OpenRouter**
3. Add your OpenRouter API key in BYOK (Provider Keys)
4. Copy the Gateway ID to `wrangler.toml`

## Architecture

- **Single Cloudflare Worker** (Hono) handles all API & UI
- **D1 Database** stores users, API keys, usage logs, models, transactions
- **Cloudflare AI Gateway** provides caching, rate limiting, and analytics
- **OpenRouter** serves the actual AI models (your account pays)
- **Stripe** handles payment collection (optional)

## Default Limits

- Rate limit: 100 requests per hour per API key
- Monthly spending limit: $10,000 cents ($100) by default (configurable per user)
- Auto-reload: disabled by default

## Billing Modes

- **Play Mode** (`billing_enabled = 0`): No balance checks, unlimited usage (for testing)
- **Live Mode** (`billing_enabled = 1`): Balance and monthly limits enforced, Stripe top-ups enabled

Switch modes in Admin → Settings.

## Cost Breakdown

| Service | Cost |
|---------|------|
| Cloudflare Workers | $0 (100k req/day free) |
| D1 Database | $0 (5GB, 100k reads/day free) |
| AI Gateway | $0 |
| OpenRouter | Pay-as-you-go (your account) |
| Stripe | 2.9% + $0.30 per transaction (no monthly fee) |

## API Endpoints

### Public
- `GET /` - health check
- `POST /api/auth/register` - create account
- `POST /api/auth/login` - authenticate
- `GET /api/auth/me` - current user

### User Auth Required
- `GET /api/user/api-keys` - list API keys
- `POST /api/user/api-keys` - create new key
- `DELETE /api/user/api-keys/:id` - revoke key
- `GET /api/user/usage` - usage history
- `GET /api/user/balance` - balance & limits
- `GET /api/billing/packages` - available credit packages
- `POST /api/billing/create-checkout` - create Stripe checkout
- `GET /api/billing/transactions` - transaction history
- `POST /api/billing/webhook` - Stripe webhook (secret)

### Admin Only
- `GET /api/admin/models` - list curated + fetch from sources
- `POST /api/admin/models/import/openrouter` - import models
- `POST /api/admin/models/import/workers-ai` - import Workers AI
- `PATCH /api/admin/models/:id` - toggle featured, adjust pricing
- `GET /api/admin/users` - list all users
- `POST /api/admin/users/:id/adjust-balance` - manual balance adjustment
- `GET /api/admin/settings` - get global config
- `PATCH /api/admin/settings` - update config

### Gateway (OpenAI-compatible)
- `POST /v1/chat/completions` - main inference endpoint
- `GET /v1/models` - list featured models

All admin routes require `Authorization: Bearer <admin-jwt>`.

## Database Schema

See `src/db/schema.sql`. Key tables:
- `users` – user accounts, balance, limits
- `api_keys` – HopCoderX CLI keys (hashed)
- `usage_logs` – every request, tokens, cost, cache hit
- `models` – curated model catalog with pricing
- `transactions` – billing history
- `settings` – global configuration

## Custom Domain

To use a custom domain:

1. In Cloudflare Workers, add a custom domain (e.g., `bdr.hopcoder.dev`)
2. Update `wrangler.toml` with the route pattern
3. Set `SITE_URL` in admin Settings
4. Update `HOPCODERX_BDR_GATEWAY_URL` for CLI users

## Troubleshooting

### "Invalid API key" when connecting from HopCoderX
- Ensure the user is created in the gateway and has an active API key
- The key must match exactly what's shown in the user dashboard

### Models not appearing in `/models`
- Only models with `is_featured = 1` are visible
- Check admin → Models to toggle featured

### Billing not enforced
- Check `billing_enabled` in admin Settings
- Ensure user has a positive balance

### OpenRouter errors
- Verify openrouter_api_key is set in admin Settings
- Check Cloudflare AI Gateway BYOK configuration

## Development

To run locally:

```bash
wrangler dev
```

Uses local D1 emulator if configured.

## License

MIT
