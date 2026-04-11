import { describe, expect, test } from "bun:test"
import { McpBuiltins } from "../../src/mcp/builtins"

describe("McpBuiltins", () => {
  test("uses supported upstream launch contracts for audited builtins", () => {
    const fetchBuiltin = McpBuiltins.catalog.find((entry) => entry.id === "builtin:fetch")
    const sqliteBuiltin = McpBuiltins.catalog.find((entry) => entry.id === "builtin:sqlite")
    const storybookBuiltin = McpBuiltins.catalog.find((entry) => entry.id === "builtin:storybook")
    const timeBuiltin = McpBuiltins.catalog.find((entry) => entry.id === "builtin:time")

    expect(fetchBuiltin?.config.type).toBe("local")
    expect(sqliteBuiltin?.config.type).toBe("local")
    expect(storybookBuiltin?.config.type).toBe("remote")
    expect(timeBuiltin?.config.type).toBe("local")

    if (!fetchBuiltin || fetchBuiltin.config.type !== "local") throw new Error("builtin:fetch should use local config")
    if (!sqliteBuiltin || sqliteBuiltin.config.type !== "local") throw new Error("builtin:sqlite should use local config")
    if (!storybookBuiltin || storybookBuiltin.config.type !== "remote") {
      throw new Error("builtin:storybook should use remote config")
    }
    if (!timeBuiltin || timeBuiltin.config.type !== "local") throw new Error("builtin:time should use local config")

    expect(fetchBuiltin.config.command).toEqual(["uvx", "mcp-server-fetch"])
    expect(fetchBuiltin.config.environment).toEqual({ PYTHONIOENCODING: "utf-8" })
    expect(sqliteBuiltin.config.command).toEqual(["uvx", "mcp-server-sqlite", "--db-path", "./db.sqlite"])
    expect(storybookBuiltin.config.url).toBe("http://127.0.0.1:6006/mcp")
    expect(timeBuiltin.config.command).toEqual(["uvx", "mcp-server-time"])
  })
})
