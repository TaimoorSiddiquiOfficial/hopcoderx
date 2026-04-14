/**
 * Context Relevance Engine for HopCoderX
 *
 * Determines which context files to load based on:
 * - Keyword matching between query and file metadata/content
 * - Conversation context (recent files referenced)
 * - Recency (LRU-style scoring)
 * - Directory context (files related to current working directory)
 *
 * Usage:
 *   const relevance = ContextRelevance.create(registry, loader)
 *   const score = relevance.score("how does authentication work?", "auth.md")
 *   const recommended = relevance.recommend("implement API endpoint")
 */

import { Log } from "../util/log"
import type { ContextFile, ContextRegistry } from "./registry"
import type { ContextLoader } from "./loader"

const log = Log.create({ service: "context-relevance" })

export interface RelevanceOptions {
  /** Minimum score threshold for auto-loading (0-1) */
  autoLoadThreshold?: number
  /** Weight for keyword matching */
  keywordWeight?: number
  /** Weight for recency */
  recencyWeight?: number
  /** Weight for conversation context */
  contextWeight?: number
}

export interface RelevanceScore {
  /** File path */
  path: string
  /** Overall relevance score (0-1) */
  score: number
  /** Breakdown of score components */
  breakdown: {
    keyword: number
    recency: number
    context: number
  }
  /** Reason for recommendation */
  reason: string[]
}

export interface Recommendation {
  /** Files recommended to load */
  toLoad: ContextFile[]
  /** Files already loaded (keep) */
  loaded: ContextFile[]
  /** Files recommended to unload */
  toUnload: ContextFile[]
}

export class ContextRelevance {
  private registry: ContextRegistry
  private loader: ContextLoader
  private options: Required<RelevanceOptions>

  private constructor(registry: ContextRegistry, loader: ContextLoader, options: RelevanceOptions = {}) {
    this.registry = registry
    this.loader = loader
    this.options = {
      autoLoadThreshold: options.autoLoadThreshold ?? 0.3,
      keywordWeight: options.keywordWeight ?? 0.5,
      recencyWeight: options.recencyWeight ?? 0.2,
      contextWeight: options.contextWeight ?? 0.3,
    }
  }

  static create(registry: ContextRegistry, loader: ContextLoader, options?: RelevanceOptions): ContextRelevance {
    return new ContextRelevance(registry, loader, options)
  }

  /**
   * Calculate relevance score for a single file given a query
   */
  score(query: string, filePath: string): RelevanceScore | undefined {
    const file = this.registry.get(filePath)
    if (!file) return undefined

    const queryLower = query.toLowerCase()
    const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 2)

    // Keyword matching
    let keywordScore = 0
    const keywordReasons: string[] = []

    for (const term of queryTerms) {
      // Name matching (highest weight)
      if (file.name.toLowerCase().includes(term)) {
        keywordScore += 0.25
        keywordReasons.push(`name matches "${term}"`)
      }

      // Description matching
      if (file.description.toLowerCase().includes(term)) {
        keywordScore += 0.15
        keywordReasons.push(`description matches "${term}"`)
      }

      // Tag matching
      for (const tag of file.tags) {
        if (tag.toLowerCase().includes(term)) {
          keywordScore += 0.1
          keywordReasons.push(`tag "${tag}" matches "${term}"`)
          break
        }
      }

      // Category matching
      for (const category of file.categories) {
        if (category.toLowerCase().includes(term)) {
          keywordScore += 0.1
          keywordReasons.push(`category "${category}" matches "${term}"`)
          break
        }
      }
    }

    keywordScore = Math.min(1, keywordScore)

    // Recency scoring
    let recencyScore = 0
    const recencyReasons: string[] = []

    if (file.lastLoaded) {
      const ageHours = (Date.now() - file.lastLoaded) / (1000 * 60 * 60)
      if (ageHours < 0.5) {
        recencyScore = 0.8
        recencyReasons.push("loaded in last 30 minutes")
      } else if (ageHours < 2) {
        recencyScore = 0.6
        recencyReasons.push("loaded in last 2 hours")
      } else if (ageHours < 24) {
        recencyScore = 0.4
        recencyReasons.push("loaded in last 24 hours")
      } else if (ageHours < 168) {
        recencyScore = 0.2
        recencyReasons.push("loaded in last week")
      }
    }

    // Context scoring (conversation history)
    let contextScore = 0
    const contextReasons: string[] = []

    if (this.loader.isLoaded(filePath)) {
      const entry = (this.loader as any).cache?.get(filePath)
      if (entry?.accessCount > 1) {
        contextScore = 0.7
        contextReasons.push(`referenced ${entry.accessCount} times in conversation`)
      } else {
        contextScore = 0.3
        contextReasons.push("currently loaded in context")
      }
    }

    // Weighted combination
    const totalScore =
      keywordScore * this.options.keywordWeight +
      recencyScore * this.options.recencyWeight +
      contextScore * this.options.contextWeight

