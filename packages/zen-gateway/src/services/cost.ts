/**
 * Raw provider cost — what the LLM provider charges us.
 */
export function estimateCost(
  pricingInputCentsPerM: number,
  pricingOutputCentsPerM: number,
  promptTokens: number,
  completionTokens: number
): number {
  const inputCost = (promptTokens / 1_000_000) * pricingInputCentsPerM
  const outputCost = (completionTokens / 1_000_000) * pricingOutputCentsPerM
  return Math.round(inputCost + outputCost)
}

/**
 * Apply markup on top of provider cost → what we charge the user.
 *
 * markup_type:
 *   'none'       → pass-through (charged = provider cost)
 *   'percentage' → e.g. value=20 adds 20%  ($1.00 → $1.20)
 *   'flat'       → value=N adds N cents per 1 M total tokens on top of provider cost
 */
export function applyMarkup(
  providerCents: number,
  totalTokens: number,
  type: string,
  value: number
): number {
  if (!providerCents || !value || value <= 0 || type === 'none') return providerCents
  if (type === 'percentage') return Math.round(providerCents * (1 + value / 100))
  if (type === 'flat') return providerCents + Math.round((totalTokens / 1_000_000) * value)
  return providerCents
}

/**
 * Calculate both provider cost and what we charge the user (with markup).
 * Returns both so gateway.ts can log provider_cost and deduct charged_cost.
 */
export function calculateCosts(
  pricingInputCentsPerM: number,
  pricingOutputCentsPerM: number,
  promptTokens: number,
  completionTokens: number,
  markupType: string,
  markupValue: number
): { provider_cost_cents: number; charged_cost_cents: number } {
  const provider_cost_cents = estimateCost(pricingInputCentsPerM, pricingOutputCentsPerM, promptTokens, completionTokens)
  const charged_cost_cents = applyMarkup(provider_cost_cents, promptTokens + completionTokens, markupType, markupValue)
  return { provider_cost_cents, charged_cost_cents }
}

/** Conservative pre-flight cost estimate (used only for balance check). */
export function estimateCostConservative(
  pricingInputCentsPerM: number,
  pricingOutputCentsPerM: number,
  estimatedPromptTokens = 1000,
  estimatedCompletionTokens = 200
): number {
  return estimateCost(pricingInputCentsPerM, pricingOutputCentsPerM, estimatedPromptTokens, estimatedCompletionTokens)
}
