// Circuit Breaker — Portkey-style per-provider failure tracking via KV
// States: CLOSED (normal) → OPEN (blocking) → HALF_OPEN (testing) → CLOSED

export interface CircuitState {
  failures: number        // consecutive failures
  opened_at: number | null  // epoch ms when circuit opened
  last_failure: number    // epoch ms of last failure
  state: 'closed' | 'open' | 'half_open'
}

const KV_PREFIX = 'cb:'
const DEFAULT_THRESHOLD = 5          // failures before opening
const DEFAULT_COOLDOWN = 60_000      // ms before moving to half-open (60s)
const DEFAULT_HALF_OPEN_PASS = 1     // successes to close from half-open

function key(providerId: number | string) {
  return KV_PREFIX + String(providerId)
}

async function getState(kv: any, providerId: number | string): Promise<CircuitState> {
  if (!kv) return { failures: 0, opened_at: null, last_failure: 0, state: 'closed' }
  try {
    const raw = await kv.get(key(providerId))
    if (raw) return JSON.parse(raw) as CircuitState
  } catch { /* ignore */ }
  return { failures: 0, opened_at: null, last_failure: 0, state: 'closed' }
}

async function setState(kv: any, providerId: number | string, state: CircuitState) {
  if (!kv) return
  try {
    await kv.put(key(providerId), JSON.stringify(state), { expirationTtl: 3600 })
  } catch { /* ignore */ }
}

// Returns true if request is allowed to proceed
export async function checkCircuit(
  kv: any,
  providerId: number | string,
  threshold = DEFAULT_THRESHOLD,
  cooldownMs = DEFAULT_COOLDOWN,
): Promise<{ allowed: boolean; state: CircuitState }> {
  const s = await getState(kv, providerId)
  const now = Date.now()

  if (s.state === 'closed') return { allowed: true, state: s }

  if (s.state === 'open') {
    if (s.opened_at && now - s.opened_at >= cooldownMs) {
      // Move to half-open — let one request through to test
      const half: CircuitState = { ...s, state: 'half_open' }
      await setState(kv, providerId, half)
      return { allowed: true, state: half }
    }
    return { allowed: false, state: s }
  }

  // half_open — already letting one through
  return { allowed: true, state: s }
}

export async function recordFailure(
  kv: any,
  providerId: number | string,
  threshold = DEFAULT_THRESHOLD,
) {
  const s = await getState(kv, providerId)
  const failures = (s.state === 'half_open' ? threshold : s.failures) + 1
  const now = Date.now()
  const opened = failures >= threshold
  const next: CircuitState = {
    failures,
    last_failure: now,
    opened_at: opened ? now : s.opened_at,
    state: opened ? 'open' : s.state === 'half_open' ? 'open' : 'closed',
  }
  await setState(kv, providerId, next)
  return next
}

export async function recordSuccess(kv: any, providerId: number | string) {
  const s = await getState(kv, providerId)
  if (s.state === 'closed') return s   // already healthy, skip write
  const next: CircuitState = { failures: 0, opened_at: null, last_failure: 0, state: 'closed' }
  await setState(kv, providerId, next)
  return next
}

export async function getAllCircuitStates(kv: any, providerIds: (number | string)[]): Promise<Record<string, CircuitState>> {
  const entries = await Promise.all(providerIds.map(async id => [String(id), await getState(kv, id)] as const))
  return Object.fromEntries(entries)
}

export async function resetCircuit(kv: any, providerId: number | string) {
  await setState(kv, providerId, { failures: 0, opened_at: null, last_failure: 0, state: 'closed' })
}
