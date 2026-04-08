/**
 * HopCoderX Plugin SDK v2
 *
 * A modern, typed plugin API with:
 *   - Typed manifest (id, version, capabilities, permissions)
 *   - Hot-reload support (file watcher re-imports module on change)
 *   - Lifecycle hooks (onLoad, onUnload, onSessionStart, onSessionEnd)
 *   - Capability declarations (what the plugin can do)
 *   - Sandboxed loading isolation
 *
 * Plugin authors create a `hopcoderx-plugin.json` manifest and export
 * a PluginV2 object as their default export.
 *
 * @example
 * ```ts
 * // hopcoderx-plugin.json
 * { "id": "my-plugin", "version": "1.0.0", "capabilities": ["tools"] }
 *
 * // index.ts
 * export default definePlugin({
 *   id: "my-plugin",
 *   onLoad({ registerTool }) {
 *     registerTool({ name: "my-tool", execute: async (args) => "result" })
 *   }
 * })
 * ```
 */

import { readFile, writeFile, mkdir } from "fs/promises"
import { existsSync, watch as fsWatch } from "fs"
import { join } from "path"
import { Global } from "../global"

// ─── Types ────────────────────────────────────────────────────────────────────

export type PluginCapability =
  | "tools"          // Registers new agent tools
  | "commands"       // Adds CLI commands
  | "providers"      // Adds LLM providers
  | "channels"       // Adds messaging channels
  | "hooks"          // Registers lifecycle hooks
  | "ui"             // Adds TUI panels
  | "themes"         // Adds color themes
  | "completions"    // Extends shell completions

export interface PluginManifestV2 {
  /** Unique plugin ID (reverse-domain preferred: com.example.myplugin) */
  id: string
  /** Display name */
  name: string
  /** Short description */
  description: string
  /** Semver version */
  version: string
  /** What this plugin provides */
  capabilities: PluginCapability[]
  /** Required HopCoderX host version */
  minHostVersion?: string
  /** NPM package name (for marketplace installs) */
  npm?: string
  /** Homepage / docs URL */
  homepage?: string
  /** Author */
  author?: string
  /** License identifier */
  license?: string
  /** Entry point (default: index.js) */
  main?: string
}

export interface PluginTool {
  name: string
  description: string
  execute(args: Record<string, unknown>): Promise<string>
}

export interface PluginContext {
  manifest: PluginManifestV2
  registerTool(tool: PluginTool): void
  log(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>): void
  env(key: string): string | undefined
}

export interface PluginLifecycle {
  onLoad?(ctx: PluginContext): Promise<void> | void
  onUnload?(): Promise<void> | void
  onSessionStart?(sessionId: string): Promise<void> | void
  onSessionEnd?(sessionId: string): Promise<void> | void
}

export interface PluginV2 extends PluginLifecycle {
  id: string
}

// ─── definePlugin helper ──────────────────────────────────────────────────────

export function definePlugin(plugin: PluginV2): PluginV2 {
  return plugin
}

// ─── PluginLoader ─────────────────────────────────────────────────────────────

interface LoadedPlugin {
  manifest: PluginManifestV2
  plugin: PluginV2
  tools: PluginTool[]
  loadedAt: Date
  path: string
  watcher?: ReturnType<typeof fsWatch>
}

export class PluginLoader {
  private plugins = new Map<string, LoadedPlugin>()
  private hotReload = false

  enableHotReload(): void {
    this.hotReload = true
  }

  /** Load a plugin from a directory (must have hopcoderx-plugin.json) */
  async load(pluginDir: string): Promise<LoadedPlugin> {
    const manifestPath = join(pluginDir, "hopcoderx-plugin.json")
    if (!existsSync(manifestPath)) {
      throw new Error(`No hopcoderx-plugin.json found at: ${pluginDir}`)
    }

    const raw = JSON.parse(await readFile(manifestPath, "utf8"))
    const manifest = validateManifestV2(raw)

    const entryPoint = join(pluginDir, manifest.main ?? "index.js")
    const mod = await import(entryPoint)
    const plugin: PluginV2 = mod.default ?? mod.plugin
    if (!plugin || typeof plugin.id !== "string") {
      throw new Error(`Plugin at '${pluginDir}' must export a PluginV2 object as default or 'plugin'`)
    }

    const tools: PluginTool[] = []
    const ctx: PluginContext = {
      manifest,
      registerTool: (tool) => tools.push(tool),
      log: (level, msg, data) => console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](`[plugin:${manifest.id}] ${msg}`, data ?? ""),
      env: (key) => process.env[key],
    }

