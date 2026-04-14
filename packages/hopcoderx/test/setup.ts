/**
 * Test setup and utilities for HopCoderX CLI
 *
 * This file provides common test utilities, mocks, and fixtures.
 */

import { expect, beforeEach, afterEach, vi } from "bun:test"
import { tmpdir } from "os"
import { join } from "path"
import { mkdtemp, rm } from "fs/promises"

// ─── Global Test Utilities ────────────────────────────────────────────────────

/**
 * Create a temporary directory for tests
 * Automatically cleaned up after test completes
 */
export async function createTempDir(prefix = "hopcoderx-test"): Promise<string> {
  return await mkdtemp(join(tmpdir(), `${prefix}-`))
}

/**
 * Clean up a temporary directory
 */
export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

/**
 * Test fixture helper
 */
export class TestFixture {
  public readonly dir: string
  public readonly files: Map<string, string>

  constructor(dir: string) {
    this.dir = dir
    this.files = new Map()
  }

  static async create(prefix = "hopcoderx-test"): Promise<TestFixture> {
    const dir = await createTempDir(prefix)
    return new TestFixture(dir)
  }

  async write(path: string, content: string): Promise<void> {
    const { writeFile, mkdir } = await import("fs/promises")
    const fullPath = join(this.dir, path)
    await mkdir(join(fullPath, ".."), { recursive: true })
    await writeFile(fullPath, content, "utf8")
    this.files.set(path, content)
  }

  async read(path: string): Promise<string> {
    const { readFile } = await import("fs/promises")
    const fullPath = join(this.dir, path)
    return await readFile(fullPath, "utf8")
  }

  async exists(path: string): Promise<boolean> {
    const { access } = await import("fs/promises")
    try {
      await access(join(this.dir, path))
      return true
    } catch {
      return false
    }
  }

  async cleanup(): Promise<void> {
    await cleanupTempDir(this.dir)
  }
}

// ─── Mock Helpers ─────────────────────────────────────────────────────────────

/**
 * Mock console output for testing
 */
export function mockConsole() {
  const log = vi.spyOn(console, "log").mockImplementation(() => {})
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  const error = vi.spyOn(console, "error").mockImplementation(() => {})
  const info = vi.spyOn(console, "info").mockImplementation(() => {})

  return {
    log,
    warn,
    error,
    info,
    restore: () => {
      log.mockRestore()
      warn.mockRestore()
      error.mockRestore()
      info.mockRestore()
    },
  }
}

/**
 * Mock environment variables
 */
export function mockEnv(vars: Record<string, string | undefined>) {
  const original = process.env

  beforeEach(() => {
    process.env = { ...original, ...vars }
  })

  afterEach(() => {
    process.env = original
  })
}

// ─── Assertion Helpers ────────────────────────────────────────────────────────

/**
 * Assert that a string contains another string
 */
export function expectContains(haystack: string, needle: string, message?: string) {
  expect(haystack).toContain(needle)
}

/**
 * Assert that a function throws an error matching a pattern
 */
export async function expectThrowsAsync(
  fn: () => Promise<unknown>,
  pattern?: string | RegExp,
): Promise<Error> {
  let error: Error | undefined
  try {
    await fn()
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e))
  }

  if (!error) {
    throw new Error("Expected function to throw, but it did not")
  }

  if (pattern) {
    if (typeof pattern === "string") {
      expect(error.message).toContain(pattern)
    } else {
      expect(error.message).toMatch(pattern)
    }
  }

  return error
}

/**
 * Assert JSON structure
 */
export function expectJsonStructure(data: unknown, structure: Record<string, unknown>) {
  expect(data).toBeObject()

  if (typeof data !== "object" || data === null) {
    throw new Error("Expected data to be an object")
  }

  for (const [key, expectedType] of Object.entries(structure)) {
    expect(data).toHaveProperty(key)

    const value = (data as Record<string, unknown>)[key]

    if (expectedType === String) {
      expect(typeof value).toBe("string")
    } else if (expectedType === Number) {
      expect(typeof value).toBe("number")
    } else if (expectedType === Boolean) {
      expect(typeof value).toBe("boolean")
    } else if (expectedType === Array) {
      expect(Array.isArray(value)).toBeTrue()
    } else if (expectedType === Object) {
      expect(typeof value).toBe("object")
    }
  }
}

// ─── Command Test Helpers ─────────────────────────────────────────────────────

/**
 * Execute a CLI command and capture output
 */
export async function execCommand(
  command: string,
  args: string[] = [],
  options?: { cwd?: string; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const { execSync } = await import("child_process")

  try {
    const stdout = execSync(`${command} ${args.join(" ")}`, {
      encoding: "utf8",
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      stdio: "pipe",
    })

    return { stdout, stderr: "", exitCode: 0 }
  } catch (e: any) {
    return {
      stdout: e.stdout?.toString() || "",
      stderr: e.stderr?.toString() || "",
      exitCode: e.status,
    }
  }
}

// ─── Matcher Extensions ───────────────────────────────────────────────────────

declare module "bun:test" {
  interface Matchers<T> {
    toBeValidDate(): T
    toBeValidUuid(): T
    toBeValidJson(): T
  }
}

expect.extend({
  toBeValidDate(received: unknown) {
    const date = new Date(received as string)
    const pass = !isNaN(date.getTime())
    return {
      pass,
      message: () => `Expected ${received} to be ${pass ? "invalid" : "valid"} date`,
    }
  },

  toBeValidUuid(received: unknown) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const pass = typeof received === "string" && uuidRegex.test(received)
    return {
      pass,
      message: () => `Expected ${received} to be ${pass ? "invalid" : "valid"} UUID`,
    }
  },

  toBeValidJson(received: unknown) {
    try {
      JSON.parse(received as string)
      return { pass: true, message: () => "Expected invalid JSON" }
    } catch {
      return { pass: false, message: () => "Expected valid JSON" }
    }
  },
})

// ─── Lifecycle Hooks ──────────────────────────────────────────────────────────

/**
 * Skip tests in CI environment
 */
export const describeUnlessCi = process.env.CI ? describe.skip : describe

/**
 * Skip tests on specific platforms
 */
export const describeUnlessWin = process.platform === "win32" ? describe.skip : describe
export const describeUnlessMac = process.platform === "darwin" ? describe.skip : describe
export const describeUnlessLinux = process.platform === "linux" ? describe.skip : describe
