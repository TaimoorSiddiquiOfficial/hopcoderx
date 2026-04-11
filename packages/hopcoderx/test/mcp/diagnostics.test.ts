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

  test("surfaces PowerShell.MCP runtime hints for missing pwsh and module installs", () => {
    const summary = summarizeMcpServers({
      configMcp: {
        "powershell-mcp": {
          type: "local",
          command: [
            "pwsh",
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Import-Module PowerShell.MCP; & (Get-MCPProxyPath)",
          ],
          enabled: false,
        },
      },
      statuses: {
        "powershell-mcp": { status: "failed", error: "The term 'pwsh' is not recognized as a name of a cmdlet, function, script file, or executable program." },
      },
    })

    expect(summary.servers.find((server) => server.name === "powershell-mcp")?.hint).toBe(
      "Install PowerShell 7.4+ and ensure `pwsh` is on PATH.",
    )

    const moduleSummary = summarizeMcpServers({
      configMcp: {
        "powershell-mcp": {
          type: "local",
          command: [
            "pwsh",
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Import-Module PowerShell.MCP; & (Get-MCPProxyPath)",
          ],
          enabled: false,
        },
      },
      statuses: {
        "powershell-mcp": { status: "failed", error: "PowerShell.MCP is not installed. Install-Module -Name PowerShell.MCP or Install-PSResource -Name PowerShell.MCP" },
      },
    })

    expect(moduleSummary.servers.find((server) => server.name === "powershell-mcp")?.hint).toBe(
      "Install the PowerShell.MCP module with Install-PSResource -Name PowerShell.MCP or Install-Module -Name PowerShell.MCP.",
    )
  })
})
