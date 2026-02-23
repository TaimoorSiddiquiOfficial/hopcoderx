import { z } from "zod"
import { fn } from "./util/fn"
import { Resource } from "@hopcoderx/console-resource"
import { centsToMicroCents } from "./util/price"
import { getWeekBounds } from "./util/date"
import { SubscriptionPlan } from "./schema/billing.sql"

export namespace BlackData {
  const Schema = z.object({
    "200": z.object({
      fixedLimit: z.number().int(),
      rollingLimit: z.number().int(),
      rollingWindow: z.number().int(),
    }),
    "100": z.object({
      fixedLimit: z.number().int(),
      rollingLimit: z.number().int(),
      rollingWindow: z.number().int(),
    }),
    "20": z.object({
      fixedLimit: z.number().int(),
      rollingLimit: z.number().int(),
      rollingWindow: z.number().int(),
    }),
    // Tiered plans: Mini ($9) / Pro ($29) / Engineer ($79)
    free: z
      .object({ fixedLimit: z.number().int(), rollingLimit: z.number().int(), rollingWindow: z.number().int() })
      .optional(),
    mini: z
      .object({ fixedLimit: z.number().int(), rollingLimit: z.number().int(), rollingWindow: z.number().int() })
      .optional(),
    pro: z
      .object({ fixedLimit: z.number().int(), rollingLimit: z.number().int(), rollingWindow: z.number().int() })
      .optional(),
    engineer: z
      .object({ fixedLimit: z.number().int(), rollingLimit: z.number().int(), rollingWindow: z.number().int() })
      .optional(),
  })

  const TIER_DEFAULTS = {
    free: { fixedLimit: 0, rollingLimit: 0, rollingWindow: 3600 },
    mini: { fixedLimit: centsToMicroCents(500), rollingLimit: centsToMicroCents(100), rollingWindow: 3600 },
    pro: { fixedLimit: centsToMicroCents(2000), rollingLimit: centsToMicroCents(500), rollingWindow: 3600 },
    engineer: { fixedLimit: centsToMicroCents(6000), rollingLimit: centsToMicroCents(1500), rollingWindow: 3600 },
  }

  export const validate = fn(Schema, (input) => {
    return input
  })

  export const getLimits = fn(
    z.object({
      plan: z.enum(SubscriptionPlan),
    }),
    ({ plan }) => {
      const json = JSON.parse(Resource.BDR_BLACK_LIMITS.value)
      const parsed = Schema.parse(json)
      const value = parsed[plan as keyof typeof parsed]
      if (value) return value
      // Default limits for new tier plans not yet in BDR_BLACK_LIMITS secret
      if (plan in TIER_DEFAULTS) return TIER_DEFAULTS[plan as keyof typeof TIER_DEFAULTS]
      return parsed["20"] // safe fallback
    },
  )

  export const planToPriceID = fn(
    z.object({
      plan: z.enum(SubscriptionPlan),
    }),
    ({ plan }) => {
      if (plan === "200") return Resource.BDR_BLACK_PRICE.plan200
      if (plan === "100") return Resource.BDR_BLACK_PRICE.plan100
      if (plan === "mini") return Resource.BDR_BLACK_PRICE.planMini
      if (plan === "pro") return Resource.BDR_BLACK_PRICE.planPro
      if (plan === "engineer") return Resource.BDR_BLACK_PRICE.planEngineer
      return Resource.BDR_BLACK_PRICE.plan20
    },
  )

  export const priceIDToPlan = fn(
    z.object({
      priceID: z.string(),
    }),
    ({ priceID }) => {
      if (priceID === Resource.BDR_BLACK_PRICE.plan200) return "200"
      if (priceID === Resource.BDR_BLACK_PRICE.plan100) return "100"
      if (priceID === Resource.BDR_BLACK_PRICE.planMini) return "mini"
      if (priceID === Resource.BDR_BLACK_PRICE.planPro) return "pro"
      if (priceID === Resource.BDR_BLACK_PRICE.planEngineer) return "engineer"
      return "20"
    },
  )
}

export namespace Black {
  export const analyzeRollingUsage = fn(
    z.object({
      plan: z.enum(SubscriptionPlan),
      usage: z.number().int(),
      timeUpdated: z.date(),
    }),
    ({ plan, usage, timeUpdated }) => {
      const now = new Date()
      const black = BlackData.getLimits({ plan })
      const rollingWindowMs = black.rollingWindow * 3600 * 1000
      const rollingLimitInMicroCents = centsToMicroCents(black.rollingLimit * 100)
      const windowStart = new Date(now.getTime() - rollingWindowMs)
      if (timeUpdated < windowStart) {
        return {
          status: "ok" as const,
          resetInSec: black.rollingWindow * 3600,
          usagePercent: 0,
        }
      }

      const windowEnd = new Date(timeUpdated.getTime() + rollingWindowMs)
      if (usage < rollingLimitInMicroCents) {
        return {
          status: "ok" as const,
          resetInSec: Math.ceil((windowEnd.getTime() - now.getTime()) / 1000),
          usagePercent: Math.ceil(Math.min(100, (usage / rollingLimitInMicroCents) * 100)),
        }
      }
      return {
        status: "rate-limited" as const,
        resetInSec: Math.ceil((windowEnd.getTime() - now.getTime()) / 1000),
        usagePercent: 100,
      }
    },
  )

  export const analyzeWeeklyUsage = fn(
    z.object({
      plan: z.enum(SubscriptionPlan),
      usage: z.number().int(),
      timeUpdated: z.date(),
    }),
    ({ plan, usage, timeUpdated }) => {
      const black = BlackData.getLimits({ plan })
      const now = new Date()
      const week = getWeekBounds(now)
      const fixedLimitInMicroCents = centsToMicroCents(black.fixedLimit * 100)
      if (timeUpdated < week.start) {
        return {
          status: "ok" as const,
          resetInSec: Math.ceil((week.end.getTime() - now.getTime()) / 1000),
          usagePercent: 0,
        }
      }
      if (usage < fixedLimitInMicroCents) {
        return {
          status: "ok" as const,
          resetInSec: Math.ceil((week.end.getTime() - now.getTime()) / 1000),
          usagePercent: Math.ceil(Math.min(100, (usage / fixedLimitInMicroCents) * 100)),
        }
      }

      return {
        status: "rate-limited" as const,
        resetInSec: Math.ceil((week.end.getTime() - now.getTime()) / 1000),
        usagePercent: 100,
      }
    },
  )
}
