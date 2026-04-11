import type { Argv } from "yargs"

export interface TuiStartupInputArgs {
  model?: string
  prompt?: string
  agent?: string
  continue?: boolean
  session?: string
  fork?: boolean
  variant?: string
}

export interface TuiStartupArgs {
  model?: string
  prompt?: string
  agent?: string
  continue?: boolean
  sessionID?: string
  fork?: boolean
  variant?: string
}

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
    .option("variant", {
      type: "string",
      describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
    })
}

export function mergePromptInput(prompt?: string, piped?: string) {
  if (!prompt) return piped
  return piped ? piped + "\n" + prompt : prompt
}

export function buildTuiStartupArgs(args: TuiStartupInputArgs, prompt?: string): TuiStartupArgs {
  return {
    continue: args.continue,
    sessionID: args.session,
    agent: args.agent,
    model: args.model,
    prompt,
    fork: args.fork,
    variant: args.variant,
  }
}

export async function resolveStartupPrompt(prompt?: string) {
  const piped = !process.stdin.isTTY ? await Bun.stdin.text() : undefined
  return mergePromptInput(prompt, piped)
}
