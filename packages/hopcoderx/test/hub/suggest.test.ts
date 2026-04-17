import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { HubSuggest } from "../../src/hub/suggest"

// Helper to create a temporary project directory
function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "hopcoderx-suggest-test-"))
}

function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
}

describe("HubSuggest.hasSignals", () => {
  let dir: string

  beforeEach(() => { dir = makeTempDir() })
  afterEach(() => cleanupDir(dir))

  it("returns false for empty directory", () => {
    expect(HubSuggest.hasSignals(dir)).toBe(false)
  })

  it("returns true when .github directory exists", () => {
    mkdirSync(join(dir, ".github"))
    writeFileSync(join(dir, ".github", "CODEOWNERS"), "* @owner")
    expect(HubSuggest.hasSignals(dir)).toBe(true)
  })

  it("returns true when package.json exists", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test" }))
    expect(HubSuggest.hasSignals(dir)).toBe(true)
  })

  it("returns false for non-existent directory", () => {
    expect(HubSuggest.hasSignals("/nonexistent/path/that/does/not/exist")).toBe(false)
  })
})

describe("HubSuggest.suggest", () => {
  let dir: string

  beforeEach(() => { dir = makeTempDir() })
  afterEach(() => cleanupDir(dir))

  it("returns empty array for empty directory", () => {
    const results = HubSuggest.suggest(dir)
    expect(results).toEqual([])
  })

  it("returns empty array for non-existent directory", () => {
    const results = HubSuggest.suggest("/nonexistent/path/hopcoderx-test")
    expect(results).toEqual([])
  })

  it("suggests triage and code-review for .github directory", () => {
    mkdirSync(join(dir, ".github"))
    writeFileSync(join(dir, ".github", "config.yml"), "")
    const results = HubSuggest.suggest(dir)
    const ids = results.map((r) => r.workflowID)
    expect(ids).toContain("workflow:triage")
    expect(ids).toContain("workflow:code-review")
  })

  it("triage scores higher with CODEOWNERS file", () => {
    mkdirSync(join(dir, ".github"))
    writeFileSync(join(dir, ".github", "config.yml"), "")
    writeFileSync(join(dir, "CODEOWNERS"), "* @team")
    const results = HubSuggest.suggest(dir)
    const triage = results.find((r) => r.workflowID === "workflow:triage")
    const codeReview = results.find((r) => r.workflowID === "workflow:code-review")
    expect(triage).toBeDefined()
    expect(codeReview).toBeDefined()
    // triage has weight 3 + 2 = 5, code-review has weight 2
    expect(triage!.score).toBeGreaterThan(codeReview!.score)
  })

  it("suggests cloud-infra for Dockerfile", () => {
    writeFileSync(join(dir, "Dockerfile"), "FROM node:20")
    const results = HubSuggest.suggest(dir)
    const ids = results.map((r) => r.workflowID)
    expect(ids).toContain("workflow:cloud-infra")
  })

  it("suggests cloud-infra with high score for Terraform files", () => {
    writeFileSync(join(dir, "main.tf"), "provider \"aws\" {}")
    const results = HubSuggest.suggest(dir)
    const infra = results.find((r) => r.workflowID === "workflow:cloud-infra")
    expect(infra).toBeDefined()
    expect(infra!.score).toBeGreaterThanOrEqual(4)
  })

  it("suggests fullstack for package.json alone (low weight)", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app" }))
    const results = HubSuggest.suggest(dir)
    const fullstack = results.find((r) => r.workflowID === "workflow:fullstack")
    expect(fullstack).toBeDefined()
    expect(fullstack!.score).toBe(1)
  })

  it("suggests fullstack with higher score for web framework in package.json", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "my-app",
        dependencies: { react: "^18.0.0", next: "^14.0.0" },
      }),
    )
    const results = HubSuggest.suggest(dir)
    const fullstack = results.find((r) => r.workflowID === "workflow:fullstack")
    expect(fullstack).toBeDefined()
    // base weight 1 + framework weight 3 = 4
    expect(fullstack!.score).toBeGreaterThanOrEqual(4)
  })

  it("suggests data for Python data libraries in requirements.txt", () => {
    writeFileSync(join(dir, "requirements.txt"), "pandas\nnumpy\nscikit-learn\n")
    const results = HubSuggest.suggest(dir)
    const data = results.find((r) => r.workflowID === "workflow:data")
    expect(data).toBeDefined()
    expect(data!.score).toBeGreaterThan(1)
  })

  it("suggests data for SQL migration directory", () => {
    mkdirSync(join(dir, "migrations"))
    writeFileSync(join(dir, "migrations", "001_init.sql"), "CREATE TABLE users (id INT);")
    const results = HubSuggest.suggest(dir)
    const ids = results.map((r) => r.workflowID)
    expect(ids).toContain("workflow:data")
  })

  it("suggests security for SECURITY.md", () => {
    writeFileSync(join(dir, "SECURITY.md"), "# Security Policy")
    const results = HubSuggest.suggest(dir)
    const ids = results.map((r) => r.workflowID)
    expect(ids).toContain("workflow:security")
  })

  it("suggests plan for ROADMAP.md", () => {
    writeFileSync(join(dir, "ROADMAP.md"), "# Roadmap")
    const results = HubSuggest.suggest(dir)
    const ids = results.map((r) => r.workflowID)
    expect(ids).toContain("workflow:plan")
  })

  it("respects the limit parameter", () => {
    // Create many signals to generate multiple workflow suggestions
    mkdirSync(join(dir, ".github"))
    writeFileSync(join(dir, ".github", "config.yml"), "")
    writeFileSync(join(dir, "Dockerfile"), "FROM node:20")
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", dependencies: { react: "^18.0.0" } }))
    writeFileSync(join(dir, "SECURITY.md"), "# Security")
    writeFileSync(join(dir, "ROADMAP.md"), "# Roadmap")
    writeFileSync(join(dir, "main.tf"), "provider \"aws\" {}")

    const results = HubSuggest.suggest(dir, 2)
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it("results are sorted by score descending", () => {
    // Terraform gives cloud-infra weight 4, package.json gives fullstack weight 1
    writeFileSync(join(dir, "main.tf"), "provider \"aws\" {}")
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app" }))
    const results = HubSuggest.suggest(dir)
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score)
    }
  })

  it("includes reasons array in each suggestion", () => {
    mkdirSync(join(dir, ".github"))
    writeFileSync(join(dir, ".github", "config.yml"), "")
    const results = HubSuggest.suggest(dir)
    for (const r of results) {
      expect(Array.isArray(r.reasons)).toBe(true)
      expect(r.reasons.length).toBeGreaterThan(0)
    }
  })

  it("includes command in each suggestion", () => {
    writeFileSync(join(dir, "Dockerfile"), "FROM node:20")
    const results = HubSuggest.suggest(dir)
    for (const r of results) {
      expect(r.command).toMatch(/^hopcoderx hub workflow /)
    }
  })

  it("includes workflowName in each suggestion", () => {
    writeFileSync(join(dir, "main.tf"), "provider \"aws\" {}")
    const results = HubSuggest.suggest(dir)
    for (const r of results) {
      expect(typeof r.workflowName).toBe("string")
      expect(r.workflowName.length).toBeGreaterThan(0)
    }
  })

  it("deduplicates reasons (same signal source doesn't repeat)", () => {
    mkdirSync(join(dir, ".github"))
    writeFileSync(join(dir, ".github", "config.yml"), "")
    writeFileSync(join(dir, "CODEOWNERS"), "* @team")
    const results = HubSuggest.suggest(dir)
    const triage = results.find((r) => r.workflowID === "workflow:triage")
    expect(triage).toBeDefined()
    // reasons should be unique strings
    const unique = new Set(triage!.reasons)
    expect(unique.size).toBe(triage!.reasons.length)
  })
})
