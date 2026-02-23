// Guardrails pipeline — input check → PII mask → injection detect → output check

export interface GuardrailResult {
  allowed: boolean
  reason?: string
  messages: any[]
}

// Prompt injection patterns
const INJECTION_RE = [
  /ignore\s+(previous|all|prior|above)\s+instructions?/i,
  /jailbreak/i,
  /bypass\s+(safety|filter|guardrail|alignment)/i,
  /pretend\s+you\s+(are|have)\s+(no\s+restrictions|no\s+rules)/i,
  /you\s+are\s+now\s+(DAN|jailbreak|uncensored|unfiltered)/i,
  /disregard\s+all\s+previous/i,
  /act\s+as\s+if\s+you\s+have\s+no\s+(restrictions|rules)/i,
  /\bDAN\b.*mode/i,
  /developer\s+mode\s+enabled/i,
]

// PII patterns: [regex, replacement]
const PII_PATTERNS: [RegExp, string][] = [
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]'],
  [/\b4[0-9]{12}(?:[0-9]{3})?\b/g, '[CARD]'],     // Visa
  [/\b5[1-5][0-9]{14}\b/g, '[CARD]'],              // MasterCard
  [/\b3[47][0-9]{13}\b/g, '[CARD]'],               // Amex
  [/\b6(?:011|5[0-9]{2})[0-9]{12}\b/g, '[CARD]'], // Discover
  [/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, '[PHONE]'],
]

function extractText(msg: any): string {
  if (typeof msg.content === 'string') return msg.content
  if (Array.isArray(msg.content)) return msg.content.map((p: any) => p.text || '').join(' ')
  return ''
}

function maskPII(text: string): string {
  return PII_PATTERNS.reduce((t, [re, rep]) => t.replace(re, rep), text)
}

function applyMaskToMsg(msg: any): any {
  if (typeof msg.content === 'string') return { ...msg, content: maskPII(msg.content) }
  if (Array.isArray(msg.content)) return { ...msg, content: msg.content.map((p: any) => p.text ? { ...p, text: maskPII(p.text) } : p) }
  return msg
}

export function runInputGuardrails(
  messages: any[],
  settings: Record<string, string>,
): GuardrailResult {
  if (settings.guardrail_enabled !== '1') return { allowed: true, messages }

  const blocked = (settings.guardrail_blocked_words || '')
    .split(',').map((w: string) => w.trim().toLowerCase()).filter(Boolean)
  const doInject = settings.guardrail_injection_detect !== '0'
  const doPii = settings.guardrail_pii_mask !== '0'

  let out = [...messages]

  for (const msg of out) {
    const text = extractText(msg).toLowerCase()

    // Blocked words
    for (const word of blocked) {
      if (word && text.includes(word)) return { allowed: false, reason: 'Request blocked by content policy', messages }
    }

    // Injection detection
    if (doInject) {
      for (const re of INJECTION_RE) {
        if (re.test(extractText(msg))) return { allowed: false, reason: 'Prompt injection detected', messages }
      }
    }
  }

  // PII masking (always modify, even if allowed)
  if (doPii) out = out.map(applyMaskToMsg)

  return { allowed: true, messages: out }
}

export function runOutputGuardrails(
  content: string,
  settings: Record<string, string>,
): { allowed: boolean; reason?: string } {
  if (settings.guardrail_enabled !== '1') return { allowed: true }

  const blocked = (settings.guardrail_blocked_words || '')
    .split(',').map((w: string) => w.trim().toLowerCase()).filter(Boolean)

  const lower = content.toLowerCase()
  for (const word of blocked) {
    if (word && lower.includes(word)) return { allowed: false, reason: 'Response blocked by content policy' }
  }

  return { allowed: true }
}
