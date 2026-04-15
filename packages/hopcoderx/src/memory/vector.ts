/**
 * Vector Memory with Self-Editing Blocks
 *
 * Extends the base memory system with:
 * - Automatic relevance scoring based on access patterns
 * - Session-to-session retention (loads relevant memories on session start)
 * - Self-editing capability (memories can be updated based on new context)
 * - Time-based decay for pruning stale memories
 *
 * Inspired by:
 * - opencode-agent-memory (Letta-inspired persistent memory)
 * - opencode-mem (Vector database for long-term retention)
 */

import type { MemoryEntry, MemorySearchResult, MemoryBackend } from "./memory"
import { Log } from "../util/log"
import { randomUUID } from "crypto"

const log = Log.create({ service: "memory-vector" })

/**
 * Enhanced memory block with self-editing capabilities
 */
export interface MemoryBlock extends MemoryEntry {
  /** Session IDs that have accessed this memory */
  sessionIDs: string[]
  /** Last accessed timestamp */
  lastAccessedAt: number
  /** Whether this memory has been auto-edited */
  autoEdited: boolean
  /** Source of this memory (user, agent, auto-extracted) */
  source: "user" | "agent" | "extraction"
}

/**
 * Configuration for vector memory
 */
export interface VectorMemoryConfig {
  /** Maximum number of memories to keep (prune beyond this) */
  maxMemories: number
  /** Days of inactivity before pruning */
  pruneThresholdDays: number
  /** Minimum similarity score for auto-loading memories */
  autoLoadThreshold: number
  /** Maximum memories to auto-load per session */
  autoLoadLimit: number
}

const DEFAULT_CONFIG: VectorMemoryConfig = {
  maxMemories: 1000,
  pruneThresholdDays: 30,
  autoLoadThreshold: 0.6,
  autoLoadLimit: 10,
}

export namespace VectorMemory {
  let backend: MemoryBackend | null = null
  let config: VectorMemoryConfig = DEFAULT_CONFIG
  let initialized = false

  /**
   * Initialize vector memory with a backend
   */
  export async function init(backendImpl: MemoryBackend, cfg?: Partial<VectorMemoryConfig>): Promise<void> {
    if (initialized) {
      log.warn("vector memory already initialized, skipping")
      return
    }

    backend = backendImpl
    config = { ...DEFAULT_CONFIG, ...cfg }

    await backend.init()
    initialized = true

    log.info("vector memory initialized", {
      backend: backend.id,
      maxMemories: config.maxMemories,
      pruneThresholdDays: config.pruneThresholdDays,
    })
  }

  /**
   * Store a new memory or update existing one
   */
  export async function store(
    content: string,
    tags?: string[],
    options?: {
      projectScope?: string | null
      source?: MemoryBlock["source"]
      score?: number
    },
  ): Promise<MemoryBlock> {
    assertInitialized()

    const now = Date.now()
    const block: MemoryBlock = {
      id: randomUUID(),
      content,
      tags: tags ?? [],
      projectScope: options?.projectScope ?? null,
      embedding: undefined, // Will be computed by backend
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      sessionIDs: [],
      autoEdited: false,
      score: options?.score ?? 0.5,
      source: options?.source ?? "user",
    }

    const entry = await backend!.upsert({
      id: block.id,
      content: block.content,
      tags: block.tags,
      projectScope: block.projectScope,
      score: block.score,
    })

    return { ...block, embedding: entry.embedding }
  }

  /**
   * Search memories by query with optional filters
   */
  export async function search(
    query: string,
    options?: {
      limit?: number
      projectScope?: string | null
      tags?: string[]
      minScore?: number
    },
  ): Promise<MemorySearchResult[]> {
    assertInitialized()

    const results = await backend!.search(query, {
      limit: options?.limit,
      projectScope: options?.projectScope,
      tags: options?.tags,
    })

    // Filter by minimum score if specified
    if (options?.minScore !== undefined) {
      return results.filter((r) => r.entry.score >= options.minScore!)
    }

    return results
  }

  /**
   * Edit an existing memory block
   */
  export async function edit(
    id: string,
    updates: {
      content?: string
      tags?: string[]
      score?: number
    },
  ): Promise<MemoryBlock | null> {
    assertInitialized()

    const existing = await backend!.get(id)
    if (!existing) {
      log.warn("memory block not found", { id })
      return null
    }

    const updated: MemoryBlock = {
      ...existing,
      content: updates.content ?? existing.content,
      tags: updates.tags ?? existing.tags,
      score: updates.score ?? existing.score,
      updatedAt: Date.now(),
      autoEdited: true,
    } as MemoryBlock

    await backend!.upsert({
      id: updated.id,
      content: updated.content,
      tags: updated.tags,
      projectScope: updated.projectScope,
      score: updated.score,
    })

    log.info("memory block edited", { id, autoEdited: true })
    return updated
  }

  /**
   * Delete a memory block
   */
  export async function remove(id: string): Promise<void> {
    assertInitialized()
    await backend!.delete(id)
    log.info("memory block removed", { id })
  }

