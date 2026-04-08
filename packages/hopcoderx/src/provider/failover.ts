/**
 * Provider failover system.
 *
 * When a provider throws a rate-limit or service-unavailable error, HopCoderX
 * automatically retries the request on the next provider in the configured
 * failover chain. This mirrors OpenClaw's model-failover feature.
 *
 * Configuration (hopcoderx.json):
 *
 *   "provider_failover": ["anthropic", "openai", "google"]
 *
 * If not configured, failover is disabled (default behaviour — keep existing
 * single-provider mode).
 */

import { Config } from "../config/config"
import { Provider } from "./provider"
import { Log } from "../util/log"

const log = Log.create({ service: "provider/failover" })

/** Error codes that signal we should try the next provider. */
function isRetryableError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const msg = e.message.toLowerCase()
  // HTTP 429 rate limit or 503/502 service unavailable
  if (/429|rate.?limit|quota.?exceeded/.test(msg)) return true
  if (/503|502|service.?unavailable|overloaded/.test(msg)) return true
  // Network timeouts
  if (/timeout|etimedout|econnreset|econnrefused/.test(msg)) return true
  return false
}

/**
 * Returns the ordered list of provider IDs to try when the primary provider
 * is configured. Returns `[]` if failover is not configured.
 */
export async function getFailoverChain(primaryProviderID: string): Promise<string[]> {
  const config = await Config.get()
  const chain: string[] = (config as any).provider_failover ?? []
  if (!Array.isArray(chain) || chain.length === 0) return []
  // Put the primary first (it may not be in the chain), then the rest
  const others = chain.filter((id) => id !== primaryProviderID)
  return others
}

/**
 * Wraps a model-calling function with failover behaviour.
 *
 * @param primaryProviderID - The originally requested provider
 * @param primaryModelID    - The originally requested model
 * @param fn                - The actual function that calls the model
 *
 * If `fn` throws a retryable error and a failover chain is configured,
 * this function will try each fallback provider (using the same model ID
 * if available, otherwise the first available model from that provider).
 */
export async function withFailover<T>(
  primaryProviderID: string,
  primaryModelID: string,
  fn: (providerID: string, modelID: string) => Promise<T>,
): Promise<T> {
  try {
    return await fn(primaryProviderID, primaryModelID)
  } catch (primaryError) {
    if (!isRetryableError(primaryError)) throw primaryError

    const chain = await getFailoverChain(primaryProviderID)
    if (chain.length === 0) throw primaryError

    log.warn("provider error — trying failover chain", {
      primary: primaryProviderID,
      chain,
      error: primaryError instanceof Error ? primaryError.message : String(primaryError),
    })

    for (const fallbackProviderID of chain) {
      // Resolve a valid model ID for the fallback provider
      let fallbackModelID = primaryModelID
      try {
        // Try the exact same model ID first
        await Provider.getModel(fallbackProviderID, primaryModelID)
      } catch {
        // Model not available — pick the first available model in the provider
        try {
          const provider = await Provider.getProvider(fallbackProviderID)
          const firstModel = Object.keys(provider?.models ?? {})[0]
          if (!firstModel) continue
          fallbackModelID = firstModel
        } catch {
          continue
        }
      }

      log.info("failover attempt", { from: primaryProviderID, to: fallbackProviderID, model: fallbackModelID })

      try {
        const result = await fn(fallbackProviderID, fallbackModelID)
        log.info("failover succeeded", { provider: fallbackProviderID, model: fallbackModelID })
        return result
      } catch (fallbackError) {
        if (!isRetryableError(fallbackError)) throw fallbackError
        log.warn("failover provider also failed", {
          provider: fallbackProviderID,
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        })
        // Try next in chain
      }
    }

    // All providers exhausted
    throw new Error(
      `All providers in failover chain exhausted. Last primary error: ${
        primaryError instanceof Error ? primaryError.message : String(primaryError)
      }`,
      { cause: primaryError },
    )
  }
}
