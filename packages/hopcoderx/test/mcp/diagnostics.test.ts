import { describe, expect, test } from "bun:test"
import { summarizeMcpServers } from "../../src/cli/diagnostics"

describe("summarizeMcpServers", () => {
  test("surfaces missing-env and storybook runtime hints for failed MCP entries", () => {
    const summary = summarizeMcpServers({
      configMcp: {
        redis: {
          type: "local",
          command: ["npx", "-y", "@modelcontextprotocol/server-redis", "${env:REDIS_URL}"],
          enabled: false,
        },
        storybook: {
          type: "remote",
          url: "http://127.0.0.1:6006/mcp",
          enabled: false,
        },
      },
      statuses: {
        redis: { status: "failed", error: "Connection closed" },
        storybook: { status: "failed", error: "Connection closed" },
      },
    })

    const redis = summary.servers.find((server) => server.name === "redis")
    const storybook = summary.servers.find((server) => server.name === "storybook")

    expect(redis?.hint).toBe("Missing env: REDIS_URL")
    expect(storybook?.hint).toBe(
      "Start Storybook with @storybook/addon-mcp and ensure http://127.0.0.1:6006/mcp is reachable.",
    )
  })
})
