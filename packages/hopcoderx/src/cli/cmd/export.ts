import type { Argv } from "yargs"
import { Session } from "../../session"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { EOL } from "os"
import fs from "fs/promises"

function toMarkdown(exportData: { info: any; messages: { info: any; parts: any[] }[] }): string {
  const lines: string[] = []
  lines.push(`# ${exportData.info.title ?? "Session Export"}`)
  lines.push("")
  lines.push(`**Session ID:** \`${exportData.info.id}\``)
  lines.push(`**Created:** ${new Date(exportData.info.time.created).toLocaleString()}`)
  lines.push(`**Updated:** ${new Date(exportData.info.time.updated).toLocaleString()}`)
  lines.push("")
  lines.push("---")
  lines.push("")

  for (const msg of exportData.messages) {
    const role = msg.info.role ?? "assistant"
    lines.push(`### ${role === "user" ? "User" : "Assistant"}`)
    lines.push("")
    for (const part of msg.parts) {
      if (part.type === "text") {
        lines.push(part.text ?? "")
      } else if (part.type === "tool-invocation") {
        lines.push("```")
        lines.push(`Tool: ${part.toolName ?? "unknown"}`)
        if (part.state === "result" && part.result) {
          lines.push(`Result: ${typeof part.result === "string" ? part.result : JSON.stringify(part.result)}`)
        }
        lines.push("```")
      }
      lines.push("")
    }
  }

  return lines.join("\n")
}

export const ExportCommand = cmd({
  command: "export [sessionID]",
  describe: "export session data as JSON or Markdown",
  builder: (yargs: Argv) => {
    return yargs
      .positional("sessionID", {
        describe: "session id to export",
        type: "string",
      })
      .option("format", {
        alias: "f",
        describe: "output format",
        choices: ["json", "markdown"] as const,
        default: "json" as "json" | "markdown",
        type: "string",
      })
      .option("output", {
        alias: "o",
        describe: "write output to file instead of stdout",
        type: "string",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      let sessionID = args.sessionID
      process.stderr.write(`Exporting session: ${sessionID ?? "latest"}\n`)

      if (!sessionID) {
        UI.empty()
        prompts.intro("Export session", {
          output: process.stderr,
        })

        const sessions = []
        for await (const session of Session.list()) {
          sessions.push(session)
        }

        if (sessions.length === 0) {
          prompts.log.error("No sessions found", {
            output: process.stderr,
          })
          prompts.outro("Done", {
            output: process.stderr,
          })
          return
        }

        sessions.sort((a, b) => b.time.updated - a.time.updated)

        const selectedSession = await prompts.autocomplete({
          message: "Select session to export",
          maxItems: 10,
          options: sessions.map((session) => ({
            label: session.title,
            value: session.id,
            hint: `${new Date(session.time.updated).toLocaleString()} • ${session.id.slice(-8)}`,
          })),
          output: process.stderr,
        })

        if (prompts.isCancel(selectedSession)) {
          throw new UI.CancelledError()
        }

        sessionID = selectedSession as string

        prompts.outro("Exporting session...", {
          output: process.stderr,
        })
      }

      try {
        const sessionInfo = await Session.get(sessionID!)
        const messages = await Session.messages({ sessionID: sessionID! })

        const exportData = {
          info: sessionInfo,
          messages: messages.map((msg) => ({
            info: msg.info,
            parts: msg.parts,
          })),
        }

        const content =
          args.format === "markdown" ? toMarkdown(exportData) : JSON.stringify(exportData, null, 2) + EOL

        if (args.output) {
          await fs.writeFile(args.output, content, "utf8")
          process.stderr.write(`Exported to ${args.output}${EOL}`)
        } else {
          process.stdout.write(content)
          if (args.format !== "markdown") process.stdout.write(EOL)
        }
      } catch (error) {
        UI.error(`Session not found: ${sessionID!}`)
        process.exit(1)
      }
    })
  },
})