    const allReasons = [...keywordReasons, ...recencyReasons, ...contextReasons]

    return {
      path: filePath,
      score: Math.min(1, totalScore),
      breakdown: {
        keyword: keywordScore,
        recency: recencyScore,
        context: contextScore,
      },
      reason: allReasons,
    }
  }

  /**
   * Get recommendations based on a query
   */
  recommend(query: string, options?: { maxResults?: number; includeLoaded?: boolean }): Recommendation {
    const maxResults = options?.maxResults ?? 5
    const includeLoaded = options?.includeLoaded ?? false

    const allFiles = this.registry.list()
    const scores: RelevanceScore[] = []

    for (const file of allFiles) {
      const score = this.score(query, file.path)
      if (score && score.score > 0) {
        scores.push(score)
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score)

    const toLoad: ContextFile[] = []
    const loaded: ContextFile[] = []
    const toUnload: ContextFile[] = []

    for (const score of scores) {
      const file = this.registry.get(score.path)
      if (!file) continue

      if (this.loader.isLoaded(score.path)) {
        loaded.push(file)
      } else if (toLoad.length < maxResults && score.score >= this.options.autoLoadThreshold) {
        toLoad.push(file)
      }
    }

    // Find loaded files with low relevance that could be unloaded
    const loadedPaths = new Set(loaded.map((f) => f.path))
    for (const loadedFile of this.loader.getLoadedInfo()) {
      if (!loadedPaths.has(loadedFile.path)) {
        const file = this.registry.get(loadedFile.path)
        if (file) {
          const score = this.score(query, loadedFile.path)
          if (!score || score.score < 0.1) {
            toUnload.push(file)
          }
        }
      }
    }

    return { toLoad, loaded, toUnload }
  }

  /**
   * Score based on current working directory context
   */
  scoreByDirectory(dir: string): ContextFile[] {
    const dirLower = dir.toLowerCase()
    const files = this.registry.list()
    const scored: { file: ContextFile; score: number }[] = []

    for (const file of files) {
      let score = 0

      // Check if file path contains directory components
      const relativePath = file.relativePath.toLowerCase()
      const dirParts = dirLower.split(/[\\/]/).filter((p) => p.length > 2)

      for (const part of dirParts) {
        if (relativePath.includes(part)) {
          score += 0.3
        }
        if (file.categories.some((c) => c.toLowerCase().includes(part))) {
          score += 0.2
        }
      }

      if (score > 0) {
        scored.push({ file, score: Math.min(1, score) })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.map((s) => s.file)
  }

  /**
   * Auto-load relevant files based on query
   * Returns list of files that were loaded
   */
  async autoload(query: string): Promise<string[]> {
    const recommendation = this.recommend(query)
    const loaded: string[] = []

    // Check budget before loading
    let remainingTokens = this.loader.getRemainingTokens()

    for (const file of recommendation.toLoad) {
      if (file.tokens <= remainingTokens) {
        const success = await this.loader.load(file.path)
        if (success) {
          loaded.push(file.relativePath)
          remainingTokens -= file.tokens
        }
      }
    }

    // Unload low-relevance files
    for (const file of recommendation.toUnload) {
      this.loader.unload(file.path)
    }

    if (loaded.length > 0) {
      log.info("auto-loaded context files", {
        query: query.slice(0, 50),
        count: loaded.length,
        files: loaded,
      })
    }

    return loaded
  }

  /**
   * Update registry relevance scores based on query
   */
  updateScores(query: string, recentFiles?: string[]): void {
    this.registry.updateRelevance(query, recentFiles)
  }

  /**
   * Get explanation for why a file was/wasn't loaded
   */
  explain(query: string, filePath: string): string {
    const file = this.registry.get(filePath)
    if (!file) {
      return `File not found in context registry: ${filePath}`
    }

    const score = this.score(query, filePath)
    if (!score) {
      return `No relevance score for: ${filePath}`
    }

    const isLoaded = this.loader.isLoaded(filePath)
    const threshold = this.options.autoLoadThreshold

    if (isLoaded) {
      return `✅ "${file.relativePath}" is loaded\n   Score: ${score.score.toFixed(2)} (threshold: ${threshold})\n   Reasons: ${score.reason.join(", ") || "preloaded"}`
    }

    if (score.score >= threshold) {
      return `⏳ "${file.relativePath}" should be loaded\n   Score: ${score.score.toFixed(2)} >= ${threshold}\n   Reasons: ${score.reason.join(", ")}`
    }

    return `⏭️ "${file.relativePath}" skipped\n   Score: ${score.score.toFixed(2)} < ${threshold}\n   Keyword: ${score.breakdown.keyword.toFixed(2)}, Recency: ${score.breakdown.recency.toFixed(2)}, Context: ${score.breakdown.context.toFixed(2)}`
  }
}
