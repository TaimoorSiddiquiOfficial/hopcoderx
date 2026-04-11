import { describe, expect, test } from "bun:test"
import { mergePromptInput } from "../../src/cli/tui-startup"

describe("mergePromptInput", () => {
  test("returns piped input when no prompt flag is provided", () => {
    expect(mergePromptInput(undefined, "from pipe")).toBe("from pipe")
  })

  test("returns prompt when there is no piped input", () => {
    expect(mergePromptInput("from flag")).toBe("from flag")
  })

  test("appends prompt after piped input", () => {
    expect(mergePromptInput("from flag", "from pipe")).toBe("from pipe\nfrom flag")
  })
})
