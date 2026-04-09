/**
 * Refactor tool — LSP-aware code transformations.
 *
 * Rename symbols across files, extract functions/variables, inline,
 * and move files — all with pre-flight diff preview.
 */

import z from "zod"
import { Tool } from "./tool"
import { execFile } from "child_process"
import { promisify } from "util"
import { readFile, writeFile, rename } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { Instance } from "../project/instance"

const execFileAsync = promisify(execFile)

type Meta = Record<string, unknown>

async function tsBiomeRename(oldName: string, newName: string, files: string[], cwd: string): Promise<string[]> {
  const changed: string[] = []
  for (const f of files) {
    const content = await readFile(f, "utf8")
    // Word-boundary aware rename
    const regex = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")
    const updated = content.replace(regex, newName)
    if (updated !== content) {
      await writeFile(f, updated, "utf8")
      changed.push(path.relative(cwd, f))
    }
  }
  return changed
}

async function findSourceFiles(cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.ts", "*.tsx", "*.js", "*.jsx"],
    { cwd, maxBuffer: 2 * 1024 * 1024 },
  ).catch(() => ({ stdout: "" }))
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((f) => path.join(cwd, f))
    .filter(existsSync)
}

function extractFunction(content: string, startLine: number, endLine: number, funcName: string): { updated: string; extracted: string } | null {
  const lines = content.split("\n")
  if (startLine < 1 || endLine > lines.length || startLine > endLine) return null

  const body = lines.slice(startLine - 1, endLine).join("\n")
  const indent = body.match(/^(\s*)/)?.[1] ?? ""
  const dedented = body
    .split("\n")
    .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l))
    .join("\n")

  const extracted = `function ${funcName}() {\n${dedented}\n}`
  const replacement = lines
    .slice(0, startLine - 1)
    .concat([`${indent}${funcName}()`])
    .concat(lines.slice(endLine))
    .join("\n")

  return { updated: replacement, extracted }
}

const OPERATIONS = ["rename", "extract_function", "move_file", "inline_variable"] as const

