import { describe, expect, test } from "bun:test"
import { findMissingMcpEnvVars, formatMcpFailureMessage, resolveMcpRuntimeConfig } from "../../src/mcp/runtime-config"

describe("resolveMcpRuntimeConfig", () => {
  test("interpolates env placeholders in local command arguments", () => {
    const config = resolveMcpRuntimeConfig(
      {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-postgres", "${env:DATABASE_URL}"],
      },
      {
        DATABASE_URL: "postgresql://user:pass@localhost/db",
      } as NodeJS.ProcessEnv,
    )

    expect(config.command[3]).toBe("postgresql://user:pass@localhost/db")
  })

  test("interpolates env placeholders in environment and nested strings", () => {
    const config = resolveMcpRuntimeConfig(
      {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-github"],
        environment: {
          GITHUB_PERSONAL_ACCESS_TOKEN: "${env:GITHUB_PERSONAL_ACCESS_TOKEN}",
          OPENAPI_MCP_HEADERS: '{"Authorization":"Bearer ${env:NOTION_API_KEY}"}',
        },
      },
      {
        GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_test",
        NOTION_API_KEY: "notion_test",
      } as NodeJS.ProcessEnv,
    )

    expect(config.environment?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("ghp_test")
    expect(config.environment?.OPENAPI_MCP_HEADERS).toContain("Bearer notion_test")
  })

  test("replaces missing env placeholders with empty strings", () => {
    const config = resolveMcpRuntimeConfig({
      type: "local",
      command: ["npx", "-y", "server", "${env:MISSING_VALUE}"],
      environment: {
        TOKEN: "${env:MISSING_VALUE}",
      },
    })

    expect(config.command[3]).toBe("")
    expect(config.environment?.TOKEN).toBe("")
  })

  test("finds missing env placeholders before launch", () => {
    const missing = findMissingMcpEnvVars(
      {
        type: "local",
        command: ["npx", "-y", "server", "${env:DATABASE_URL}"],
        environment: {
          OPENAPI_MCP_HEADERS: '{"Authorization":"Bearer ${env:NOTION_API_KEY}"}',
        },
      },
      {
        DATABASE_URL: "postgresql://configured",
      } as NodeJS.ProcessEnv,
    )

    expect(missing).toEqual(["NOTION_API_KEY"])
  })
})

describe("formatMcpFailureMessage", () => {
  test("appends stderr context to startup failures", () => {
    expect(formatMcpFailureMessage("Connection closed", ["npm ERR! missing package", "See log for details"])).toBe(
      "Connection closed\nStderr:\nnpm ERR! missing package\nSee log for details",
    )
  })
})
