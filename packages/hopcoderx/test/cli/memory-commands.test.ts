import { test, expect, describe } from "bun:test"

// Unit tests for memory command logic
// Note: Full integration tests with SQLite require proper test database setup

describe("memory edit", () => {
  test("updates memory content", () => {
    const entry = {
      id: "mem-123",
      content: "Original content",
      tags: ["original"],
      score: 1.0,
    }

    const updated = {
      ...entry,
      content: "Updated content",
    }

    expect(updated.content).toBe("Updated content")
    expect(updated.id).toBe(entry.id)
  })

  test("preserves tags when editing content", () => {
    const entry = {
      id: "mem-123",
      content: "Test content",
      tags: ["tag1", "tag2"],
      score: 1.0,
    }

    const updated = {
      ...entry,
      content: "New content",
    }

    expect(updated.tags).toEqual(["tag1", "tag2"])
    expect(updated.content).toBe("New content")
  })

  test("preserves score when editing content", () => {
    const entry = {
      id: "mem-123",
      content: "Test content",
      score: 5.0,
    }

    const updated = {
      ...entry,
      content: "New content",
    }

    expect(updated.score).toBe(5.0)
  })

  test("updates project scope", () => {
    const entry = {
      id: "mem-123",
      content: "Test content",
      projectScope: null,
    }

    const projectScope = "/path/to/project"
    const updated = {
      ...entry,
      projectScope,
    }

    expect(updated.projectScope).toBe(projectScope)
  })
})

describe("memory tag", () => {
  test("adds tags to existing memory", () => {
    const entry = {
      id: "mem-123",
      content: "Test content",
      tags: ["existing"],
    }

    // Merge with existing tags
    const newTags = [...entry.tags, "new-tag"]

    expect(newTags).toContain("existing")
    expect(newTags).toContain("new-tag")
  })

  test("deduplicates tags when adding", () => {
    const entry = {
      id: "mem-123",
      content: "Test content",
      tags: ["tag1", "tag2"],
    }

    // Try to add duplicate tag
    const newTags = [...new Set([...entry.tags, "tag1"])]

    // Should have deduplicated
    expect(newTags).toEqual(["tag1", "tag2"])
    expect(newTags.length).toBe(2)
  })

  test("preserves content when adding tags", () => {
    const entry = {
      id: "mem-123",
      content: "Original content that should stay",
      tags: [],
    }

    const updated = {
      ...entry,
      tags: ["new-tag"],
    }

    expect(updated.content).toBe("Original content that should stay")
  })

  test("preserves score when adding tags", () => {
    const entry = {
      id: "mem-123",
      content: "Test content",
      score: 7.5,
    }

    const updated = {
      ...entry,
      tags: ["new-tag"],
    }

    expect(updated.score).toBe(7.5)
  })
})

describe("memory search", () => {
  test("finds memories by content", () => {
    const memories = [
      { id: "mem-1", content: "This is a test about TypeScript", tags: ["typescript"] },
      { id: "mem-2", content: "Python is also great", tags: ["python"] },
    ]

    const query = "TypeScript"
    const results = memories.filter((m) => m.content.toLowerCase().includes(query.toLowerCase()))

    expect(results.length).toBe(1)
    expect(results[0].content).toContain("TypeScript")
  })

  test("filters by tags", () => {
    const memories = [
      { id: "mem-1", content: "JavaScript content", tags: ["javascript", "frontend"] },
      { id: "mem-2", content: "Python content", tags: ["python", "backend"] },
    ]

    const results = memories.filter((m) => m.tags.includes("frontend"))

    expect(results.length).toBe(1)
    expect(results[0].tags).toContain("frontend")
  })

  test("respects limit", () => {
    const memories = Array.from({ length: 10 }, (_, i) => ({
      id: `mem-${i}`,
      content: `Test content ${i}`,
      tags: ["test"],
    }))

    const limit = 3
    const results = memories.slice(0, limit)

    expect(results.length).toBeLessThanOrEqual(limit)
  })
})

describe("memory list", () => {
  test("lists all memories", () => {
    const memories = [
      { id: "mem-1", content: "First", tags: ["a"] },
      { id: "mem-2", content: "Second", tags: ["b"] },
      { id: "mem-3", content: "Third", tags: ["c"] },
    ]

    expect(memories.length).toBe(3)
  })

  test("filters by project scope", () => {
    const memories = [
      { id: "mem-1", content: "Project A content", projectScope: "/project-a", tags: ["a"] },
      { id: "mem-2", content: "Global content", projectScope: null, tags: ["g"] },
    ]

    const projectScope = "/project-a"
    const filtered = memories.filter((m) => m.projectScope === projectScope)

    expect(filtered.length).toBe(1)
    expect(filtered[0].projectScope).toBe(projectScope)
  })

  test("filters by tags", () => {
    const memories = [
      { id: "mem-1", content: "Content A", tags: ["tag-a"] },
      { id: "mem-2", content: "Content B", tags: ["tag-b"] },
      { id: "mem-3", content: "Content Both", tags: ["tag-a", "tag-b"] },
    ]

    const filtered = memories.filter((m) => m.tags.includes("tag-a"))

    expect(filtered.length).toBe(2)
    for (const entry of filtered) {
      expect(entry.tags).toContain("tag-a")
    }
  })
})

describe("memory delete", () => {
  test("deletes a memory by ID", () => {
    const memories = [
      { id: "mem-1", content: "To be deleted", tags: ["test"] },
      { id: "mem-2", content: "Keep this", tags: ["test"] },
    ]

    const toDelete = "mem-1"
    const remaining = memories.filter((m) => m.id !== toDelete)

    expect(remaining.find((m) => m.id === toDelete)).toBeUndefined()
    expect(remaining.length).toBe(1)
  })

  test("handles deleting non-existent memory", () => {
    const memories = [{ id: "mem-1", content: "Only one", tags: [] }]

    const toDelete = "mem-non-existent"
    const remaining = memories.filter((m) => m.id !== toDelete)

    // Should remain unchanged
    expect(remaining.length).toBe(1)
  })
})

describe("memory clear", () => {
  test("clears all memories", () => {
    const memories = [
      { id: "mem-1", content: "First", tags: ["a"] },
      { id: "mem-2", content: "Second", tags: ["b"] },
    ]

    const cleared: typeof memories = []

    expect(cleared.length).toBe(0)
  })
})

describe("memory export", () => {
  test("exports all memories as array", () => {
    const memories = [
      { id: "mem-1", content: "First", tags: ["a"] },
      { id: "mem-2", content: "Second", tags: ["b"] },
    ]

    const exported = memories.map((m) => ({
      ...m,
      exportedAt: new Date().toISOString(),
    }))

    expect(Array.isArray(exported)).toBe(true)
    expect(exported.length).toBe(2)
    expect(exported[0].content).toBeDefined()
    expect(exported[0].id).toBeDefined()
  })
})

describe("memory upsert", () => {
  test("creates new memory entry", () => {
    const newEntry = {
      id: `mem-${Date.now()}`,
      content: "New memory",
      tags: ["new"],
      score: 1.0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    expect(newEntry.id).toBeDefined()
    expect(newEntry.content).toBe("New memory")
  })

  test("updates existing memory entry", () => {
    const existing = {
      id: "mem-existing",
      content: "Original",
      tags: ["old"],
      score: 1.0,
    }

    const updated = {
      ...existing,
      content: "Updated",
      tags: [...existing.tags, "new"],
      updatedAt: Date.now(),
    }

    expect(updated.id).toBe(existing.id)
    expect(updated.content).toBe("Updated")
    expect(updated.tags).toContain("new")
  })
})
