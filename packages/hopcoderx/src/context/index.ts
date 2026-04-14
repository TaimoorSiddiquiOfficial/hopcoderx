/**
 * Context Module for HopCoderX
 *
 * Lazy context loading from .hopcoderx/context/ directory.
 * Supports markdown (.md) and structured (.json/.yaml) formats.
 *
 * Features:
 * - On-demand loading based on query relevance
 * - LRU eviction when exceeding token budget
 * - Automatic relevance scoring
 * - TUI notifications for context loads
 *
 * Usage:
 *   import { Context } from "@/context"
 *   const ctx = await Context.create(projectDir, config)
 *   await ctx.autoload("implement authentication")
 */

export { ContextRegistry } from "./registry"
export type { ContextFile } from "./registry"

export { ContextLoader } from "./loader"
export type { LoaderOptions, LoadedContext, LoadResult } from "./loader"

export { ContextRelevance } from "./relevance"
export type { RelevanceOptions, RelevanceScore, Recommendation } from "./relevance"

import { Config } from "../config/config"
import { Log } from "../util/log"
import { ContextRegistry } from "./registry"
import { ContextLoader } from "./loader"
import { ContextRelevance } from "./relevance"

const log = Log.create({ service: "context" })

export interface ContextOptions {
  projectDir: string
  config?: Config.Info
}

export interface ContextState {
  registry: ContextRegistry
  loader: ContextLoader
  relevance: ContextRelevance
  enabled: boolean
}

const state = new Map<string, ContextState>()

export namespace Context {
  /**
   * Create and initialize context system for a project
   */
  export async function create(options: ContextOptions): Promise<ContextState> {
    const existing = state.get(options.projectDir)
    if (existing) {
      return existing
    }

    const config = options.config || (await Config.get())
    const ctxConfig = config.context

    const enabled = ctxConfig?.enabled ?? true
    if (!enabled) {
      log.info("context loading disabled by config")
      const disabled: ContextState = {
        registry: new ContextRegistry(options.projectDir),
        loader: null as any,
        relevance: null as any,
        enabled: false,
      }
      state.set(options.projectDir, disabled)
      return disabled
    }

    const contextDir = ctxConfig?.directory
      ? ctxConfig.directory.startsWith("~")
        ? ctxConfig.directory.replace("~", require("os").homedir())
        : ctxConfig.directory
      : undefined

    const registry = new ContextRegistry(options.projectDir, contextDir)
    await registry.scan(ctxConfig?.include, ctxConfig?.exclude)

    const loader = ContextLoader.create(registry, {
      maxFiles: ctxConfig?.maxFiles,
      maxTotalTokens: ctxConfig?.maxTotalTokens,
      notifyOnLoad: ctxConfig?.notifyOnLoad,
    })

    const relevance = ContextRelevance.create(registry, loader, {
      autoLoadThreshold: ctxConfig?.autoLoadThreshold,
    })

    const ctxState: ContextState = {
      registry,
      loader,
      relevance,
      enabled: true,
    }

    state.set(options.projectDir, ctxState)

    log.info("context system initialized", {
      projectDir: options.projectDir,
      contextDir: registry.getDirectory(),
      fileCount: registry.list().length,
      totalTokens: registry.getTotalTokens(),
    })

    return ctxState
  }

  /**
   * Get context state for a project
   */
  export function get(projectDir?: string): ContextState | undefined {
    const dir = projectDir || process.cwd()
    return state.get(dir)
  }

  /**
   * Check if context system is enabled and initialized
   */
  export function isEnabled(projectDir?: string): boolean {
    const ctx = get(projectDir)
    return ctx?.enabled === true
  }

  /**
   * Auto-load context files based on query relevance
   */
  export async function autoload(query: string, projectDir?: string): Promise<string[]> {
    const ctx = get(projectDir)
    if (!ctx?.enabled) return []

    return ctx.relevance.autoload(query)
  }

  /**
   * Manually load a context file
   */
  export async function load(filePath: string, projectDir?: string): Promise<boolean> {
    const ctx = get(projectDir)
    if (!ctx?.enabled) return false

    return ctx.loader.load(filePath)
  }

  /**
   * Unload a context file
   */
  export function unload(filePath: string, projectDir?: string): boolean {
    const ctx = get(projectDir)
    if (!ctx?.enabled) return false

    return ctx.loader.unload(filePath)
  }

  /**
   * Get loaded context content
   */
  export function getContent(projectDir?: string): string {
    const ctx = get(projectDir)
    if (!ctx?.enabled) return ""

    return ctx.loader.getAll()
  }

  /**
   * Get list of loaded context files
   */
  export function getLoadedPaths(projectDir?: string): string[] {
    const ctx = get(projectDir)
    if (!ctx?.enabled) return []

    return ctx.loader.getLoadedPaths()
  }

  /**
   * Get context loading statistics
   */
  export function getStats(projectDir?: string): {
    enabled: boolean
    loadedFiles: number
    totalTokens: number
    maxTokens: number
    utilizationPercent: number
  } | null {
    const ctx = get(projectDir)
    if (!ctx) return null

    if (!ctx.enabled) {
      return {
        enabled: false,
        loadedFiles: 0,
        totalTokens: 0,
        maxTokens: 0,
        utilizationPercent: 0,
      }
    }

    const stats = ctx.loader.getStats()
    return {
      enabled: true,
      ...stats,
    }
  }

  /**
   * Clear all loaded context
   */
  export function clear(projectDir?: string): void {
    const ctx = get(projectDir)
    if (!ctx?.enabled) return

    ctx.loader.clear()
  }

  /**
   * Cleanup context state
   */
  export function dispose(projectDir?: string): void {
    const dir = projectDir || process.cwd()
    state.delete(dir)
    log.debug("context state disposed", { projectDir: dir })
  }
}
