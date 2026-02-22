/**
 * B5 - Non-Interactive Shell Strategy Plugin
 *
 * Injects environment variables and system-prompt instructions that make
 * shell commands behave reliably in a non-interactive, automated context.
 *
 * shell.env hook – sets process-level vars so every spawned command inherits:
 *   DEBIAN_FRONTEND=noninteractive   – prevents apt prompts
 *   GIT_PAGER=cat                    – disables Git's less pager
 *   PAGER=cat                        – disables other pagers
 *   CI=true                          – signals CI-like environment
 *   TERM=dumb                        – prevents colour/escape sequences
 *   NPM_CONFIG_YES=true              – auto-answer npm prompts
 *
 * experimental.chat.system.transform hook – appends a brief instruction
 * block reminding the model to always pass non-interactive flags when
 * calling shell tools.
 */

import type { Plugin, Hooks } from "@hopcoderx/plugin"

const NON_INTERACTIVE_ENV: Record<string, string> = {
  DEBIAN_FRONTEND: "noninteractive",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  PAGER: "cat",
  CI: "true",
  TERM: "dumb",
  NPM_CONFIG_YES: "true",
  PIP_NO_INPUT: "1",
  PYTHONUNBUFFERED: "1",
}

const SYSTEM_INSTRUCTIONS = `
## Shell Strategy
Always run commands in non-interactive mode:
- Pass \`-y\` or \`--yes\` to package managers (apt, npm, pip, brew, etc.)
- Use \`--no-pager\` with git commands that page output (git log, git diff, etc.)
- Prefer \`--quiet\` / \`--silent\` when verbosity is not needed
- Never invoke commands that require terminal input (e.g. interactive editors, confirmation prompts without \`-y\`)
`.trim()

export const ShellStrategyPlugin: Plugin = async (_ctx): Promise<Hooks> => {
  return {
    "shell.env": async (_input, output) => {
      for (const [k, v] of Object.entries(NON_INTERACTIVE_ENV)) {
        if (!(k in output.env)) output.env[k] = v
      }
    },

    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(SYSTEM_INSTRUCTIONS)
    },
  }
}