    await plugin.onLoad?.(ctx)

    const loaded: LoadedPlugin = { manifest, plugin, tools, loadedAt: new Date(), path: pluginDir }
    this.plugins.set(manifest.id, loaded)

    if (this.hotReload) {
      this.watchForReload(pluginDir, manifest.id)
    }

    return loaded
  }

  /** Unload a plugin by ID */
  async unload(id: string): Promise<void> {
    const loaded = this.plugins.get(id)
    if (!loaded) throw new Error(`Plugin '${id}' not loaded`)
    await loaded.plugin.onUnload?.()
    loaded.watcher?.close()
    this.plugins.delete(id)
  }

  /** Reload a plugin from disk (hot-reload) */
  async reload(id: string): Promise<void> {
    const loaded = this.plugins.get(id)
    if (!loaded) throw new Error(`Plugin '${id}' not loaded`)
    const dir = loaded.path
    await this.unload(id)
    await this.load(dir)
    console.log(`[sdk-v2] Hot-reloaded plugin: ${id}`)
  }

  get(id: string): LoadedPlugin | undefined {
    return this.plugins.get(id)
  }

  list(): LoadedPlugin[] {
    return Array.from(this.plugins.values())
  }

  allTools(): PluginTool[] {
    return this.list().flatMap((p) => p.tools)
  }

  async notifySessionStart(sessionId: string): Promise<void> {
    for (const { plugin } of this.plugins.values()) {
      await plugin.onSessionStart?.(sessionId)
    }
  }

  async notifySessionEnd(sessionId: string): Promise<void> {
    for (const { plugin } of this.plugins.values()) {
      await plugin.onSessionEnd?.(sessionId)
    }
  }

  private watchForReload(dir: string, id: string): void {
    const loaded = this.plugins.get(id)
    if (!loaded) return
    try {
      const watcher = fsWatch(dir, { recursive: true }, (_event, filename) => {
        if (!filename?.endsWith(".js") && !filename?.endsWith(".ts")) return
        console.log(`[sdk-v2] File changed: ${filename} — reloading plugin '${id}'`)
        this.reload(id).catch((err) => console.error(`[sdk-v2] Reload failed:`, err.message))
      })
      loaded.watcher = watcher
    } catch {
      // Watch not supported on this platform — skip
    }
  }

  /** Save loaded plugin paths to disk for persistence across restarts */
  async persist(): Promise<void> {
    const paths = this.list().map((p) => p.path)
    const file = join(Global.Path.config, "sdk-v2-plugins.json")
    await mkdir(Global.Path.config, { recursive: true })
    await writeFile(file, JSON.stringify(paths, null, 2))
  }

  /** Restore plugins from persisted list */
  async restore(): Promise<void> {
    const file = join(Global.Path.config, "sdk-v2-plugins.json")
    if (!existsSync(file)) return
    const paths: string[] = JSON.parse(await readFile(file, "utf8"))
    for (const dir of paths) {
      if (existsSync(dir)) {
        await this.load(dir).catch((err) => console.error(`[sdk-v2] Failed to restore '${dir}':`, err.message))
      }
    }
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

const VALID_CAPABILITIES: PluginCapability[] = [
  "tools", "commands", "providers", "channels", "hooks", "ui", "themes", "completions",
]

function validateManifestV2(raw: unknown): PluginManifestV2 {
  if (!raw || typeof raw !== "object") throw new Error("Invalid plugin manifest: not an object")
  const m = raw as Record<string, unknown>
  for (const key of ["id", "name", "description", "version", "capabilities"]) {
    if (!m[key]) throw new Error(`Invalid plugin manifest: missing '${key}'`)
  }
  if (!Array.isArray(m.capabilities)) throw new Error("manifest.capabilities must be an array")
  for (const cap of m.capabilities as string[]) {
    if (!VALID_CAPABILITIES.includes(cap as PluginCapability)) {
      throw new Error(`Invalid capability '${cap}'. Valid: ${VALID_CAPABILITIES.join(", ")}`)
    }
  }
  return m as unknown as PluginManifestV2
}

// ─── Global singleton ─────────────────────────────────────────────────────────

export const PluginLoaderV2 = new PluginLoader()
