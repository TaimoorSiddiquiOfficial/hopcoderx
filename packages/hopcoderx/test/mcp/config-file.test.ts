import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { buildDisabledMcpEntry, resolveMcpConfigPath, updateMcpConfigEntry } from "../../src/mcp/config-file"

describe("resolveMcpConfigPath", () => {
  test("prefers an existing jsonc file", async () => {
    await using tmp = await tmpdir()
    const jsoncPath = path.join(tmp.path, "hopcoderx.jsonc")
    await fs.writeFile(jsoncPath, "{\n  // config\n}\n", "utf-8")

    expect(await resolveMcpConfigPath(tmp.path)).toBe(jsoncPath)
  })
})

describe("updateMcpConfigEntry", () => {
  test("writes MCP entries into jsonc files while preserving comments", async () => {
    await using tmp = await tmpdir()
    const configPath = path.join(tmp.path, "hopcoderx.jsonc")
    await fs.writeFile(configPath, "{\n  // test comment\n}\n", "utf-8")

    await updateMcpConfigEntry(
      "builtin:github",
      {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-github"],
        enabled: true,
      },
      configPath,
    )

    const updated = await fs.readFile(configPath, "utf-8")
    expect(updated).toContain("// test comment")
    expect(updated).toContain('"builtin:github"')
  })
})

describe("buildDisabledMcpEntry", () => {
  test("preserves custom server config when disabling", () => {
    expect(
      buildDisabledMcpEntry("custom", {
        custom: {
          type: "remote",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer token" },
        },
      } as any),
    ).toEqual({
      type: "remote",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer token" },
      enabled: false,
    })
  })

  test("expands builtins into disabled MCP config entries", () => {
    expect(buildDisabledMcpEntry("builtin:github")).toMatchObject({
      type: "local",
      enabled: false,
    })
  })
})
