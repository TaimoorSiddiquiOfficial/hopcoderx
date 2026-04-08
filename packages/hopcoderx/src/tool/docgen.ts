import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import path from "path"

const log = Log.create({ service: "docgen" })

const DESCRIPTION = `Generate documentation for source files, functions, or entire directories.

Capabilities:
- JSDoc/TSDoc comments for TypeScript/JavaScript functions and classes
- README.md generation for a module or package directory
- OpenAPI/JSON Schema generation from TypeScript types and Zod schemas
- Inline comment generation for complex logic blocks

The tool reads source files and returns structured documentation that can be
written back by the agent using the write/edit tools.`

type Meta = Record<string, string | number | boolean | undefined>

const parameters = z.object({
  target: z
    .string()
    .describe("File path or directory to generate documentation for (relative to project root)"),
  format: z
    .enum(["jsdoc", "tsdoc", "readme", "openapi", "markdown", "inline"])
    .default("tsdoc")
    .describe("Documentation format to generate"),
  scope: z
    .enum(["file", "exports", "all"])
    .default("exports")
    .describe("'exports' = only exported symbols, 'all' = everything, 'file' = file-level only"),
  outputFile: z
    .string()
    .optional()
    .describe("Where to write output (defaults to inline for jsdoc/tsdoc, README.md for readme)"),
  language: z
    .string()
    .optional()
    .describe("Override detected language (e.g. 'typescript', 'python', 'go')"),
})

export const DocgenTool = Tool.define<typeof parameters, Meta>("docgen", {
  description: DESCRIPTION,
  parameters,
  async execute({ target, format, scope, outputFile, language }, ctx) {
    const dir = Instance.directory
    const absTarget = path.isAbsolute(target) ? target : path.join(dir, target)

    const isDir = await Filesystem.isDir(absTarget)
    const exists = await Filesystem.exists(absTarget)

    if (!exists) {
      return {
        title: `docgen: ${target}`,
        metadata: {} as Meta,
        output: `Error: "${target}" does not exist.`,
      }
    }

    let filesToDocument: string[] = []

    if (isDir) {
      // For directories, collect source files
      const { Glob } = await import("../util/glob")
      const extensions = getExtensions(language)
      const patterns = extensions.map((e) => `**/*.${e}`)
      const files: string[] = []
      for (const pat of patterns) {
        const found = await Glob.scan(pat, { cwd: absTarget, absolute: true, dot: false })
        files.push(...found)
      }
      // Exclude node_modules, dist, .git
      filesToDocument = files
        .filter((f) => !f.includes("node_modules") && !f.includes("/dist/") && !f.includes("/.git/"))
        .slice(0, 20) // cap at 20 files for context
    } else {
      filesToDocument = [absTarget]
    }

    // Read file contents (capped to keep context manageable)
    const sources: { file: string; content: string }[] = []
    for (const f of filesToDocument) {
      try {
        const content = await Filesystem.readText(f)
        sources.push({ file: path.relative(dir, f), content: content.slice(0, 6000) })
      } catch {
        // skip unreadable files
      }
    }

    if (sources.length === 0) {
      return {
        title: `docgen: ${target}`,
        metadata: {} as Meta,
        output: `No source files found in "${target}" for language "${language ?? "auto"}".`,
      }
    }

    // Determine output file
    let resolvedOutput = outputFile
    if (!resolvedOutput) {
      if (format === "readme") {
        resolvedOutput = isDir ? path.join(target, "README.md") : path.join(path.dirname(target), "README.md")
      } else if (format === "openapi") {
        resolvedOutput = isDir ? path.join(target, "openapi.json") : target.replace(/\.[^.]+$/, ".openapi.json")
      }
    }

    log.info("docgen request", { target, format, files: filesToDocument.length })

    const docInstructions: Record<string, string> = {
      jsdoc: "Generate JSDoc comments (/** */ style) for all functions, classes, and exported symbols.",
      tsdoc:
        "Generate TSDoc comments (/** */ with @param, @returns, @throws, @example tags) for all exported TypeScript symbols.",
      readme: "Generate a comprehensive README.md with: Overview, Installation, Usage examples, API reference, License.",
      openapi: "Generate an OpenAPI 3.1 JSON spec from the TypeScript types, Zod schemas, and route handlers.",
      markdown: "Generate Markdown documentation with sections for each exported symbol.",
      inline: "Add inline comments (// style) inside complex logic blocks to explain non-obvious code.",
    }

    const output = [
      `## Documentation Generation Plan`,
      "",
      `**Target:** ${target}`,
      `**Format:** ${format}`,
      `**Scope:** ${scope}`,
      resolvedOutput ? `**Output:** ${resolvedOutput}` : "**Output:** inline (edit source files)",
      "",
      `### Agent instructions`,
      docInstructions[format],
      scope === "exports"
        ? "Only document exported symbols (functions, classes, types, constants)."
        : scope === "all"
          ? "Document all symbols including internal/private ones."
          : "Add only file-level documentation (module docstring/header comment).",
      resolvedOutput
        ? `Write the output to \`${resolvedOutput}\`.`
        : "Edit the source files in-place using the edit tool.",
      "",
      `### Source files (${sources.length})`,
      ...sources.map(
        ({ file, content }) =>
          `\n#### ${file}\n\`\`\`\n${content}${content.length >= 6000 ? "\n... (truncated)" : ""}\n\`\`\``,
      ),
    ].join("\n")

    return {
      title: `docgen: ${target} (${format})`,
      metadata: {
        format,
        target,
        filesAnalyzed: sources.length,
        outputFile: resolvedOutput,
      },
      output,
    }
  },
})

function getExtensions(language?: string): string[] {
  switch (language?.toLowerCase()) {
    case "typescript":
    case "ts":
      return ["ts", "tsx"]
    case "javascript":
    case "js":
      return ["js", "jsx", "mjs", "cjs"]
    case "python":
    case "py":
      return ["py"]
    case "go":
      return ["go"]
    case "rust":
    case "rs":
      return ["rs"]
    case "java":
      return ["java"]
    default:
      return ["ts", "tsx", "js", "jsx", "mjs"]
  }
}
