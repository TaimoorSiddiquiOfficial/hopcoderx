/**
 * Integration tests for CLI commands
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { execSync } from "child_process"
import { join } from "path"
import { tmpdir } from "os"
import { mkdtemp, rm, writeFile } from "fs/promises"

describe("CLI Integration", () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hopcoderx-cli-test-"))
    originalCwd = process.cwd()
    process.chdir(tempDir)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true })
  })

  describe("hopcoderx --version", () => {
    it("should return version", () => {
      const result = execSync("hopcoderx --version", { encoding: "utf8" })
      expect(result.trim()).toMatch(/\d+\.\d+\.\d+/)
    })
  })

  describe("hopcoderx --help", () => {
    it("should show help", () => {
      const result = execSync("hopcoderx --help", { encoding: "utf8" })
      expect(result).toContain("Command groups:")
      expect(result).toContain("Session")
      expect(result).toContain("Setup")
    })
  })

  describe("hopcoderx status", () => {
    it("should show status", () => {
      const result = execSync("hopcoderx status", { encoding: "utf8" })
      expect(result).toContain("HopCoderX")
      expect(result).toContain("Providers")
    })

    it("should support JSON output", () => {
      const result = execSync("hopcoderx status --json", { encoding: "utf8" })
      const json = JSON.parse(result)
      expect(json).toHaveProperty("version")
      expect(json).toHaveProperty("providers")
    })
  })

  describe("hopcoderx config", () => {
    it("should show config", () => {
      const result = execSync("hopcoderx config", { encoding: "utf8" })
      expect(result).toContain("Configuration")
    })
  })

  describe("hopcoderx memory", () => {
    it("should add memory", () => {
      const result = execSync('hopcoderx memory add "test memory content"', {
        encoding: "utf8",
      })
      expect(result).toContain("Memory stored")
    })

    it("should list memory", () => {
      execSync('hopcoderx memory add "test memory for listing"', {
        encoding: "utf8",
      })
      const result = execSync("hopcoderx memory list", { encoding: "utf8" })
      expect(result).toContain("Memories")
    })

    it("should search memory", () => {
      execSync('hopcoderx memory add "searchable test content"', {
        encoding: "utf8",
      })
      const result = execSync('hopcoderx memory search "searchable"', {
        encoding: "utf8",
      })
      expect(result).toContain("Search results")
    })
  })

  describe("hopcoderx doctor", () => {
    it("should run diagnostics", () => {
      const result = execSync("hopcoderx doctor", { encoding: "utf8" })
      expect(result).toContain("Installation")
      expect(result).toContain("Providers")
    })
  })

  describe("hopcoderx models", () => {
    it("should list models", () => {
      const result = execSync("hopcoderx models", { encoding: "utf8" })
      expect(result).toContain("Available Models")
    })
  })

  describe("Output formats", () => {
    beforeEach(async () => {
      // Add some test data
      await writeFile(
        join(tempDir, "hopcoderx.json"),
        JSON.stringify({
          mcp: {
            "test-server": { type: "remote", url: "https://test.example.com" },
          },
        }),
      )
    })

    it("should support table format", () => {
      const result = execSync("hopcoderx mcp list --format table", {
        encoding: "utf8",
      })
      expect(result).toContain("│")
    })

    it("should support JSON format", () => {
      const result = execSync("hopcoderx mcp list --format json", {
        encoding: "utf8",
      })
      expect(() => JSON.parse(result)).not.toThrow()
    })

    it("should support markdown format", () => {
      const result = execSync("hopcoderx mcp list --format markdown", {
        encoding: "utf8",
      })
      expect(result).toContain("|")
    })
  })
})
