import { describe, expect, test } from "bun:test"
import { validateSessionSelection } from "../../src/cli/session-selection"

describe("validateSessionSelection", () => {
  test("rejects using continue and session together", () => {
    expect(validateSessionSelection({ continue: true, session: "abc" })).toBe(
      "Use either --continue or --session, not both",
    )
  })

  test("rejects fork without a base session selector", () => {
    expect(validateSessionSelection({ fork: true })).toBe("--fork requires --continue or --session")
  })

  test("accepts continue on its own", () => {
    expect(validateSessionSelection({ continue: true })).toBeUndefined()
  })

  test("accepts explicit session selection", () => {
    expect(validateSessionSelection({ session: "abc" })).toBeUndefined()
  })
})
