#!/usr/bin/env node
/**
 * Web Search MCP Server - Standalone
 *
 * This is a standalone MCP server that can be run independently.
 * It provides web search capabilities with multiple engine support.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { WebSearchMCP } from "../web-search"

const server = new Server(
  {
    name: "web-search",
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
    tools: Object.entries(WebSearchMCP.tools).map(([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: tool.parameters,
    })),
  }
})

// Execute tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  const tool = WebSearchMCP.tools[name as keyof typeof WebSearchMCP.tools]
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
    const transport = new StdioServerTransport()
    await server.connect(transport)

    console.error("Web Search MCP server running on stdio")
  } catch (error) {
    console.error("Failed to start Web Search MCP server:", error)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
