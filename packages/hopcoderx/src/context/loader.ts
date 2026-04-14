/**
 * Context Loader for HopCoderX
 *
 * Handles lazy loading of context files with:
 * - In-memory caching
 * - Token counting and budget enforcement
 * - LRU eviction when exceeding limits
 *
 * Usage:
 *   const loader = ContextLoader.create(registry)
 *   await loader.load("architecture.md")
 *   const content = loader.get("architecture.md")
 *   const tokens = loader.getTotalTokens()
 */

import { readFile } from "fs/promises"
import { Log } from "../util/log"
import { Token } from "../util/token"
import type { ContextFile, ContextRegistry } from "./registry"

const log = Log.create({ service: "context-loader" })

export interface LoaderOptions {
  /** Maximum number of files to keep loaded */
  maxFiles?: number
  /** Maximum total tokens allowed */
  maxTotalTokens?: number
  /** Notify when files are loaded */
  notifyOnLoad?: boolean
}

export interface LoadedContext {
  /** File path */
  path: string
  /** File content */
  content: string
  /** Token count */
  tokens: number
  /** Load timestamp */
  loadedAt: number
}

export interface LoadResult {
  /** Successfully loaded files */
  loaded: string[]
  /** Files skipped (already loaded or budget exceeded) */
  skipped: string[]
  /** Files evicted to make room */
  evicted: string[]
  /** Total tokens after loading */
  totalTokens: number
}

interface CacheEntry extends LoadedContext {
  /** Last access time for LRU */
  lastAccess: number
  /** Access count */
  accessCount: number
}

export class ContextLoader {
  private registry: ContextRegistry
  private cache: Map<string, CacheEntry> = new Map()
  private options: Required<LoaderOptions>

  private constructor(registry: ContextRegistry, options: LoaderOptions = {}) {
    this.registry = registry
    this.options = {
      maxFiles: options.maxFiles ?? 10,
      maxTotalTokens: options.maxTotalTokens ?? 50000,
      notifyOnLoad: options.notifyOnLoad ?? true,
    }
  }

  static create(registry: ContextRegistry, options?: LoaderOptions): ContextLoader {
    return new ContextLoader(registry, options)
  }

