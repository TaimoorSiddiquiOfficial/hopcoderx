/**
 * MCP control tool — lets the AI enable, disable, and list MCP servers.
 *
 * The AI uses this to self-configure based on context:
 *   - Before accessing GitHub → enable builtin:github
 *   - Before querying DB    → enable builtin:postgres
 *   - After task completes  → optionally disable heavy servers
 */

import z from "zod"
import { Tool } from "./tool"
import { MCP } from "../mcp"
import { Config } from "../config/config"
import { McpBuiltins } from "../mcp/builtins"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import path from "path"

export const McpControlTool = Tool.define("mcp_control", {
  description:
    "Enable, disable, or list MCP (Model Context Protocol) servers. Use this to self-configure tools needed for the current task. " +
    "Before accessing GitHub repos, enable 'builtin:github'. Before querying a database, enable 'builtin:postgres' or 'builtin:sqlite'. " +
    "Call list first to see current status, then enable/disable as needed.",
  parameters: z.object({
    action: z
      .enum(["list", "enable", "disable", "status"])
      .describe(
        "list: show all servers with status | enable: start a server | disable: stop a server | status: check a specific server",
      ),
    server_id: z
      .string()
      .optional()
      .describe(
        "Server ID for enable/disable/status actions. Use 'builtin:' prefix for built-ins, e.g. 'builtin:github', 'builtin:postgres', 'builtin:filesystem'. " +
          "Or use custom server names from user config.",
      ),
  }),
  async execute(params, _ctx) {
    type Meta = Record<string, unknown>

    if (params.action === "list") {
      const allStatus = await MCP.status()
      const builtinLines: string[] = []
      const customLines: string[] = []

      for (const entry of McpBuiltins.catalog) {
        const s = allStatus[entry.id]
        const statusLabel = s ? s.status : "not-configured"
        builtinLines.push(`  ${entry.icon} ${entry.id.padEnd(35)} [${statusLabel}]  ${entry.description.slice(0, 60)}`)
      }

      for (const [key, status] of Object.entries(allStatus)) {
        if (!key.startsWith("builtin:")) {
          customLines.push(`  📦 ${key.padEnd(35)} [${status.status}]`)
        }
      }

      const output = [
        "── Built-in MCP Servers ─────────────────────────────────",
        builtinLines.join("\n"),
        ...(customLines.length
          ? ["", "── Custom MCP Servers ───────────────────────────────────", customLines.join("\n")]
          : []),
      ].join("\n")

      return {
        title: "mcp_control — list",
        output,
        metadata: { total: Object.keys(allStatus).length } as Meta,
      }
    }

    if (!params.server_id) {
      return { title: "mcp_control", output: "Error: server_id is required for this action.", metadata: {} as Meta }
    }

    const id = params.server_id

    if (params.action === "status") {
      const allStatus = await MCP.status()
      const s = allStatus[id]
      if (!s) {
        return {
          title: `mcp_control — status`,
          output: `Server '${id}' is not configured. Use action: 'enable' to add it.`,
          metadata: { id, configured: false } as Meta,
        }
      }
      return {
        title: `mcp_control — status`,
        output: `${id}: ${JSON.stringify(s, null, 2)}`,
        metadata: { id, status: s.status } as Meta,
      }
    }

    if (params.action === "enable") {
      const builtin = McpBuiltins.getById(id)
      if (!builtin) {
        return {
          title: "mcp_control — enable",
          output: `Unknown server '${id}'. Use action: 'list' to see available servers.`,
          metadata: { id } as Meta,
        }
      }
      if (builtin.requiresCredentials) {
        const missing = (builtin.requiredEnvVars ?? []).filter((k) => !process.env[k])
        if (missing.length > 0) {
          return {
            title: "mcp_control — enable",
            output: [
              `Cannot enable '${id}': missing required environment variables: ${missing.join(", ")}`,
              "",
              builtin.setupGuide ?? "Please set the required environment variables and try again.",
            ].join("\n"),
            metadata: { id, missing_env: missing } as Meta,
          }
        }
      }

      const mcpConfig = McpBuiltins.toMcpConfig(builtin, true)
      await MCP.add(id, mcpConfig)
      await persistMcpConfig(id, mcpConfig)

      return {
        title: `mcp_control — enable`,
        output: `✅ Enabled MCP server: ${builtin.icon} ${builtin.name} (${id})`,
        metadata: { id, enabled: true } as Meta,
      }
    }

    if (params.action === "disable") {
      await MCP.disconnect(id)
      await persistMcpConfig(id, undefined)

      return {
        title: `mcp_control — disable`,
        output: `⏹ Disabled MCP server: ${id}`,
        metadata: { id, enabled: false } as Meta,
      }
    }

    return { title: "mcp_control", output: "Unknown action.", metadata: {} as Meta }
  },
})

/** Persist enabled/disabled state back to the global config file. */
async function persistMcpConfig(id: string, mcpConfig: Config.Mcp | undefined) {
  try {
    const configPath = path.join(Global.Path.config, "hopcoderx.json")
    let existing: Record<string, unknown> = {}
    try {
      const raw = await Filesystem.readText(configPath)
      if (raw) existing = JSON.parse(raw) as Record<string, unknown>
    } catch {}

    const mcp = (existing.mcp ?? {}) as Record<string, unknown>
    if (mcpConfig === undefined) {
      delete mcp[id]
    } else {
      mcp[id] = mcpConfig
    }
    existing.mcp = mcp

    await Filesystem.writeJson(configPath, existing)
  } catch {
    // Non-fatal — in-memory state is already updated
  }
}

