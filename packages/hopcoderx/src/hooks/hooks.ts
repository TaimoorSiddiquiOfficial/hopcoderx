/**
 * Hook/middleware system for HopCoderX.
 *
 * Allows user-defined JS modules to intercept agent lifecycle events:
 *   before-agent-start    → called before agent begins a session
 *   before-agent-reply    → called before agent sends a response
 *   before-tool-call      → called before any tool is executed
 *   after-tool-call       → called after a tool returns
 *   after-agent-reply     → called after agent sends a response
 *
 * Hook modules are loaded from:
 *   1. Workspace: .hopcoderx/hooks/*.{ts,js}
 *   2. Global: ~/.config/hopcoderx/hooks/*.{ts,js}
 *
 * Hook module shape:
 *   export default {
 *     "before-tool-call": async (ctx) => { ... },
 *     "after-agent-reply": async (ctx) => { ... },
 *   }
 */

import { join } from "path"
import { existsSync, readdirSync } from "fs"
import { Global } from "../global"
import { Log } from "../util/log"

// ─── Types ─────────────────────────────────────────────────────────────────────

export type HookEvent =
  | "before-agent-start"
  | "before-agent-reply"
  | "before-tool-call"
  | "after-tool-call"
  | "after-agent-reply"

export interface HookContext {
  event: HookEvent
  sessionId?: string
  agentId?: string
  toolName?: string
  toolArgs?: Record<string, any>
  toolResult?: any
  message?: string
  /** Mutate to modify the args/message before the call happens */
  [key: string]: any
}

export type HookFn = (ctx: HookContext) => void | Promise<void>

export interface HookModule {
  [event: string]: HookFn
}

// ─── Registry ──────────────────────────────────────────────────────────────────

const _hooks: Map<HookEvent, HookFn[]> = new Map()
let _initialized = false

export const Hooks = {
  /** Register a hook function for an event */
  on(event: HookEvent, fn: HookFn): void {
    if (!_hooks.has(event)) _hooks.set(event, [])
    _hooks.get(event)!.push(fn)
  },

  /** Remove all hooks for an event */
  off(event: HookEvent): void {
    _hooks.delete(event)
  },

  /** Run all hooks for an event. Hooks run in order; errors are caught and logged. */
  async run(event: HookEvent, ctx: Omit<HookContext, "event">): Promise<HookContext> {
    const fullCtx: HookContext = { ...ctx, event }
    const fns = _hooks.get(event) ?? []
    for (const fn of fns) {
      try { await fn(fullCtx) } catch (e) {
        Log.Default.warn(`${event} hook error`, {
          service: "hooks",
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
    return fullCtx
  },

  /** Load hook modules from a directory */
  async loadDir(dir: string): Promise<number> {
    if (!existsSync(dir)) return 0
    let loaded = 0
    const files = readdirSync(dir).filter((f) => /\.[jt]s$/.test(f))
    for (const file of files) {
      try {
        const mod = await import(join(dir, file))
        const hooks: HookModule = mod.default ?? mod
        for (const [evt, fn] of Object.entries(hooks)) {
          if (typeof fn === "function") {
            this.on(evt as HookEvent, fn)
            loaded++
          }
        }
      } catch (e) {
        Log.Default.warn("failed to load hook file", {
          service: "hooks.load",
          file,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
    return loaded
  },

  /** Initialize — load workspace + global hooks */
  async init(workspaceRoot?: string): Promise<void> {
    if (_initialized) return
    _initialized = true

    // Global hooks
    await this.loadDir(join(Global.Path.config, "hooks"))

    // Workspace hooks
    if (workspaceRoot) {
      await this.loadDir(join(workspaceRoot, ".hopcoderx", "hooks"))
    }
  },

  /** List all registered hooks */
  list(): { event: HookEvent; count: number }[] {
    return Array.from(_hooks.entries()).map(([event, fns]) => ({ event, count: fns.length }))
  },

  /** Clear all hooks (for testing) */
  clear(): void {
    _hooks.clear()
    _initialized = false
  },
}
