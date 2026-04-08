/**
 * `hopcoderx hooks` — manage lifecycle hooks.
 *
 * Sub-commands:
 *   hooks list           List all active hooks
 *   hooks init           Create example hook file in workspace
 *   hooks test <event>   Trigger a test event through all hooks
 */

import { join } from "path"
import { mkdir, writeFile } from "fs/promises"
import { cwd } from "process"
import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Hooks, type HookEvent } from "../../hooks/hooks"
import { Global } from "../../global"

const HOOK_EXAMPLE = `/**
 * HopCoderX hook module example.
 * Place in .hopcoderx/hooks/ or ~/.config/hopcoderx/hooks/
 * Restart the CLI to pick up changes.
 */
export default {
  "before-tool-call": async (ctx) => {
    // Log every tool invocation
    console.log(\`[hook] tool: \${ctx.toolName}\`, ctx.toolArgs)
  },
  "after-tool-call": async (ctx) => {
    // Example: block write to certain paths
    if (ctx.toolName === "write" && ctx.toolArgs?.path?.includes("/etc/")) {
      throw new Error(\`[hook] blocked write to protected path: \${ctx.toolArgs.path}\`)
    }
  },
  "before-agent-start": async (ctx) => {
    console.log(\`[hook] session \${ctx.sessionId} starting\`)
  },
}
`

export const HooksCommand = cmd({
  command: "hooks [action]",
  describe: "Manage lifecycle hooks (before-tool-call, after-agent-reply, etc.)",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["list", "init", "test"] as const,
        default: "list",
      })
      .option("event", { alias: "e", type: "string", description: "Hook event to test" })
      .option("global", { alias: "g", type: "boolean", description: "Create hook in global config dir", default: false }),
  handler: async (args: { action?: string; event?: string; global?: boolean }) => {
    switch (args.action ?? "list") {
      case "list": {
        await Hooks.init(cwd())
        const all = Hooks.list()
        if (!all.length) {
          console.log("No hooks registered.")
          console.log(`  Workspace hooks dir: ${join(cwd(), ".hopcoderx", "hooks")}`)
          console.log(`  Global hooks dir   : ${join(Global.Path.config, "hooks")}`)
          console.log(`  Run \`hopcoderx hooks init\` to create an example hook.`)
          break
        }
        console.log("\n🪝 Active hooks:\n")
        for (const { event, count } of all) {
          console.log(`  ${event.padEnd(24)} ${count} handler(s)`)
        }
        break
      }

      case "init": {
        const dir = args.global
          ? join(Global.Path.config, "hooks")
          : join(cwd(), ".hopcoderx", "hooks")
        await mkdir(dir, { recursive: true })
        const file = join(dir, "example.ts")
        await writeFile(file, HOOK_EXAMPLE, "utf8")
        console.log(`✅ Example hook created: ${file}`)
        break
      }

      case "test": {
        await Hooks.init(cwd())
        const event = (args.event ?? "before-tool-call") as HookEvent
        const ctx = { sessionId: "test", toolName: "bash", toolArgs: { command: "echo hello" } }
        await Hooks.run(event, ctx)
        console.log(`✅ Test event '${event}' fired (${(Hooks.list().find((h) => h.event === event)?.count ?? 0)} handlers ran)`)
        break
      }

      default:
        console.error(`Unknown action: ${args.action}`)
        process.exit(1)
    }
  },
})
