import * as crypto from "crypto"

interface Entry {
  text: string
  ts: number
}

export class CompletionCache {
  private store = new Map<string, Entry>()
  private cap: number

  constructor(capacity: number) {
    this.cap = Math.max(1, capacity)
  }

  static key(file: string, line: number, col: number, prefix: string): string {
    const hash = crypto.createHash("md5").update(prefix).digest("hex").slice(0, 12)
    return `${file}:${line}:${col}:${hash}`
  }

  get(key: string): string | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    entry.ts = Date.now()
    return entry.text
  }

  set(key: string, text: string) {
    if (this.store.size >= this.cap) this.evict()
    this.store.set(key, { text, ts: Date.now() })
  }

  clear() {
    this.store.clear()
  }

  resize(capacity: number) {
    this.cap = Math.max(1, capacity)
    while (this.store.size > this.cap) this.evict()
  }

  private evict() {
    let oldest: string | undefined
    let min = Infinity
    for (const [k, v] of this.store) {
      if (v.ts < min) {
        min = v.ts
        oldest = k
      }
    }
    if (oldest) this.store.delete(oldest)
  }
}
