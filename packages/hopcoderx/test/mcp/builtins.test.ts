import { describe, expect, test } from "bun:test"
import { McpBuiltins } from "../../src/mcp/builtins"

describe("McpBuiltins", () => {
  test("uses supported upstream launch commands for fetch and time builtins", () => {
    const fetchBuiltin = McpBuiltins.catalog.find((entry) => entry.id === "builtin:fetch")
    const timeBuiltin = McpBuiltins.catalog.find((entry) => entry.id === "builtin:time")

    expect(fetchBuiltin?.config.type).toBe("local")
    expect(timeBuiltin?.config.type).toBe("local")

    if (!fetchBuiltin || fetchBuiltin.config.type !== "local") throw new Error("builtin:fetch should use local config")
    if (!timeBuiltin || timeBuiltin.config.type !== "local") throw new Error("builtin:time should use local config")

    expect(fetchBuiltin.config.command).toEqual(["uvx", "mcp-server-fetch"])
    expect(fetchBuiltin.config.environment).toEqual({ PYTHONIOENCODING: "utf-8" })
    expect(timeBuiltin.config.command).toEqual(["uvx", "mcp-server-time"])
  })
})
