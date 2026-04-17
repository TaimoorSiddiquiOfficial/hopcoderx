/**
 * Smart Model Router — classifies request complexity and routes to appropriate model tier.
 *
 * Tier 1 (fast/cheap):  Simple queries, one-liners, quick lookups, file reads
 * Tier 2 (balanced):    Multi-step tasks, code review, moderate debugging
 * Tier 3 (powerful):    Architecture, planning, large refactors, complex reasoning
 *
 * The router examines the last user message + system prompt to estimate complexity,
 * then maps to the best available model at the appropriate tier.
 */

export type Tier = 1 | 2 | 3

export interface RouteDecision {
  tier: Tier
  model: string
  reason: string
}

// Configurable tier → model mapping per provider
// Users can override via BDR_TIER1_MODEL, BDR_TIER2_MODEL, BDR_TIER3_MODEL env vars
const TIER_MODELS: Record<string, Record<Tier, string>> = {
  openrouter: {
    1: "google/gemini-2.0-flash-exp:free",
    2: "meta-llama/llama-3.3-70b-instruct:free",
    3: "anthropic/claude-sonnet-4",
  },
  groq: {
    1: "llama-3.1-8b-instant",
    2: "llama-3.3-70b-versatile",
    3: "llama-3.3-70b-versatile",
  },
  cerebras: {
    1: "llama3.1-8b",
    2: "llama3.1-70b",
    3: "llama3.1-70b",
  },
  ollama: {
    1: "llama3.2:3b",
    2: "llama3.1:8b",
    3: "llama3.1:70b",
  },
}

// Complexity signals — each adds/subtracts from a score
const COMPLEX_PATTERNS = [
  // Architecture & planning (+3 each)
  { pattern: /\b(architect|design|plan|strategy|migration|refactor)\b/i, weight: 3 },
  { pattern: /\b(infrastructure|deploy|ci[\s/]cd|pipeline|terraform|bicep)\b/i, weight: 3 },
  { pattern: /\b(security audit|threat model|compliance|penetration)\b/i, weight: 3 },

  // Multi-step reasoning (+2 each)
  { pattern: /\b(debug|diagnose|root cause|investigate|trace)\b/i, weight: 2 },
  { pattern: /\b(review|analyze|compare|evaluate|assess)\b/i, weight: 2 },
  { pattern: /\b(implement|build|create|develop)\b.*\b(system|service|module|feature)\b/i, weight: 2 },
  { pattern: /\b(multiple files|across|entire|codebase|monorepo)\b/i, weight: 2 },

  // Tool-heavy tasks (+1 each)
  { pattern: /\b(test|spec|fixture|mock|stub)\b/i, weight: 1 },
  { pattern: /\b(fix|patch|update|upgrade|bump)\b/i, weight: 1 },
  { pattern: /\b(explain|how does|what is|why does)\b/i, weight: -1 },
]

const SIMPLE_PATTERNS = [
  // Quick lookups (-2 each)
  /\b(show|list|find|search|grep|look up|where is)\b/i,
  /\b(read|cat|view|print|display)\b/i,
  /\b(version|status|health|ping|info)\b/i,
  /\b(yes|no|ok|sure|continue|go ahead|do it)\b/i,
]

export function classifyComplexity(messages: Array<{ role: string; content: string | unknown }>): RouteDecision {
  const lastUser = [...messages].reverse().find(m => m.role === "user")
  const content = extractText(lastUser?.content)
  const systemPrompt = messages.find(m => m.role === "system")
  const systemText = extractText(systemPrompt?.content)

  // Base score: 0
  let score = 0

  // Message length heuristic
  const wordCount = content.split(/\s+/).length
  if (wordCount <= 10) score -= 2
  else if (wordCount <= 30) score -= 1
  else if (wordCount >= 100) score += 2
  else if (wordCount >= 50) score += 1

  // Conversation length — longer conversations = more complex context
  const messageCount = messages.filter(m => m.role !== "system").length
  if (messageCount > 20) score += 2
  else if (messageCount > 10) score += 1

  // Pattern matching on user message
  for (const { pattern, weight } of COMPLEX_PATTERNS) {
    if (pattern.test(content)) score += weight
  }

  for (const pattern of SIMPLE_PATTERNS) {
    if (pattern.test(content)) score -= 2
  }

  // Tool call context — if system prompt mentions many tools, likely complex agent workflow
  if (systemText.length > 5000) score += 1
  if (systemText.includes("tool") && systemText.length > 10000) score += 1

  // Map score to tier
  let tier: Tier
  let reason: string
  if (score <= -1) {
    tier = 1
    reason = `simple (score=${score}, ${wordCount}w)`
  } else if (score <= 3) {
    tier = 2
    reason = `moderate (score=${score}, ${wordCount}w)`
  } else {
    tier = 3
    reason = `complex (score=${score}, ${wordCount}w)`
  }

  return { tier, model: "", reason }
}

export function resolveModel(
  tier: Tier,
  provider: string,
  availableKeys: Record<string, string>,
): string {
  // Env var overrides
  const envKey = `BDR_TIER${tier}_MODEL`
  if (Bun.env[envKey]) return Bun.env[envKey]!

  const models = TIER_MODELS[provider]
  if (models) return models[tier]

  // Fallback: if provider unknown, try openrouter if available, else first available
  if (availableKeys["openrouter"]) return TIER_MODELS.openrouter[tier]
  for (const [p] of Object.entries(availableKeys)) {
    if (TIER_MODELS[p]) return TIER_MODELS[p][tier]
  }

  return "" // no override — let downstream decide
}

function extractText(content: string | unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text ?? "")
      .join(" ")
  }
  return ""
}
