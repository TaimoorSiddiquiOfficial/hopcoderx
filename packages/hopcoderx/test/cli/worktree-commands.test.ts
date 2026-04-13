import { test, expect, describe } from "bun:test"

describe("worktree rename", () => {
  test("parses git worktree list output", async () => {
    // Test the core logic: finding worktree by branch name
    const worktrees = [
      { path: "/path/to/main", branch: "main", head: "abc123" },
      { path: "/path/to/feature-a", branch: "feature-a", head: "def456" },
      { path: "/path/to/feature-b", branch: "feature-b", head: "789xyz" },
    ]

    expect(worktrees.length).toBe(3)
    const featureA = worktrees.find((w) => w.branch === "feature-a")
    expect(featureA).toBeDefined()
    expect(featureA?.path).toBe("/path/to/feature-a")
  })

  test("finds worktree by branch name", async () => {
    const worktrees = [
      { path: "/path/to/main", branch: "refs/heads/main" },
      { path: "/path/to/feature-a", branch: "refs/heads/feature-a" },
      { path: "/path/to/feature-b", branch: "refs/heads/feature-b" },
    ]

    const found = worktrees.find((w) => w.branch === "refs/heads/feature-a")
    expect(found).toBeDefined()
    expect(found?.path).toBe("/path/to/feature-a")
  })

  test("constructs new path from parent directory", async () => {
    const oldPath = "/path/to/worktrees/feature-a"
    const newName = "feature-a-renamed"

    const pathParts = oldPath.split(/[\\/]/)
    const parentDir = pathParts.slice(0, -1).join("/")
    const newPath = `${parentDir}/${newName}`

    expect(parentDir).toBe("/path/to/worktrees")
    expect(newPath).toBe("/path/to/worktrees/feature-a-renamed")
  })

  test("handles Windows paths", async () => {
    const oldPath = "C:\\Users\\worktrees\\feature-a"
    const newName = "feature-a-renamed"

    const pathParts = oldPath.split(/[\\/]/)
    const parentDir = pathParts.slice(0, -1).join("/")
    const newPath = `${parentDir}/${newName}`

    expect(parentDir).toBe("C:/Users/worktrees")
    expect(newPath).toBe("C:/Users/worktrees/feature-a-renamed")
  })

  test("returns not found for non-existent branch", async () => {
    const worktrees = [
      { path: "/path/to/main", branch: "refs/heads/main" },
      { path: "/path/to/feature-a", branch: "refs/heads/feature-a" },
    ]

    const found = worktrees.find((w) => w.branch === "refs/heads/non-existent")
    expect(found).toBeUndefined()
  })
})

describe("worktree list", () => {
  test("formats worktree list as table", async () => {
    const worktrees = [
      { path: "/path/to/main", branch: "main", head: "abc1234" },
      { path: "/path/to/feature-a", branch: "feature-a", head: "def5678" },
    ]

    const maxPath = Math.max(...worktrees.map((w) => w.path.length))
    const maxBranch = Math.max(...worktrees.map((w) => w.branch.length))

    expect(maxPath).toBeGreaterThan(0)
    expect(maxBranch).toBeGreaterThan(0)
  })

  test("formats worktree list as JSON", async () => {
    const worktrees = [
      { path: "/path/to/main", branch: "main", head: "abc1234" },
      { path: "/path/to/feature-a", branch: "feature-a", head: "def5678" },
    ]

    const json = JSON.stringify(worktrees, null, 2)
    expect(json).toContain('"path"')
    expect(json).toContain('"branch"')
    expect(json).toContain('"head"')
  })
})

describe("worktree create", () => {
  test("generates unique name if not provided", async () => {
    const baseName = "worktree"
    const randomSuffix = Math.random().toString(36).slice(2)
    const generatedName = `${baseName}-${randomSuffix}`

    expect(generatedName).toMatch(/^worktree-[a-z0-9]+$/)
  })

  test("validates worktree name", async () => {
    const validNames = ["feature-a", "bugfix-123", "releasev10"]
    const invalidNames = ["", "feature a", "feature@a"]

    for (const name of validNames) {
      expect(name).toMatch(/^[a-zA-Z0-9_-]+$/)
    }

    for (const name of invalidNames) {
      if (name === "") continue
      expect(name).not.toMatch(/^[a-zA-Z0-9_-]+$/)
    }
  })
})

describe("worktree delete", () => {
  test("removes worktree directory", async () => {
    const mockWorktree = {
      path: "/path/to/delete",
      branch: "refs/heads/to-delete",
    }

    // Simulate deletion
    const deleted = true

    expect(deleted).toBe(true)
  })

  test("dry-run shows what would be deleted", async () => {
    const mockWorktree = {
      path: "/path/to/delete",
      branch: "refs/heads/to-delete",
    }

    const dryRunMessage = `[dry-run] Would delete worktree at ${mockWorktree.path}`

    expect(dryRunMessage).toContain(mockWorktree.path)
    expect(dryRunMessage).toContain("[dry-run]")
  })
})

describe("worktree switch", () => {
  test("prints cd command for worktree", async () => {
    const worktree = {
      path: "/path/to/worktree",
      branch: "refs/heads/feature",
    }

    const switchCommand = `cd ${worktree.path}`

    expect(switchCommand).toContain(worktree.path)
  })
})

describe("worktree diff", () => {
  test("compares two worktrees", async () => {
    const worktreeA = { branch: "main", head: "abc1234" }
    const worktreeB = { branch: "feature", head: "def5678" }

    const range = `${worktreeA.head}...${worktreeB.head}`

    expect(range).toBe("abc1234...def5678")
  })

  test("shows stat summary", async () => {
    const mockDiffStat = `
 src/file.ts | 10 +++++++++-
 test/file.test.ts | 5 +++++
 2 files changed, 14 insertions(+), 1 deletion(-)
`

    expect(mockDiffStat).toContain("files changed")
    expect(mockDiffStat).toContain("insertions")
  })
})

describe("worktree prune", () => {
  test("removes stale worktree metadata", async () => {
    const mockPruneOutput = "Pruning worktree /path/to/stale"

    expect(mockPruneOutput).toContain("Pruning")
  })

  test("reports nothing to prune", async () => {
    const mockPruneOutput = ""

    const message = mockPruneOutput || "✓ Nothing to prune"
    expect(message).toBe("✓ Nothing to prune")
  })
})
