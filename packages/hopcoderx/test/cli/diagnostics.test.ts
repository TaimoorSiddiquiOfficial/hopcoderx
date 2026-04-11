import { describe, expect, test } from "bun:test"
import { summarizeMcpServers } from "../../src/cli/diagnostics"

describe("summarizeMcpServers", () => {
  test("includes runtime-only builtins alongside configured MCP servers", () => {
    const summary = summarizeMcpServers({
      configMcp: {
        custom: {
          type: "remote",
          url: "https://example.com/mcp",
        },
        disabled: {
          enabled: false,
        },
      } as any,
      statuses: {
        custom: { status: "needs_auth" },
        "builtin:filesystem": { status: "connected" },
      },
      authByServer: {
        custom: "not_authenticated",
      },
    })

    expect(summary.count).toBe(3)
    expect(summary.builtinCount).toBe(1)
    expect(summary.connectedCount).toBe(1)
    expect(summary.needsAuthCount).toBe(1)

    expect(summary.servers.find((server) => server.name === "builtin:filesystem")).toMatchObject({
      builtin: true,
      configured: false,
      status: "connected",
      type: "local",
      valid: true,
    })

    expect(summary.servers.find((server) => server.name === "custom")).toMatchObject({
      builtin: false,
      configured: true,
      status: "needs_auth",
      type: "remote",
      auth: "not_authenticated",
      detail: "https://example.com/mcp",
    })

    expect(summary.servers.find((server) => server.name === "disabled")).toMatchObject({
      builtin: false,
      configured: true,
      status: "disabled",
      type: "?",
      valid: false,
    })
  })
})
