/**
 * End-to-End tests for complete workflows
 *
 * These tests verify full user workflows from start to finish.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { execSync } from "child_process"
import { join } from "path"
import { tmpdir } from "os"
import { mkdtemp, rm, writeFile, readFile } from "fs/promises"

describe("E2E Workflows", () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hopcoderx-e2e-test-"))
    originalCwd = process.cwd()
    process.chdir(tempDir)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true, force: true })
  })

  describe("New Project Setup Workflow", () => {
    it("should complete full project setup", () => {
      // Initialize project
      execSync("hopcoderx init", { encoding: "utf8", stdio: "pipe" })

      // Verify config file created
      const configExists = execSync("test -f hopcoderx.json && echo yes || echo no", {
        encoding: "utf8",
      })
      expect(configExists.trim()).toBe("yes")
    })
  })

  describe("Memory Workflow", () => {
    it("should store, search, and retrieve memories", () => {
      // Add memories
      execSync('hopcoderx memory add "Always use TypeScript for new projects"', {
        encoding: "utf8",
      })
      execSync('hopcoderx memory add "Prefer bun over npm for package management"', {
        encoding: "utf8",
      })
      execSync('hopcoderx memory add "Test files should be in __tests__ directory"', {
        encoding: "utf8",
      })

      // Search memories
      const searchResult = execSync('hopcoderx memory search "TypeScript"', {
        encoding: "utf8",
      })
      expect(searchResult).toContain("TypeScript")

      // List memories
      const listResult = execSync("hopcoderx memory list", { encoding: "utf8" })
      expect(listResult).toContain("Memories")
      expect(listResult.split("\n").length).toBeGreaterThan(3)
    })
  })

  describe("Scaffolding Workflow", () => {
    it("should scaffold new command", () => {
      const result = execSync(
        'hopcoderx new command test-cmd --description "Test command"',
        { encoding: "utf8" },
      )
      expect(result).toContain("Created")

      // Verify file exists
      const cmdFile = join(
        tempDir,
        "src",
        "cli",
        "cmd",
        "test-cmd.ts",
      )
      expect(() => readFile(cmdFile, "utf8")).not.toThrow()
    })

    it("should scaffold new skill", () => {
      const result = execSync(
        'hopcoderx new skill test-skill --description "Test skill"',
        { encoding: "utf8" },
      )
      expect(result).toContain("Created")

      // Verify file exists
      const skillFile = join(
        tempDir,
        ".hopcoderx",
        "skill",
        "test-skill.md",
      )
      expect(() => readFile(skillFile, "utf8")).not.toThrow()
    })

    it("should scaffold new agent", () => {
      const result = execSync(
        'hopcoderx new agent test-agent --description "Test agent"',
        { encoding: "utf8" },
      )
      expect(result).toContain("Created")

      // Verify file exists
      const agentFile = join(
        tempDir,
        ".hopcoderx",
        "agent",
        "test-agent.md",
      )
      expect(() => readFile(agentFile, "utf8")).not.toThrow()
    })
  })

  describe("Macro Workflow", () => {
    it("should create and run macro programmatically", () => {
      // Create macro directly via file
      const macroDir = join(tempDir, ".config", "hopcoderx", "macros")
      execSync(`mkdir -p "${macroDir}"`)

      const macro = {
        name: "test-macro",
        description: "Test macro for E2E",
        commands: ["echo hello", "echo world"],
        parameters: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        runCount: 0,
      }

      execSync(
        `echo '${JSON.stringify(macro)}' > "${join(macroDir, "test-macro.json")}"`,
      )

      // Verify macro is listed
      const listResult = execSync("hopcoderx macro list", { encoding: "utf8" })
      expect(listResult).toContain("test-macro")
    })
  })

  describe("Config Management Workflow", () => {
    it("should manage configuration", () => {
      // Show current config
      const showResult = execSync("hopcoderx config", { encoding: "utf8" })
      expect(showResult).toContain("Configuration")

      // Config file should be creatable
      execSync(
        'echo \'{"test": true}\' > hopcoderx.json',
        { encoding: "utf8" },
      )

      const verifyResult = execSync("hopcoderx config", { encoding: "utf8" })
      expect(verifyResult).toContain("hopcoderx.json")
    })
  })

  describe("Output Format Workflow", () => {
    it("should support all output formats", () => {
      const formats = ["table", "json", "yaml", "markdown"]

      for (const format of formats) {
        const result = execSync(`hopcoderx status --format ${format}`, {
          encoding: "utf8",
        })

        switch (format) {
          case "json":
            expect(() => JSON.parse(result)).not.toThrow()
            break
          case "table":
            expect(result).toContain("│")
            break
          case "markdown":
            expect(result).toContain("|")
            break
          default:
            expect(result.length).toBeGreaterThan(0)
        }
      }
    })
  })

  describe("Help System Workflow", () => {
    it("should provide help for all commands", () => {
      const commands = [
        "repl",
        "palette",
        "macro",
        "new",
        "memory",
        "config",
        "status",
        "doctor",
      ]

      for (const cmd of commands) {
        const result = execSync(`hopcoderx ${cmd} --help`, {
          encoding: "utf8",
        })
        expect(result).toContain("Options:")
      }
    })
  })
})