  /**
   * Load relevant memories for a new session (session-to-session retention)
   */
  export async function loadForSession(
    sessionContext: {
      query?: string
      projectScope?: string | null
      tags?: string[]
    },
  ): Promise<MemoryBlock[]> {
    assertInitialized()

    if (!sessionContext.query && !sessionContext.tags) {
      log.debug("no query or tags provided for session load, returning empty")
      return []
    }

    const results = await search(sessionContext.query || "*", {
      limit: config.autoLoadLimit * 2,
      projectScope: sessionContext.projectScope,
      tags: sessionContext.tags,
      minScore: config.autoLoadThreshold,
    })

    // Boost score based on access count and recency
    const now = Date.now()
    const scored = results.map((r) => {
      const block = r.entry as MemoryBlock
      const recencyBoost = Math.max(0, 1 - (now - block.lastAccessedAt) / (30 * 24 * 60 * 60 * 1000))
      const accessBoost = Math.min(0.3, block.accessCount * 0.01)
      return {
        ...r,
        adjustedScore: r.similarity + recencyBoost * 0.2 + accessBoost,
      }
    })

    scored.sort((a, b) => b.adjustedScore - a.adjustedScore)

    log.info("loaded memories for session", {
      count: Math.min(scored.length, config.autoLoadLimit),
      query: sessionContext.query,
    })

    return scored.slice(0, config.autoLoadLimit).map((s) => s.entry as MemoryBlock)
  }

  /**
   * Prune old and unused memories
   */
  export async function prune(options?: {
    /** Prune memories not accessed since this many days */
    inactiveDays?: number
    /** Keep at least this many memories regardless of age */
    minKeep?: number
  }): Promise<{ pruned: number; kept: number }> {
    assertInitialized()

    const inactiveDays = options?.inactiveDays ?? config.pruneThresholdDays
    const minKeep = options?.minKeep ?? 100
    const cutoff = Date.now() - inactiveDays * 24 * 60 * 60 * 1000

    const allEntries = await backend!.list({ limit: config.maxMemories * 2 })

    // Sort by last accessed (using updatedAt as proxy if lastAccessedAt not available)
    const sorted = allEntries.sort((a, b) => {
      const aTime = (a as MemoryBlock).lastAccessedAt || a.updatedAt
      const bTime = (b as MemoryBlock).lastAccessedAt || b.updatedAt
      return bTime - aTime
    })

    // Keep memories that are:
    // 1. Recently accessed (within cutoff)
    // 2. High score (> 0.7)
    // 3. Within the minKeep limit
    const toKeep: MemoryEntry[] = []
    const toPrune: MemoryEntry[] = []

    for (const entry of sorted) {
      const block = entry as MemoryBlock
      const lastAccess = block.lastAccessedAt || entry.updatedAt
      const isRecent = lastAccess > cutoff
      const isImportant = entry.score > 0.7
      const stillNeedMore = toKeep.length < minKeep

      if (isRecent || isImportant || stillNeedMore) {
        toKeep.push(entry)
      } else {
        toPrune.push(entry)
      }
    }

    // Delete pruned memories
    for (const entry of toPrune) {
      await backend!.delete(entry.id)
    }

    log.info("memory pruning completed", {
      pruned: toPrune.length,
      kept: toKeep.length,
      inactiveDays,
    })

    return { pruned: toPrune.length, kept: toKeep.length }
  }

  /**
   * Get memory statistics
   */
  export async function getStats(): Promise<{
    totalMemories: number
    avgScore: number
    avgAccessCount: number
    oldestMemory: MemoryEntry | null
    newestMemory: MemoryEntry | null
  }> {
    assertInitialized()

    const allEntries = await backend!.list({ limit: 10000 })

    if (allEntries.length === 0) {
      return {
        totalMemories: 0,
        avgScore: 0,
        avgAccessCount: 0,
        oldestMemory: null,
        newestMemory: null,
      }
    }

    const sorted = allEntries.sort((a, b) => a.createdAt - b.createdAt)
    const totalScore = allEntries.reduce((sum, e) => sum + e.score, 0)
    const totalAccess = allEntries.reduce((sum, e) => sum + e.accessCount, 0)

    return {
      totalMemories: allEntries.length,
      avgScore: totalScore / allEntries.length,
      avgAccessCount: totalAccess / allEntries.length,
      oldestMemory: sorted[0],
      newestMemory: sorted[sorted.length - 1],
    }
  }

  /**
   * Export all memories as JSON
   */
  export async function exportAll(): Promise<MemoryEntry[]> {
    assertInitialized()
    return backend!.export()
  }

  /**
   * Check if vector memory is initialized
   */
  export function isInitialized(): boolean {
    return initialized && backend !== null
  }

  /**
   * Get the active backend
   */
  export function getBackend(): MemoryBackend {
    assertInitialized()
    return backend!
  }

  function assertInitialized(): asserts backend is MemoryBackend {
    if (!initialized || !backend) {
      throw new Error("Vector memory not initialized. Call init() first.")
    }
  }
}
