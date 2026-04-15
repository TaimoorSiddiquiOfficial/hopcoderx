#!/usr/bin/env bun
/**
 * Context Notes MCP Server - Standalone Executable
 *
 * Run with: bun run context-notes-mcp.ts
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { ContextNotesMCP } from "../context-notes"

const server = new Server(
  {
    name: "context-notes",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
)

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: Object.entries(ContextNotesMCP.tools).map(([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: tool.parameters,
    })),
  }
})

// Execute tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  const tool = ContextNotesMCP.tools[name as keyof typeof ContextNotesMCP.tools]
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`)
  }

  try {
    const result = await tool.execute(args as Record<string, any>)
    return {
      content: [{ type: "text", text: String(result) }],
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    }
  }
})

// Start the server
async function main() {
  try {
    // Initialize the context notes system
    await ContextNotesMCP.init()

    const transport = new StdioServerTransport()
    await server.connect(transport)

    console.error("Context Notes MCP server running on stdio")
  } catch (error) {
    console.error("Failed to start Context Notes MCP server:", error)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
