import { domain } from "./stage"
import { EMAILOCTOPUS_API_KEY } from "./app"

////////////////
// DATABASE
////////////////

const cluster = planetscale.getDatabaseOutput({
  name: "HopCoderX",
  organization: "TaimoorSiddiquiOfficial",
})

const branch =
  $app.stage === "production"
    ? planetscale.getBranchOutput({
        name: "production",
        organization: cluster.organization,
        database: cluster.name,
      })
    : new planetscale.Branch("DatabaseBranch", {
        database: cluster.name,
        organization: cluster.organization,
        name: $app.stage,
        parentBranch: "production",
      })
const password = new planetscale.Password("DatabasePassword", {
  name: $app.stage,
  database: cluster.name,
  organization: cluster.organization,
  branch: branch.name,
})

export const database = new sst.Linkable("Database", {
  properties: {
    host: password.accessHostUrl,
    database: cluster.name,
    username: password.username,
    password: password.plaintext,
    port: 3306,
  },
})

new sst.x.DevCommand("Studio", {
  link: [database],
  dev: {
    command: "bun db studio",
    directory: "packages/console/core",
    autostart: true,
  },
})

////////////////
// AUTH
////////////////

const GITHUB_CLIENT_ID_CONSOLE = new sst.Secret("GITHUB_CLIENT_ID_CONSOLE")
const GITHUB_CLIENT_SECRET_CONSOLE = new sst.Secret("GITHUB_CLIENT_SECRET_CONSOLE")
const GOOGLE_CLIENT_ID = new sst.Secret("GOOGLE_CLIENT_ID")
const authStorage = new sst.cloudflare.Kv("AuthStorage")
export const auth = new sst.cloudflare.Worker("AuthApi", {
  domain: `auth.${domain}`,
  handler: "packages/console/function/src/auth.ts",
  url: true,
  link: [database, authStorage, GITHUB_CLIENT_ID_CONSOLE, GITHUB_CLIENT_SECRET_CONSOLE, GOOGLE_CLIENT_ID],
})

////////////////
// GATEWAY
////////////////

export const stripeWebhook = new stripe.WebhookEndpoint("StripeWebhookEndpoint", {
  url: $interpolate`https://${domain}/stripe/webhook`,
  enabledEvents: [
    "checkout.session.async_payment_failed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.completed",
    "checkout.session.expired",
    "charge.refunded",
    "invoice.payment_succeeded",
    "invoice.payment_failed",
    "invoice.payment_action_required",
    "customer.created",
    "customer.deleted",
    "customer.updated",
    "customer.discount.created",
    "customer.discount.deleted",
    "customer.discount.updated",
    "customer.source.created",
    "customer.source.deleted",
    "customer.source.expiring",
    "customer.source.updated",
    "customer.subscription.created",
    "customer.subscription.deleted",
    "customer.subscription.paused",
    "customer.subscription.pending_update_applied",
    "customer.subscription.pending_update_expired",
    "customer.subscription.resumed",
    "customer.subscription.trial_will_end",
    "customer.subscription.updated",
  ],
})

const bdrProduct = new stripe.Product("BdrBlack", {
  name: "HopCoderX Black",
})
const bdrPriceProps = {
  product: bdrProduct.id,
  currency: "usd",
  recurring: {
    interval: "month",
    intervalCount: 1,
  },
}
const bdrPrice200 = new stripe.Price("BdrBlackPrice", { ...bdrPriceProps, unitAmount: 20000 })
const bdrPrice100 = new stripe.Price("BdrBlack100Price", { ...bdrPriceProps, unitAmount: 10000 })
const bdrPrice20 = new stripe.Price("BdrBlack20Price", { ...bdrPriceProps, unitAmount: 2000 })
// Tiered plans: Free ($0) / Mini ($9) / Pro ($29) / Engineer ($79)
const bdrPriceMini = new stripe.Price("BdrMiniPrice", { ...bdrPriceProps, unitAmount: 900 })
const bdrPricePro = new stripe.Price("BdrProPrice", { ...bdrPriceProps, unitAmount: 2900 })
const bdrPriceEngineer = new stripe.Price("BdrEngineerPrice", { ...bdrPriceProps, unitAmount: 7900 })
const BDR_BLACK_PRICE = new sst.Linkable("BDR_BLACK_PRICE", {
  properties: {
    product: bdrProduct.id,
    plan200: bdrPrice200.id,
    plan100: bdrPrice100.id,
    plan20: bdrPrice20.id,
    planMini: bdrPriceMini.id,
    planPro: bdrPricePro.id,
    planEngineer: bdrPriceEngineer.id,
  },
})
const BDR_BLACK_LIMITS = new sst.Secret("BDR_BLACK_LIMITS")