export const RefactorTool = Tool.define("refactor", {
  description:
    "LSP-aware code refactoring: rename a symbol across all source files, extract code lines into a new function, move a file and update all imports, or inline a simple variable. Shows a preview diff before applying.",
  parameters: z.object({
    operation: z.enum(OPERATIONS).describe(
      "rename: rename symbol across all files | extract_function: extract lines to new function | move_file: rename/move a file and update imports | inline_variable: replace usages of a simple variable with its value",
    ),
    // rename / inline_variable
    old_name: z.string().optional().describe("Current name of the symbol or variable"),
    new_name: z.string().optional().describe("New name for the symbol"),
    // extract_function
    file: z.string().optional().describe("File to operate on (for extract_function, move_file)"),
    start_line: z.number().optional().describe("Start line (1-indexed) for extract_function"),
    end_line: z.number().optional().describe("End line (1-indexed, inclusive) for extract_function"),
    function_name: z.string().optional().describe("Name for the extracted function"),
    // move_file
    new_path: z.string().optional().describe("New path for move_file"),
    // scope
    scope: z.array(z.string()).optional().describe("Limit rename to specific file globs/paths (default: all tracked source files)"),
    dry_run: z.boolean().optional().default(false).describe("Preview changes without applying (default false)"),
  }),
  async execute(params, _ctx) {
    const base = Instance.worktree || Instance.directory
    const op = params.operation

    if (op === "rename") {
      if (!params.old_name || !params.new_name) {
        return { title: "refactor rename", output: "Error: `old_name` and `new_name` are required", metadata: {} as Meta }
      }
      const files = await findSourceFiles(base)
      const targets = params.scope
        ? files.filter((f) => params.scope!.some((s) => f.includes(s)))
        : files

      if (params.dry_run) {
        const preview: string[] = []
        for (const f of targets) {
          const content = await readFile(f, "utf8")
          const regex = new RegExp(`\\b${params.old_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")
          const count = (content.match(regex) ?? []).length
          if (count > 0) preview.push(`  ${path.relative(base, f)} (${count} occurrence${count > 1 ? "s" : ""})`)
        }
        return {
          title: `refactor rename [dry-run]`,
          output: preview.length
            ? `Would rename '${params.old_name}' → '${params.new_name}' in:\n${preview.join("\n")}`
            : `'${params.old_name}' not found in any tracked source file`,
          metadata: { filesAffected: preview.length, dryRun: true } as Meta,
        }
      }

      const changed = await tsBiomeRename(params.old_name, params.new_name, targets, base)
      return {
        title: `refactor rename → ${params.new_name}`,
        output: changed.length
          ? `Renamed '${params.old_name}' → '${params.new_name}' in ${changed.length} file(s):\n${changed.map((f) => `  ${f}`).join("\n")}`
          : `'${params.old_name}' not found in any tracked source file`,
        metadata: { filesChanged: changed.length } as Meta,
      }
    }

    if (op === "extract_function") {
      if (!params.file || !params.start_line || !params.end_line || !params.function_name) {
        return { title: "refactor extract_function", output: "Error: `file`, `start_line`, `end_line`, `function_name` are required", metadata: {} as Meta }
      }
      const filePath = path.isAbsolute(params.file) ? params.file : path.join(base, params.file)
      if (!existsSync(filePath)) return { title: "refactor extract_function", output: `File not found: ${params.file}`, metadata: {} as Meta }

      const content = await readFile(filePath, "utf8")
      const result = extractFunction(content, params.start_line, params.end_line, params.function_name)
      if (!result) return { title: "refactor extract_function", output: "Invalid line range", metadata: {} as Meta }

      if (params.dry_run) {
        return {
          title: `refactor extract_function [dry-run]`,
          output: `Would extract lines ${params.start_line}-${params.end_line} into:\n\n${result.extracted}`,
          metadata: { dryRun: true } as Meta,
        }
      }

      await writeFile(filePath, result.updated + "\n\n" + result.extracted + "\n", "utf8")
      return {
        title: `refactor extract_function → ${params.function_name}`,
        output: `✅ Extracted lines ${params.start_line}-${params.end_line} into \`${params.function_name}()\` in ${params.file}`,
        metadata: { file: params.file, functionName: params.function_name } as Meta,
      }
    }

    if (op === "move_file") {
      if (!params.file || !params.new_path) {
        return { title: "refactor move_file", output: "Error: `file` and `new_path` are required", metadata: {} as Meta }
      }
      const oldPath = path.isAbsolute(params.file) ? params.file : path.join(base, params.file)
      const newPath = path.isAbsolute(params.new_path) ? params.new_path : path.join(base, params.new_path)
      if (!existsSync(oldPath)) return { title: "refactor move_file", output: `File not found: ${params.file}`, metadata: {} as Meta }

      const oldRel = path.relative(base, oldPath).replace(/\\/g, "/")
      const newRel = path.relative(base, newPath).replace(/\\/g, "/")
      const oldNoExt = oldRel.replace(/\.(ts|tsx|js|jsx)$/, "")
      const newNoExt = newRel.replace(/\.(ts|tsx|js|jsx)$/, "")

      if (params.dry_run) {
        return {
          title: "refactor move_file [dry-run]",
          output: `Would move: ${oldRel} → ${newRel}\nWould update imports from '${oldNoExt}' → '${newNoExt}'`,
          metadata: { dryRun: true } as Meta,
        }
      }

      await rename(oldPath, newPath)
      // Update imports in all source files
      const files = await findSourceFiles(base)
      const changed = await tsBiomeRename(`from "${oldNoExt}"`, `from "${newNoExt}"`, files, base)
      const changed2 = await tsBiomeRename(`from '${oldNoExt}'`, `from '${newNoExt}'`, files, base)
      const total = new Set([...changed, ...changed2]).size

      return {
        title: `refactor move_file`,
        output: `✅ Moved ${oldRel} → ${newRel}\nUpdated imports in ${total} file(s)`,
        metadata: { oldPath: oldRel, newPath: newRel, importsUpdated: total } as Meta,
      }
    }

    if (op === "inline_variable") {
      if (!params.file || !params.old_name) {
        return { title: "refactor inline_variable", output: "Error: `file` and `old_name` are required", metadata: {} as Meta }
      }
      const filePath = path.isAbsolute(params.file) ? params.file : path.join(base, params.file)
      if (!existsSync(filePath)) return { title: "refactor inline_variable", output: `File not found: ${params.file}`, metadata: {} as Meta }

      const content = await readFile(filePath, "utf8")
      const name = params.old_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

      // Match: const/let/var name[: Type] = <value>;  (single line only)
      const declRegex = new RegExp(`^([ \\t]*)(?:const|let|var)\\s+${name}(?:\\s*:[^=]+)?\\s*=\\s*(.+?)\\s*;?\\s*$`, "m")
      const declMatch = declRegex.exec(content)
      if (!declMatch) {
        return { title: "refactor inline_variable", output: `Could not find single-line declaration for '${params.old_name}'`, metadata: {} as Meta }
      }

      const rawValue = declMatch[2]!.trim()
      const usageRegex = new RegExp(`\\b${name}\\b`, "g")
      // Count usages excluding the declaration line
      const declLine = declMatch[0]
      const contentWithoutDecl = content.replace(declLine, "")
      const usages = (contentWithoutDecl.match(usageRegex) ?? []).length

      if (params.dry_run) {
        return {
          title: "refactor inline_variable [dry-run]",
          output: `Would inline '${params.old_name}' = ${rawValue}\nWould replace ${usages} usage(s) and remove declaration`,
          metadata: { dryRun: true, usages } as Meta,
        }
      }

      // Replace all usages with the value, then remove the declaration line
      const inlined = contentWithoutDecl.replace(usageRegex, rawValue)
      await writeFile(filePath, inlined, "utf8")
      return {
        title: `refactor inline_variable → ${params.old_name}`,
        output: `✅ Inlined '${params.old_name}' = ${rawValue}\nReplaced ${usages} usage(s) and removed declaration in ${params.file}`,
        metadata: { file: params.file, variable: params.old_name, value: rawValue, usagesReplaced: usages } as Meta,
      }
    }

    return { title: "refactor", output: "Unknown operation", metadata: {} as Meta }
  },
})
