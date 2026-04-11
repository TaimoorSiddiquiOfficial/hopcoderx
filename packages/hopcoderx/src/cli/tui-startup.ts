import type { Argv } from "yargs"

export function withTuiStartupOptions<T>(yargs: Argv<T>) {
  return yargs
    .option("model", {
      type: "string",
      alias: ["m"],
      describe: "model to use in the format of provider/model",
    })
    .option("prompt", {
      type: "string",
      describe: "prompt to use",
    })
    .option("agent", {
      type: "string",
      describe: "agent to use",
    })
}

export function mergePromptInput(prompt?: string, piped?: string) {
  if (!prompt) return piped
  return piped ? piped + "\n" + prompt : prompt
}

export async function resolveStartupPrompt(prompt?: string) {
  const piped = !process.stdin.isTTY ? await Bun.stdin.text() : undefined
  return mergePromptInput(prompt, piped)
}