const BDR_MODELS = [
  new sst.Secret("BDR_MODELS1"),
  new sst.Secret("BDR_MODELS2"),
  new sst.Secret("BDR_MODELS3"),
  new sst.Secret("BDR_MODELS4"),
  new sst.Secret("BDR_MODELS5"),
  new sst.Secret("BDR_MODELS6"),
  new sst.Secret("BDR_MODELS7"),
  new sst.Secret("BDR_MODELS8"),
  new sst.Secret("BDR_MODELS9"),
  new sst.Secret("BDR_MODELS10"),
  new sst.Secret("BDR_MODELS11"),
  new sst.Secret("BDR_MODELS12"),
  new sst.Secret("BDR_MODELS13"),
  new sst.Secret("BDR_MODELS14"),
  new sst.Secret("BDR_MODELS15"),
  new sst.Secret("BDR_MODELS16"),
  new sst.Secret("BDR_MODELS17"),
  new sst.Secret("BDR_MODELS18"),
  new sst.Secret("BDR_MODELS19"),
  new sst.Secret("BDR_MODELS20"),
  new sst.Secret("BDR_MODELS21"),
  new sst.Secret("BDR_MODELS22"),
  new sst.Secret("BDR_MODELS23"),
  new sst.Secret("BDR_MODELS24"),
  new sst.Secret("BDR_MODELS25"),
  new sst.Secret("BDR_MODELS26"),
  new sst.Secret("BDR_MODELS27"),
  new sst.Secret("BDR_MODELS28"),
  new sst.Secret("BDR_MODELS29"),
  new sst.Secret("BDR_MODELS30"),
]
const STRIPE_SECRET_KEY = new sst.Secret("STRIPE_SECRET_KEY")
const STRIPE_PUBLISHABLE_KEY = new sst.Secret("STRIPE_PUBLISHABLE_KEY")
const AUTH_API_URL = new sst.Linkable("AUTH_API_URL", {
  properties: { value: auth.url.apply((url) => url!) },
})
const STRIPE_WEBHOOK_SECRET = new sst.Linkable("STRIPE_WEBHOOK_SECRET", {
  properties: { value: stripeWebhook.secret },
})
const gatewayKv = new sst.cloudflare.Kv("GatewayKv")

////////////////
// CONSOLE
////////////////

const bucket = new sst.cloudflare.Bucket("BdrData")
const bucketNew = new sst.cloudflare.Bucket("BdrDataNew")

const AWS_SES_ACCESS_KEY_ID = new sst.Secret("AWS_SES_ACCESS_KEY_ID")
const AWS_SES_SECRET_ACCESS_KEY = new sst.Secret("AWS_SES_SECRET_ACCESS_KEY")

const logProcessor = new sst.cloudflare.Worker("LogProcessor", {
  handler: "packages/console/function/src/log-processor.ts",
  link: [new sst.Secret("HONEYCOMB_API_KEY")],
})

new sst.cloudflare.x.SolidStart("Console", {
  domain,
  path: "packages/console/app",
  link: [
    bucket,
    bucketNew,
    database,
    AUTH_API_URL,
    STRIPE_WEBHOOK_SECRET,
    STRIPE_SECRET_KEY,
    EMAILOCTOPUS_API_KEY,
    AWS_SES_ACCESS_KEY_ID,
    AWS_SES_SECRET_ACCESS_KEY,
    BDR_BLACK_PRICE,
    BDR_BLACK_LIMITS,
    new sst.Secret("BDR_SESSION_SECRET"),
    ...BDR_MODELS,
    ...($dev
      ? [
          new sst.Secret("CLOUDFLARE_DEFAULT_ACCOUNT_ID", process.env.CLOUDFLARE_DEFAULT_ACCOUNT_ID!),
          new sst.Secret("CLOUDFLARE_API_TOKEN", process.env.CLOUDFLARE_API_TOKEN!),
        ]
      : []),
    gatewayKv,
  ],
  environment: {
    //VITE_DOCS_URL: web.url.apply((url) => url!),
    //VITE_API_URL: gateway.url.apply((url) => url!),
    VITE_AUTH_URL: auth.url.apply((url) => url!),
    VITE_STRIPE_PUBLISHABLE_KEY: STRIPE_PUBLISHABLE_KEY.value,
  },
  transform: {
    server: {
      placement: { region: "aws:us-east-1" },
      transform: {
        worker: {
          tailConsumers: [{ service: logProcessor.nodes.worker.scriptName }],
        },
      },
    },
  },
})
