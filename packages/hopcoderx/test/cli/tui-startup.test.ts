import { describe, expect, test } from "bun:test"
import { buildTuiStartupArgs, mergePromptInput } from "../../src/cli/tui-startup"

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

describe("buildTuiStartupArgs", () => {
  test("maps session selection and variant into TUI startup args", () => {
    expect(
      buildTuiStartupArgs(
        {
          continue: true,
          session: "ses_123",
          agent: "reviewer",
          model: "openai/gpt-5.4",
          fork: true,
          variant: "high",
        },
        "hello",
      ),
    ).toEqual({
      continue: true,
      sessionID: "ses_123",
      agent: "reviewer",
      model: "openai/gpt-5.4",
      prompt: "hello",
      fork: true,
      variant: "high",
    })
  })
})
