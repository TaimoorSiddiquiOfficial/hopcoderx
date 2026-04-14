/**
 * Unit tests for memory system
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { SQLiteMemory } from "../../src/memory/sqlite"
import type { MemoryEntry } from "../../src/memory/memory"
import { join } from "path"
import { tmpdir } from "os"
import { mkdtemp, rm } from "fs/promises"

describe("SQLiteMemory", () => {
  let memory: SQLiteMemory
  let tempDir: string
  let originalDataPath: string | undefined

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hopcoderx-memory-test-"))

    // Mock Global.Path.data to use temp directory
    const { Global } = await import("../../src/global")
    originalDataPath = Global.Path.data
    Global.Path.data = tempDir

    memory = new SQLiteMemory()
    await memory.init()
  })

  afterEach(async () => {
    await memory.close()
    await rm(tempDir, { recursive: true, force: true })

    if (originalDataPath) {
      const { Global } = await import("../../src/global")
      Global.Path.data = originalDataPath
    }
  })

  describe("upsert", () => {
    it("should create new memory entry", async () => {
      const entry = await memory.upsert({
        content: "Test memory content",
        tags: ["test", "unit"],
        projectScope: null,
        score: 1.0,
      })

      expect(entry.id).toBeDefined()
      expect(entry.content).toBe("Test memory content")
      expect(entry.tags).toEqual(["test", "unit"])
      expect(entry.score).toBe(1.0)
    })

    it("should update existing memory entry", async () => {
      const entry = await memory.upsert({
        content: "Original content",
        tags: ["test"],
        projectScope: null,
        score: 1.0,
      })

      const updated = await memory.upsert({
        id: entry.id,
        content: "Updated content",
        tags: ["test", "updated"],
        projectScope: null,
        score: 2.0,
      })

      expect(updated.id).toBe(entry.id)
      expect(updated.content).toBe("Updated content")
      expect(updated.tags).toEqual(["test", "updated"])
      expect(updated.score).toBe(2.0)
    })

    it("should generate UUID if not provided", async () => {
      const entry = await memory.upsert({
        content: "Test",
        tags: [],
        projectScope: null,
        score: 1.0,
      })

      expect(entry.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
    })
  })

  describe("get", () => {
    it("should retrieve memory by ID", async () => {
      const created = await memory.upsert({
        content: "Retrieve test",
        tags: ["retrieve"],
        projectScope: null,
        score: 1.0,
      })

      const retrieved = await memory.get(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.content).toBe("Retrieve test")
    })

    it("should return null for non-existent ID", async () => {
      const result = await memory.get("non-existent-id")
      expect(result).toBeNull()
    })

    it("should increment accessCount on get", async () => {
      const entry = await memory.upsert({
        content: "Access test",
        tags: [],
        projectScope: null,
        score: 1.0,
      })

      expect(entry.accessCount).toBe(0)

      await memory.get(entry.id)
      const updated = await memory.get(entry.id)

      expect(updated?.accessCount).toBeGreaterThan(0)
    })
  })

  describe("delete", () => {
    it("should delete memory by ID", async () => {
      const entry = await memory.upsert({
        content: "Delete test",
        tags: [],
        projectScope: null,
        score: 1.0,
      })

      await memory.delete(entry.id)

      const result = await memory.get(entry.id)
      expect(result).toBeNull()
    })

    it("should not error when deleting non-existent ID", async () => {
      await expect(memory.delete("non-existent-id")).not.toThrow()
    })
  })

  describe("search", () => {
    beforeEach(async () => {
      // Add test data
      await memory.upsert({
        content: "TypeScript is a programming language",
        tags: ["typescript", "programming"],
        projectScope: null,
        score: 1.0,
      })
      await memory.upsert({
        content: "JavaScript for web development",
        tags: ["javascript", "web"],
        projectScope: null,
        score: 1.0,
      })
      await memory.upsert({
        content: "Python for data science",
        tags: ["python", "data"],
        projectScope: null,
        score: 1.0,
      })
    })

    it("should search by content", async () => {
      const results = await memory.search("TypeScript")
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].entry.content).toContain("TypeScript")
    })

    it("should filter by project scope", async () => {
      await memory.upsert({
        content: "Project specific memory",
        tags: [],
        projectScope: "/test/project",
        score: 1.0,
      })

      const results = await memory.search("project", {
        projectScope: "/test/project",
      })

      expect(results.some((r) => r.entry.projectScope === "/test/project")).toBe(true)
    })

    it("should filter by tags", async () => {
      const results = await memory.search("code", {
        tags: ["typescript"],
      })

      expect(results.every((r) => r.entry.tags.includes("typescript"))).toBe(true)
    })

    it("should respect limit", async () => {
      const results = await memory.search("", { limit: 2 })
      expect(results.length).toBeLessThanOrEqual(2)
    })

    it("should rank by relevance", async () => {
      const results = await memory.search("TypeScript programming")

      // First result should have highest similarity
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity)
      }
    })
  })

  describe("list", () => {
    beforeEach(async () => {
      await memory.upsert({ content: "Item 1", tags: ["a"], projectScope: null, score: 1.0 })
      await memory.upsert({ content: "Item 2", tags: ["b"], projectScope: null, score: 1.0 })
      await memory.upsert({ content: "Item 3", tags: ["a", "b"], projectScope: null, score: 1.0 })
    })

    it("should list all entries", async () => {
      const entries = await memory.list()
      expect(entries.length).toBe(3)
    })

    it("should filter by tags", async () => {
      const entries = await memory.list({ tags: ["a"] })
      expect(entries.length).toBe(2)
      expect(entries.every((e) => e.tags.includes("a"))).toBe(true)
    })

    it("should filter by project scope", async () => {
      await memory.upsert({
        content: "Project item",
        tags: [],
        projectScope: "/project",
        score: 1.0,
      })

      const entries = await memory.list({ projectScope: "/project" })
      expect(entries.some((e) => e.projectScope === "/project")).toBe(true)
    })

    it("should respect limit", async () => {
      const entries = await memory.list({ limit: 2 })
      expect(entries.length).toBe(2)
    })

    it("should sort by score descending", async () => {
      await memory.upsert({ content: "Low score", tags: [], projectScope: null, score: 0.1 })
      await memory.upsert({ content: "High score", tags: [], projectScope: null, score: 0.9 })

      const entries = await memory.list()
      expect(entries[0].score).toBeGreaterThanOrEqual(entries[entries.length - 1].score)
    })
  })

  describe("export", () => {
    it("should export all entries", async () => {
      await memory.upsert({ content: "Export 1", tags: [], projectScope: null, score: 0.5 })
      await memory.upsert({ content: "Export 2", tags: [], projectScope: null, score: 0.5 })

      const exported = await memory.export()
      expect(exported.length).toBe(2)
    })
  })

  describe("clear", () => {
    it("should clear all entries", async () => {
      await memory.upsert({ content: "Clear 1", tags: [], projectScope: null, score: 0.5 })
      await memory.upsert({ content: "Clear 2", tags: [], projectScope: null, score: 0.5 })

      await memory.clear()

      const entries = await memory.list()
      expect(entries.length).toBe(0)
    })
  })
})