  /** Load a context file into cache */
  async load(filePath: string): Promise<boolean> {
    // Already loaded
    if (this.cache.has(filePath)) {
      const entry = this.cache.get(filePath)!
      entry.lastAccess = Date.now()
      entry.accessCount++
      return true
    }

    // Check if file exists in registry
    const file = this.registry.get(filePath)
    if (!file) {
      log.warn("context file not found in registry", { path: filePath })
      return false
    }

    // Check token budget
    const currentTokens = this.getTotalTokens()
    if (currentTokens + file.tokens > this.options.maxTotalTokens) {
      // Try to evict LRU entries
      const evicted = this.evictLRU(file.tokens)
      if (evicted.length === 0) {
        log.warn("cannot load context file - budget exceeded", {
          path: filePath,
          fileTokens: file.tokens,
          currentTokens,
          maxTokens: this.options.maxTotalTokens,
        })
        return false
      }
      log.info("evicted context files for budget", {
        evicted: evicted.length,
      })
    }

    // Check file count limit
    if (this.cache.size >= this.options.maxFiles) {
      const evicted = this.evictLRU(file.tokens)
      if (evicted.length === 0) {
        log.warn("cannot load context file - max files reached", {
          path: filePath,
          currentFiles: this.cache.size,
          maxFiles: this.options.maxFiles,
        })
        return false
      }
    }

    // Load file content
    try {
      const content = await readFile(file.path, "utf8")
      const entry: CacheEntry = {
        path: file.path,
        content,
        tokens: file.tokens,
        loadedAt: Date.now(),
        lastAccess: Date.now(),
        accessCount: 1,
      }

      this.cache.set(file.path, entry)
      this.registry.recordLoad(file.path)

      log.info("loaded context file", {
        path: file.relativePath,
        tokens: file.tokens,
        totalTokens: this.getTotalTokens(),
      })

      return true
    } catch (err) {
      log.error("failed to load context file", {
        path: filePath,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  }

  /** Load multiple context files */
  async loadMultiple(filePaths: string[]): Promise<LoadResult> {
    const result: LoadResult = {
      loaded: [],
      skipped: [],
      evicted: [],
      totalTokens: this.getTotalTokens(),
    }

    for (const path of filePaths) {
      if (this.cache.has(path)) {
        result.skipped.push(path)
        continue
      }

      const success = await this.load(path)
      if (success) {
        result.loaded.push(path)
      } else {
        result.skipped.push(path)
      }
    }

    result.totalTokens = this.getTotalTokens()
    return result
  }

  /** Unload a context file */
  unload(filePath: string): boolean {
    const entry = this.cache.get(filePath)
    if (!entry) return false

    this.cache.delete(filePath)
    log.debug("unloaded context file", { path: filePath })
    return true
  }

  /** Unload multiple files by pattern */
  unloadByPattern(pattern: string): string[] {
    const unloaded: string[] = []
    for (const path of this.cache.keys()) {
      if (path.includes(pattern)) {
        this.cache.delete(path)
        unloaded.push(path)
      }
    }
    if (unloaded.length > 0) {
      log.debug("unloaded context files by pattern", { pattern, count: unloaded.length })
    }
    return unloaded
  }

  /** Clear all loaded context */
  clear(): void {
    const count = this.cache.size
    this.cache.clear()
    log.info("cleared all context files", { count })
  }

  /** Get loaded content for a file */
  get(filePath: string): string | undefined {
    const entry = this.cache.get(filePath)
    if (!entry) return undefined

    entry.lastAccess = Date.now()
    entry.accessCount++
    return entry.content
  }

  /** Get all loaded content as a single string */
  getAll(): string {
    const entries = Array.from(this.cache.values()).sort((a, b) => a.path.localeCompare(b.path))
    return entries.map((e) => `---\nContext: ${e.path}\n---\n\n${e.content}`).join("\n\n")
  }

  /** Get list of loaded file paths */
  getLoadedPaths(): string[] {
    return Array.from(this.cache.keys()).sort()
  }

  /** Get loaded file info */
  getLoadedInfo(): LoadedContext[] {
    return Array.from(this.cache.values()).map(({ path, content: _, ...rest }) => ({
      path,
      content: "",
      ...rest,
    }))
  }

  /** Get total tokens of loaded context */
  getTotalTokens(): number {
    let total = 0
    for (const entry of this.cache.values()) {
      total += entry.tokens
    }
    return total
  }

  /** Get remaining token budget */
  getRemainingTokens(): number {
    return this.options.maxTotalTokens - this.getTotalTokens()
  }

  /** Check if a file is loaded */
  isLoaded(filePath: string): boolean {
    return this.cache.has(filePath)
  }

  /** Get cache statistics */
  getStats(): {
    loadedFiles: number
    maxFiles: number
    totalTokens: number
    maxTokens: number
    utilizationPercent: number
  } {
    const totalTokens = this.getTotalTokens()
    return {
      loadedFiles: this.cache.size,
      maxFiles: this.options.maxFiles,
      totalTokens,
      maxTokens: this.options.maxTotalTokens,
      utilizationPercent: Math.round((totalTokens / this.options.maxTotalTokens) * 100),
    }
  }

  /** Evict least recently used entries to make room */
  private evictLRU(neededTokens: number): string[] {
    const evicted: string[] = []
    const entries = Array.from(this.cache.entries()).sort(
      (a, b) => a[1].lastAccess - b[1].lastAccess,
    )

    let freedTokens = 0
    for (const [path, entry] of entries) {
      if (freedTokens >= neededTokens) break

      this.cache.delete(path)
      evicted.push(path)
      freedTokens += entry.tokens
    }

    return evicted
  }

  /** Get high-relevance files that should be preloaded */
  getRecommendedFiles(limit: number = 5): ContextFile[] {
    return this.registry.getByRelevance(limit).filter((f) => !this.cache.has(f.path))
  }

  /** Preload high-relevance files */
  async preload(limit: number = 5): Promise<string[]> {
    const recommended = this.getRecommendedFiles(limit)
    const loaded: string[] = []

    for (const file of recommended) {
      if (this.getTotalTokens() + file.tokens > this.options.maxTotalTokens) {
        break
      }
      const success = await this.load(file.path)
      if (success) {
        loaded.push(file.relativePath)
      }
    }

    if (loaded.length > 0) {
      log.info("preloaded context files", { count: loaded.length, files: loaded })
    }

    return loaded
  }
}
