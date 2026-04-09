import z from "zod"
import { Tool } from "./tool"
import { EditTool } from "./edit"
import DESCRIPTION from "./multiedit.txt"
import path from "path"
import { Instance } from "../project/instance"
import { readFile, writeFile } from "fs/promises"

export const MultiEditTool = Tool.define("multiedit", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    edits: z
      .array(
        z.object({
          filePath: z.string().describe("The absolute path to the file to modify"),
          oldString: z.string().describe("The text to replace"),
          newString: z.string().describe("The text to replace it with (must be different from oldString)"),
          replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
        }),
      )
      .describe("Array of edit operations to perform sequentially on the file"),
  }),
  async execute(params, ctx) {
    const tool = await EditTool.init()
    const results = []
    const backups = new Map<string, string>()

    for (const edit of params.edits) {
      // Save original content before first edit to this file (for atomic rollback)
      if (!backups.has(edit.filePath)) {
        backups.set(edit.filePath, await readFile(edit.filePath, "utf8").catch(() => ""))
      }
      try {
        const result = await tool.execute(
          {
            filePath: edit.filePath,
            oldString: edit.oldString,
            newString: edit.newString,
            replaceAll: edit.replaceAll,
          },
          ctx,
        )
        results.push(result)
      } catch (e) {
        // Atomic rollback: restore all files edited so far
        for (const [p, original] of backups) {
          await writeFile(p, original, "utf8").catch(() => {})
        }
        return {
          title: `Multi-edit failed (rolled back)`,
          metadata: { results: results.map((r) => r.metadata), rolledBack: true },
          output: `Edit failed for ${edit.filePath}. All ${backups.size} file(s) rolled back.\n\nError: ${e instanceof Error ? e.message : e}`,
        }
      }
    }
    return {
      title: [...new Set(params.edits.map((e) => path.relative(Instance.worktree, e.filePath)))].join(", "),
      metadata: {
        results: results.map((r) => r.metadata),
        rolledBack: false,
      },
      output: results.at(-1)!.output,
    }
  },
})
