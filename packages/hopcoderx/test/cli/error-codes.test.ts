import { describe, it, expect } from "bun:test"
import {
  ErrorCode,
  formatErrorCode,
  getErrorRange,
  createErrorContext,
  type ErrorCodeValue,
} from "../../src/cli/error-codes"

describe("ErrorCode", () => {
  it("all values match HCX-NNN format", () => {
    const pattern = /^HCX-\d{3}$/
    for (const [key, value] of Object.entries(ErrorCode)) {
      expect(value).toMatch(pattern)
    }
  })

  it("config errors are in 001-099 range", () => {
    const configCodes = [
      ErrorCode.CONFIG_INVALID_JSON,
      ErrorCode.CONFIG_INVALID_SCHEMA,
      ErrorCode.CONFIG_DIRECTORY_TYPO,
      ErrorCode.CONFIG_MISSING_FIELD,
      ErrorCode.CONFIG_FRONTMATTER_ERROR,
    ]
    for (const code of configCodes) {
      const num = parseInt(code.split("-")[1]!)
      expect(num).toBeGreaterThanOrEqual(1)
      expect(num).toBeLessThan(100)
    }
  })

  it("provider errors are in 100-199 range", () => {
    const num = parseInt(ErrorCode.PROVIDER_RATE_LIMITED.split("-")[1]!)
    expect(num).toBeGreaterThanOrEqual(100)
    expect(num).toBeLessThan(200)
  })

  it("MCP errors are in 200-299 range", () => {
    const num = parseInt(ErrorCode.MCP_CONNECTION_FAILED.split("-")[1]!)
    expect(num).toBeGreaterThanOrEqual(200)
    expect(num).toBeLessThan(300)
  })

  it("unknown errors are in 900-999 range", () => {
    const num = parseInt(ErrorCode.UNKNOWN_ERROR.split("-")[1]!)
    expect(num).toBeGreaterThanOrEqual(900)
    expect(num).toBeLessThan(1000)
  })

  it("has no duplicate values", () => {
    const values = Object.values(ErrorCode)
    const unique = new Set(values)
    expect(unique.size).toBe(values.length)
  })
})

describe("formatErrorCode", () => {
  it("wraps code in dim ANSI brackets", () => {
    const result = formatErrorCode(ErrorCode.CONFIG_INVALID_JSON)
    expect(result).toBe("\x1b[2m[HCX-001]\x1b[0m")
  })

  it("preserves the error code value inside brackets", () => {
    const result = formatErrorCode(ErrorCode.MCP_CONNECTION_FAILED)
    expect(result).toContain("HCX-201")
  })

  it("starts with dim escape and ends with reset", () => {
    const result = formatErrorCode(ErrorCode.UNKNOWN_ERROR)
    expect(result.startsWith("\x1b[2m")).toBe(true)
    expect(result.endsWith("\x1b[0m")).toBe(true)
  })
})

describe("getErrorRange", () => {
  it("returns Configuration for 001-099", () => {
    expect(getErrorRange(ErrorCode.CONFIG_INVALID_JSON)).toBe("Configuration")
    expect(getErrorRange(ErrorCode.CONFIG_FRONTMATTER_ERROR)).toBe("Configuration")
  })

  it("returns Provider/Auth for 100-199", () => {
    expect(getErrorRange(ErrorCode.PROVIDER_NOT_FOUND)).toBe("Provider/Auth")
    expect(getErrorRange(ErrorCode.PROVIDER_RATE_LIMITED)).toBe("Provider/Auth")
  })

  it("returns MCP for 200-299", () => {
    expect(getErrorRange(ErrorCode.MCP_SERVER_NOT_FOUND)).toBe("MCP")
    expect(getErrorRange(ErrorCode.MCP_CONNECTION_FAILED)).toBe("MCP")
  })

  it("returns Session/Agent for 300-399", () => {
    expect(getErrorRange(ErrorCode.SESSION_NOT_FOUND)).toBe("Session/Agent")
    expect(getErrorRange(ErrorCode.AGENT_TIMEOUT)).toBe("Session/Agent")
  })

  it("returns Tool for 400-499", () => {
    expect(getErrorRange(ErrorCode.TOOL_NOT_FOUND)).toBe("Tool")
  })

  it("returns Filesystem for 500-599", () => {
    expect(getErrorRange(ErrorCode.FS_FILE_NOT_FOUND)).toBe("Filesystem")
  })

  it("returns Network for 600-699", () => {
    expect(getErrorRange(ErrorCode.NETWORK_TIMEOUT)).toBe("Network")
  })

  it("returns CLI/UI for 700-799", () => {
    expect(getErrorRange(ErrorCode.CLI_INVALID_COMMAND)).toBe("CLI/UI")
  })

  it("returns Installation for 800-899", () => {
    expect(getErrorRange(ErrorCode.INSTALL_FAILED)).toBe("Installation")
  })

  it("returns Unknown for 900+", () => {
    expect(getErrorRange(ErrorCode.UNKNOWN_ERROR)).toBe("Unknown")
    expect(getErrorRange(ErrorCode.INTERNAL_ERROR)).toBe("Unknown")
  })
})

describe("createErrorContext", () => {
  it("creates minimal context with code and message", () => {
    const ctx = createErrorContext(ErrorCode.CONFIG_INVALID_JSON, "bad json")
    expect(ctx.code).toBe("HCX-001")
    expect(ctx.message).toBe("bad json")
    expect(ctx.details).toBeUndefined()
    expect(ctx.suggestions).toBeUndefined()
    expect(ctx.docsUrl).toBeUndefined()
    expect(ctx.fixCommand).toBeUndefined()
  })

  it("includes optional fields when provided", () => {
    const ctx = createErrorContext(ErrorCode.PROVIDER_AUTH_FAILED, "auth failed", {
      details: { providerID: "openai" },
      suggestions: ["Check your API key"],
      docsUrl: "https://hopcoder.dev/docs/providers/openai",
      fixCommand: "hopcoderx auth openai",
    })
    expect(ctx.details).toEqual({ providerID: "openai" })
    expect(ctx.suggestions).toEqual(["Check your API key"])
    expect(ctx.docsUrl).toBe("https://hopcoder.dev/docs/providers/openai")
    expect(ctx.fixCommand).toBe("hopcoderx auth openai")
  })
})
