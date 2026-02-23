// KV-backed exact-match response cache
// Gracefully degrades if CACHE binding is not present

import { createHash } from 'crypto'

export function makeCacheKey(model: string, messages: any[]): string {
  const raw = model + '\x00' + JSON.stringify(messages)
  return 'hcx:' + createHash('sha256').update(raw).digest('hex')
}

export async function getFromCache(kv: any, key: string): Promise<Response | null> {
  if (!kv) return null
  try {
    const val = await kv.get(key)
    if (!val) return null
    return new Response(val, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'x-hopcoderx-cache': 'HIT',
      },
    })
  } catch {
    return null
  }
}

export async function setToCache(kv: any, key: string, body: string, ttlSeconds: number): Promise<void> {
  if (!kv || ttlSeconds <= 0) return
  try {
    await kv.put(key, body, { expirationTtl: Math.max(60, ttlSeconds) })
  } catch {
    // Non-fatal — cache write failure never blocks the response
  }
}
