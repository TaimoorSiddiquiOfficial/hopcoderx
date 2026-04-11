import { describe, expect, test } from "bun:test"
import { resolveDirectorySelection, validateDirectorySelection } from "../../src/cli/directory-selection"

describe("validateDirectorySelection", () => {
  test("rejects project and dir together", () => {
    expect(validateDirectorySelection({ project: "app", dir: "src" })).toBe("Use either [project] or --dir, not both")
  })

  test("allows project on its own", () => {
    expect(validateDirectorySelection({ project: "app" })).toBeUndefined()
  })
})

describe("resolveDirectorySelection", () => {
  test("returns undefined when no directory was provided", () => {
    expect(resolveDirectorySelection({}, { baseCwd: "C:\\Users\\Taimoor" })).toBeUndefined()
  })

  test("preserves unresolved dir when configured for remote flows", () => {
    expect(
      resolveDirectorySelection(
        { dir: "/remote/worktree" },
        {
          baseCwd: "C:\\Users\\Taimoor",
          allowUnresolvedDir: true,
        },
      ),
    ).toBe("/remote/worktree")
  })
})
