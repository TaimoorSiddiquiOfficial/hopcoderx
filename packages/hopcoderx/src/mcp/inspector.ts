/**
 * MCP Inspector - Visual debugging UI for MCP servers
 *
 * Features:
 * - List connected MCP servers
 * - View available tools with schemas
 * - Test tool calls interactively
 * - View server logs and status
 * - OAuth debugging
 */

import { Log } from "../util/log"
import { MCP } from "./index"
import { Config } from "../config/config"
import { UI } from "../cli/ui"
import * as prompts from "@clack/prompts"
import { TextLayout } from "../util/text-layout"

const log = Log.create({ service: "mcp-inspector" })

export namespace McpInspector {
  interface ServerInfo {
    name: string
    status: "connected" | "disconnected" | "error" | "needs_auth"
    tools: MCPToolInfo[]
    resources: MCPResourceInfo[]
    error?: string
  }

  interface MCPToolInfo {
    name: string
    description: string
    inputSchema: Record<string, unknown>
    required: string[]
  }

  interface MCPResourceInfo {
    uri: string
    name: string
    description?: string
    mimeType?: string
  }

  /**
   * Run the interactive MCP inspector
   */
  export async function run(): Promise<void> {
    UI.empty()
    prompts.intro("MCP Inspector")

    const config = await Config.get()
    const mcpConfig = config.mcp ?? {}

    if (Object.keys(mcpConfig).length === 0) {
      prompts.log.warn("No MCP servers configured")
      prompts.outro("Add servers with: hopcoderx mcp add")
      return
    }

    const serverNames = Object.keys(mcpConfig)
    const selected = await prompts.select({
      message: "Select server to inspect",
      options: serverNames.map((name) => ({
        value: name,
        label: name,
      })),
    })

    if (prompts.isCancel(selected)) return

    const serverName = selected as string
    const serverConfig = mcpConfig[serverName]

    prompts.log.info(`Inspecting: ${serverName}`)

    // Get server status
    const status = (await MCP.status())[serverName] ?? { status: "disabled" as const }

    switch (status.status) {
      case "connected":
        await inspectConnectedServer(serverName, serverConfig)
        break
      case "needs_auth":
        prompts.log.warn("Server requires authentication")
        const authAction = await prompts.select({
          message: "Action",
          options: [
            { value: "auth", label: "Authenticate" },
            { value: "back", label: "Go Back" },
          ],
        })
        if (authAction === "auth") {
          await MCP.authenticate(serverName)
        }
        break
      case "failed":
        prompts.log.error(`Connection failed: ${status.error}`)
        break
      case "disabled":
        prompts.log.warn("Server is disabled")
        break
      case "needs_client_registration":
        prompts.log.warn(`Client registration required: ${status.error}`)
        break
    }

    prompts.outro("Inspector closed")
  }

