/**
 * hopcoderx permission — manage project-level permission rules.
 *
 * Sub-commands:
 *   list    Show the current approved "always" rules for this project
 *   reset   Clear all persisted "always" rules for this project
 */

import type { Argv } from "yargs"
import readline from "readline"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Database, eq } from "../../storage/db"
import { PermissionTable } from "../../session/session.sql"
import { Instance } from "../../project/instance"

// ─── list ─────────────────────────────────────────────────────────────────

const PermissionListCommand = cmd({
  command: "list",
  describe: "list persisted permission rules for this project",
  handler: async () => {
    await bootstrap(process.cwd(), async () => {
      const row = Database.use((db) =>
        db.select().from(PermissionTable).where(eq(PermissionTable.project_id, Instance.project.id)).get(),
      )

      const rules = row?.data ?? []

      if (rules.length === 0) {
        console.log("No persisted permission rules for this project.")
        console.log("Tip: answer 'always allow' in a permission prompt to persist a rule.")
        return
      }

      const width = 64
      const header = (title: string) => {
        const pad = Math.max(0, width - 2 - title.length)
        const left = Math.floor(pad / 2)
        const right = pad - left
        return `┌${"─".repeat(width - 2)}┐\n│${" ".repeat(left)}${title}${" ".repeat(right)}│\n├${"─".repeat(width - 2)}┤`
      }
      const row2 = (label: string, value: string) => {
        const content = `  ${label.padEnd(12)}: ${value}`
        const pad = Math.max(0, width - 2 - content.length)
        return `│${content}${" ".repeat(pad)}│`
      }

      console.log(header(`PERMISSION RULES (${rules.length})`))

      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i]
        console.log(row2("permission", rule.permission))
        console.log(row2("pattern", rule.pattern))
        console.log(row2("action", rule.action))
        if (i < rules.length - 1) {
          console.log(`├${"─".repeat(width - 2)}┤`)
        }
      }

      console.log(`└${"─".repeat(width - 2)}┘`)
    })
  },
})

// ─── reset ────────────────────────────────────────────────────────────────

const PermissionResetCommand = cmd({
  command: "reset",
  describe: "remove all persisted permission rules for this project",
  builder: (yargs: Argv) =>
    yargs.option("yes", {
      alias: "y",
      type: "boolean",
      describe: "skip confirmation prompt",
      default: false,
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const row = Database.use((db) =>
        db.select().from(PermissionTable).where(eq(PermissionTable.project_id, Instance.project.id)).get(),
      )

      const ruleCount = row?.data?.length ?? 0
      if (ruleCount === 0) {
        console.log("No persisted permission rules to remove.")
        return
      }

      if (!args.yes) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        const answer = await new Promise<string>((resolve) => {
          rl.question(`Remove ${ruleCount} permission rule(s)? (y/N): `, resolve)
        })
        rl.close()
        if (answer.trim().toLowerCase() !== "y") {
          console.log("Aborted.")
          return
        }
      }

      Database.use((db) =>
        db.delete(PermissionTable).where(eq(PermissionTable.project_id, Instance.project.id)).run(),
      )

      console.log(`Removed ${ruleCount} permission rule(s). The session will ask for approval again next time.`)
    })
  },
})

// ─── parent ───────────────────────────────────────────────────────────────

export const PermissionCommand = cmd({
  command: "permission",
  describe: "manage project permission rules",
  builder: (yargs: Argv) => yargs.command(PermissionListCommand).command(PermissionResetCommand).demandCommand(),
  handler: () => {},
})
