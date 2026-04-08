/**
 * Memory plugin interface — single active backend, swappable.
 *
 * Backends: SQLiteMemory (default), LanceDBMemory (semantic vector store)
 * Activated based on config: `memory.backend = "sqlite" | "lancedb"`
 */

export interface MemoryEntry {
  id: string
  content: string
  /** Free-form tags: "pattern", "error", "preference", "fact" */
  tags: string[]
  /** Git repo root this memory belongs to (null = global) */
  projectScope: string | null
  /** Embedding vector (for semantic backends) */
  embedding?: number[]
  createdAt: number
  updatedAt: number
  accessCount: number
  /** Higher = more important, decays over time */
  score: number
}

export interface MemorySearchResult {
  entry: MemoryEntry
  /** 0..1 similarity (1 = exact) */
  similarity: number
}

export interface MemoryBackend {
  /** Unique ID of this backend implementation */
  readonly id: string
  /** Human-readable name */
  readonly name: string

  /** Initialize / open the store */
  init(): Promise<void>

  /** Store or update a memory entry */
  upsert(entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt" | "accessCount"> & { id?: string }): Promise<MemoryEntry>

  /** Retrieve by ID */
  get(id: string): Promise<MemoryEntry | null>

  /** Delete by ID */
  delete(id: string): Promise<void>

  /**
   * Semantic + keyword search.
   * Returns top-k most relevant memories.
   */
  search(query: string, opts?: { limit?: number; projectScope?: string | null; tags?: string[] }): Promise<MemorySearchResult[]>

  /** List all entries (optionally filtered) */
  list(opts?: { projectScope?: string | null; tags?: string[]; limit?: number }): Promise<MemoryEntry[]>

  /** Export all entries as JSON */
  export(): Promise<MemoryEntry[]>

  /** Wipe all entries */
  clear(): Promise<void>

  /** Close the store */
  close(): Promise<void>
}

/** Registry — exactly one active backend at a time. */
export class MemoryPlugin {
  private static _active: MemoryBackend | null = null

  static register(backend: MemoryBackend) {
    this._active = backend
  }

  static get active(): MemoryBackend {
    if (!this._active) throw new Error("No memory backend registered. Run `hopcoderx memory init`.")
    return this._active
  }

  static isActive(): boolean {
    return this._active !== null
  }
}