  /**
   * Inspect a connected server
   */
  async function inspectConnectedServer(serverName: string, serverConfig: any): Promise<void> {
    const client = (await MCP.clients())[serverName]
    if (!client) {
      prompts.log.error("Connected MCP client not found")
      return
    }

    const toolsResult = await client.listTools().catch((error) => {
      log.error("failed to get inspector tools", { serverName, error })
      return undefined
    })
    const serverTools = (toolsResult?.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema ?? {},
    }))

    prompts.log.message(`Tools: ${serverTools.length}`)

    if (serverTools.length === 0) {
      prompts.log.warn("No tools available")
      return
    }

    // Display tools in a formatted list
    const maxWidth = 80
    const toolLines: string[] = []

    for (const tool of serverTools) {
      const nameWidth = 25
      const descWidth = maxWidth - nameWidth - 3

      const truncatedName = TextLayout.truncate(tool.name, nameWidth)
      const truncatedDesc = TextLayout.truncate(tool.description, descWidth)

      toolLines.push(`  ${TextLayout.padRight(truncatedName, nameWidth)}  ${truncatedDesc}`)
    }

    prompts.log.message(toolLines.join("\n"))

    // Interactive menu
    const action = await prompts.select({
      message: "What would you like to do?",
      options: [
        { value: "test", label: "Test a tool" },
        { value: "details", label: "View tool details" },
        { value: "resources", label: "View resources" },
        { value: "refresh", label: "Refresh" },
        { value: "exit", label: "Exit" },
      ],
    })

    if (prompts.isCancel(action)) return

    switch (action) {
      case "test":
        await testTool(serverName, serverTools)
        break
      case "details":
        await showToolDetails(serverTools)
        break
      case "resources":
        await listResources(serverName)
        break
      case "refresh":
        await inspectConnectedServer(serverName, serverConfig)
        break
      case "exit":
        break
    }
  }

  /**
   * Test a tool interactively
   */
  async function testTool(
    serverName: string,
    tools: Array<{ name: string; inputSchema: any }>,
  ): Promise<void> {
    const selected = await prompts.select({
      message: "Select tool to test",
      options: tools.map((t) => ({
        value: t.name,
        label: t.name,
      })),
    })

    if (prompts.isCancel(selected)) return

    const toolName = selected as string
    const tool = tools.find((t) => t.name === toolName)

    if (!tool) {
      prompts.log.error("Tool not found")
      return
    }

    prompts.log.info(`Testing: ${toolName}`)

    // Get input schema properties
    const schema = tool.inputSchema
    const properties = (schema as any).properties ?? {}
    const required = (schema as any).required ?? []

    // Build arguments interactively
    const args: Record<string, any> = {}

    for (const [propName, propSchema] of Object.entries(properties)) {
      const prop = propSchema as any
      const type = prop.type ?? "string"
      const desc = prop.description ?? ""
      const isRequired = required.includes(propName)

      prompts.log.message(`\nParameter: ${propName}`)
      prompts.log.message(`  Type: ${type}${isRequired ? " (required)" : " (optional)"}`)
      if (desc) prompts.log.message(`  Description: ${desc}`)

      if (type === "boolean") {
        const value = await prompts.confirm({
          message: `Set ${propName} to true?`,
        })
        if (prompts.isCancel(value)) return
        args[propName] = value ?? false
      } else if (type === "number" || type === "integer") {
        const value = await prompts.text({
          message: `Enter ${propName}${isRequired ? "" : " (optional)"}`,
          validate: (v) => {
            if (!v && !isRequired) return
            if (v === "" && isRequired) return "This field is required"
            const num = Number(v)
            if (isNaN(num)) return "Must be a number"
          },
        })
        if (prompts.isCancel(value)) return
        args[propName] = value ? Number(value) : undefined
      } else {
        const value = await prompts.text({
          message: `Enter ${propName}${isRequired ? "" : " (optional)"}`,
          validate: (v) => {
            if (!v && !isRequired) return
            if (v === "" && isRequired) return "This field is required"
          },
        })
        if (prompts.isCancel(value)) return
        args[propName] = value || undefined
      }
    }

    // Remove undefined values
    const filteredArgs = Object.fromEntries(
      Object.entries(args).filter(([_, v]) => v !== undefined),
    )

    prompts.log.info(`Calling ${toolName} with: ${JSON.stringify(filteredArgs, null, 2)}`)

    try {
      const client = (await MCP.clients())[serverName]
      if (!client) {
        prompts.log.error("Connected MCP client not found")
        return
      }
      const result = await client.callTool({
        name: toolName,
        arguments: filteredArgs,
      })
      prompts.log.info("Result:")
      prompts.log.message(JSON.stringify(result, null, 2))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      prompts.log.error(`Tool call failed: ${message}`)
    }
  }

  /**
   * Show detailed tool schema
   */
  async function showToolDetails(
    tools: Array<{ name: string; description?: string; inputSchema: any }>,
  ): Promise<void> {
    const selected = await prompts.select({
      message: "Select tool",
      options: tools.map((t) => ({
        value: t.name,
        label: t.name,
      })),
    })

    if (prompts.isCancel(selected)) return

    const tool = tools.find((t) => t.name === selected)
    if (!tool) return

    const schema = tool.inputSchema
    const properties = (schema as any).properties ?? {}
    const required = (schema as any).required ?? []

    let details = `Tool: ${tool.name}\n`
    details += `Description: ${tool.description || "(none)"}\n\n`
    details += `Input Schema:\n`
    details += `  Type: ${(schema as any).type ?? "object"}\n`
    details += `  Required: ${required.join(", ") || "(none)"}\n\n`
    details += `  Properties:\n`

    for (const [propName, propSchema] of Object.entries(properties)) {
      const prop = propSchema as any
      details += `    ${propName}:\n`
      details += `      Type: ${prop.type ?? "any"}\n`
      if (prop.description) details += `      Description: ${prop.description}\n`
      if (prop.enum) details += `      Options: ${prop.enum.join(", ")}\n`
      if (prop.default !== undefined) details += `      Default: ${prop.default}\n`
      if (prop.minimum !== undefined) details += `      Minimum: ${prop.minimum}\n`
      if (prop.maximum !== undefined) details += `      Maximum: ${prop.maximum}\n`
    }

    prompts.log.message(details)
  }

  /**
   * List available resources
   */
  async function listResources(serverName: string): Promise<void> {
    const client = (await MCP.clients())[serverName]
    if (!client) {
      prompts.log.error("Connected MCP client not found")
      return
    }

    const result = await client.listResources().catch((error) => {
      log.error("failed to get inspector resources", { serverName, error })
      return undefined
    })
    const resources = result?.resources ?? []

    if (resources.length === 0) {
      prompts.log.warn("No resources available")
      return
    }

    prompts.log.message(
      resources
        .map((resource) => `${resource.name} (${resource.uri})${resource.description ? ` - ${resource.description}` : ""}`)
        .join("\n"),
    )
  }

  /**
   * Quick status check for all MCP servers
   */
  export async function quickStatus(): Promise<void> {
    const config = await Config.get()
    const mcpConfig = config.mcp ?? {}

    if (Object.keys(mcpConfig).length === 0) {
      console.log("No MCP servers configured")
      return
    }

    console.log("\nMCP Server Status:")
    console.log("─".repeat(60))

    const statuses = await MCP.status()

    for (const [name] of Object.entries(mcpConfig)) {
      const status = statuses[name] ?? { status: "disabled" as const }
      const icon =
        status.status === "connected"
          ? "✓"
          : status.status === "needs_auth"
            ? "🔐"
            : status.status === "failed"
              ? "✗"
              : "○"

      const statusText =
        status.status === "connected"
          ? "connected"
          : status.status === "needs_auth"
            ? "needs auth"
            : status.status === "failed"
              ? `error: ${status.error}`
              : status.status

      console.log(`  ${icon} ${name.padEnd(25)} ${statusText}`)
    }

    console.log("─".repeat(60))
  }
}
