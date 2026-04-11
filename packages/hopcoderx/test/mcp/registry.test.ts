import { describe, expect, test } from "bun:test"
import { McpRegistry } from "../../src/mcp/registry"

describe("McpRegistry", () => {
  test("uses audited runtime configs for sqlite, storybook, and shopify", () => {
    const sqlite = McpRegistry.getByName("sqlite")
    const storybook = McpRegistry.getByName("storybook")
    const shopify = McpRegistry.getByName("shopify")

    expect(sqlite?.config.type).toBe("local")
    expect(storybook?.config.type).toBe("remote")
    expect(shopify?.config.type).toBe("local")

    if (!sqlite || sqlite.config.type !== "local") throw new Error("sqlite registry entry should use local config")
    if (!storybook || storybook.config.type !== "remote") {
      throw new Error("storybook registry entry should use remote config")
    }
    if (!shopify || shopify.config.type !== "local") throw new Error("shopify registry entry should use local config")

    expect(sqlite.config.command).toEqual(["uvx", "mcp-server-sqlite", "--db-path", "./db.sqlite"])
    expect(storybook.config.url).toBe("http://127.0.0.1:6006/mcp")
    expect(shopify.config.command).toEqual(["npx", "-y", "shopify-mcp"])
    expect(shopify.config.environment).toEqual({
      SHOPIFY_STORE_DOMAIN: "${env:SHOPIFY_STORE_DOMAIN}",
      SHOPIFY_ACCESS_TOKEN: "${env:SHOPIFY_ACCESS_TOKEN}",
    })
  })
})
