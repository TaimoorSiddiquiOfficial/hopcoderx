declare module '*.html' {
  const content: string
  export default content
}

interface Env {
  DB: D1Database
  CACHE: KVNamespace
  SITE_URL: string
  CLOUDFLARE_ACCOUNT_ID: string
  CLOUDFLARE_GATEWAY_ID: string
  CLOUDFLARE_GATEWAY_URL: string  // https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}
  JWT_SECRET: string
  CLOUDFLARE_GATEWAY_TOKEN?: string
  OPENROUTER_API_KEY?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
}
