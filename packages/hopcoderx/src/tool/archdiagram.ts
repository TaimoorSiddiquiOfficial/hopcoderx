import z from "zod"
import { Tool } from "./tool"
import { readdir, stat } from "fs/promises"
import { Instance } from "../project/instance"
import path from "path"

const DESCRIPTION = `Generate architecture diagrams from codebase analysis.

Analyzes import/export relationships across source files to produce:
- **Mermaid** diagrams (default) — renderable in GitHub, Notion, VS Code
- **PlantUML** diagrams — for enterprise tools

Use cases:
- Understand an unfamiliar codebase
- Document module dependencies
- Identify circular dependencies and tightly-coupled modules
- Generate diagrams for README or architecture docs`

type Meta = Record<string, string | number | boolean | undefined>

interface Module {
  file: string
  imports: string[]
  exports: string[]
  isEntry: boolean
}

async function analyzeImports(dir: string, ext: string[]): Promise<Module[]> {
  const modules: Module[] = []
  const seen = new Set<string>()

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > 4) return
    let entries: string[]
    try {
      entries = await readdir(current)
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules" || entry === "dist" || entry === "build") continue
      const full = path.join(current, entry)
      let fileStat: Awaited<ReturnType<typeof stat>> | null = null
      try { fileStat = await stat(full) } catch { continue }

      if (fileStat.isDirectory()) {
        await walk(full, depth + 1)
      } else if (ext.some((e) => entry.endsWith(e))) {
        if (seen.has(full)) continue
        seen.add(full)
        let content = ""
        try { content = await Bun.file(full).text() } catch { continue }
        const imports = extractImports(content, full, dir)
        const exports = extractExports(content)
        const isEntry =
          entry === "index.ts" ||
          entry === "index.js" ||
          entry === "main.ts" ||
          entry === "main.js" ||
          entry === "app.ts" ||
          entry === "app.js"
        modules.push({ file: path.relative(dir, full), imports, exports, isEntry })
      }
    }
  }

  await walk(dir, 0)
  return modules
}

function extractImports(content: string, filePath: string, root: string): string[] {
  const imports: string[] = []
  const patterns = [
    /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    let m: RegExpExecArray | null
    while ((m = pattern.exec(content)) !== null) {
      const imp = m[1]
      if (imp.startsWith(".")) {
        const resolved = path.relative(root, path.resolve(path.dirname(filePath), imp))
        imports.push(resolved.replace(/\\/g, "/"))
      } else if (!imp.startsWith("@/")) {
        imports.push(imp)
      } else {
        imports.push(imp)
      }
    }
  }
  return [...new Set(imports)]
}

function extractExports(content: string): string[] {
  const exports: string[] = []
  const pattern = /export\s+(?:(?:default\s+)?(?:class|function|const|let|var|type|interface|enum)\s+(\w+)|{([^}]+)})/g
  let m: RegExpExecArray | null
  while ((m = pattern.exec(content)) !== null) {
    if (m[1]) exports.push(m[1])
    if (m[2]) {
      for (const name of m[2].split(",")) {
        const trimmed = name.trim().split(" as ")[0].trim()
        if (trimmed) exports.push(trimmed)
      }
    }
  }
  return exports
}

function toMermaid(modules: Module[], maxNodes: number): string {
  const lines = ["```mermaid", "graph TD"]
  const nodeIds = new Map<string, string>()
  let nodeCounter = 0

  const topModules = modules
    .sort((a, b) => b.imports.length - a.imports.length)
    .slice(0, maxNodes)

  const fileSet = new Set(topModules.map((m) => m.file))

  for (const m of topModules) {
    const id = `N${nodeCounter++}`
    nodeIds.set(m.file, id)
    const label = path.basename(m.file, path.extname(m.file))
    const shape = m.isEntry ? `[["${label}"]]` : `["${label}"]`
    lines.push(`  ${id}${shape}`)
  }

  const edgesAdded = new Set<string>()
  for (const m of topModules) {
    const fromId = nodeIds.get(m.file)
    if (!fromId) continue
    for (const imp of m.imports) {
      const candidates = [imp, imp + ".ts", imp + ".js", imp + "/index.ts", imp + "/index.js"]
      for (const c of candidates) {
        if (fileSet.has(c)) {
          const toId = nodeIds.get(c)
          if (toId) {
            const edge = `${fromId}->${toId}`
            if (!edgesAdded.has(edge)) {
              edgesAdded.add(edge)
              lines.push(`  ${fromId} --> ${toId}`)
            }
          }
        }
      }
    }
  }

  lines.push("```")
  return lines.join("\n")
}

function toPlantUML(modules: Module[], maxNodes: number): string {
  const lines = ["@startuml", "!theme plain", "skinparam packageStyle rectangle"]
  const topModules = modules.slice(0, maxNodes)
  const fileSet = new Set(topModules.map((m) => m.file))

  for (const m of topModules) {
    const name = path.basename(m.file, path.extname(m.file))
    lines.push(`rectangle "${name}" as ${name.replace(/[^a-zA-Z0-9]/g, "_")}`)
  }

  for (const m of topModules) {
    const fromName = path.basename(m.file, path.extname(m.file)).replace(/[^a-zA-Z0-9]/g, "_")
    for (const imp of m.imports) {
      const candidates = [imp, imp + ".ts", imp + "/index.ts"]
      for (const c of candidates) {
        if (fileSet.has(c)) {
          const toName = path.basename(c, path.extname(c)).replace(/[^a-zA-Z0-9]/g, "_")
          lines.push(`${fromName} --> ${toName}`)
        }
      }
    }
  }

  lines.push("@enduml")
  return lines.join("\n")
}

const parameters = z.object({
  directory: z.string().optional().describe("Directory to analyze (default: current project root)"),
  format: z.enum(["mermaid", "plantuml"]).default("mermaid").describe("Output format (default: mermaid)"),
  max_nodes: z.number().default(30).describe("Maximum number of modules to include in diagram (default: 30)"),
  extensions: z.array(z.string()).optional().describe("File extensions to analyze (default: ['.ts', '.js', '.tsx', '.jsx'])"),
  focus: z.string().optional().describe("Focus on a specific subdirectory or module name pattern"),
})

export const ArchDiagramTool = Tool.define<typeof parameters, Meta>("arch-diagram", {
  description: DESCRIPTION,
  parameters,
  async execute(params, _ctx) {
    const root = params.directory
      ? path.isAbsolute(params.directory) ? params.directory : path.join(Instance.directory ?? process.cwd(), params.directory)
      : Instance.directory ?? process.cwd()

    const exts = params.extensions ?? [".ts", ".js", ".tsx", ".jsx"]

    let modules = await analyzeImports(root, exts)

    if (params.focus) {
      modules = modules.filter(
        (m) => m.file.includes(params.focus!) || m.imports.some((i) => i.includes(params.focus!)),
      )
    }

    if (modules.length === 0) {
      return {
        output: `No modules found in ${root} with extensions: ${exts.join(", ")}`,
        title: "Arch Diagram: no files found",
        metadata: {} as Meta,
      }
    }

    const maxNodes = Math.min(params.max_nodes, 50)
    const diagram = params.format === "plantuml" ? toPlantUML(modules, maxNodes) : toMermaid(modules, maxNodes)

    // Find circular dependencies
    const circularDeps: string[] = []
    const fileSet = new Set(modules.map((m) => m.file))
    for (const m of modules) {
      for (const imp of m.imports) {
        const candidates = [imp, imp + ".ts", imp + "/index.ts"]
        for (const c of candidates) {
          if (fileSet.has(c)) {
            const other = modules.find((x) => x.file === c)
            if (other?.imports.some((i) => [m.file, m.file.replace(".ts", ""), m.file.replace("/index.ts", "")].some((f) => i.includes(f)))) {
              circularDeps.push(`${m.file} ↔ ${c}`)
            }
          }
        }
      }
    }

    const lines = [
      `# Architecture Diagram`,
      ``,
      `**Directory:** ${root}`,
      `**Modules analyzed:** ${modules.length} | **Shown:** ${Math.min(modules.length, maxNodes)}`,
      `**Format:** ${params.format}`,
      ``,
      diagram,
    ]

    if (circularDeps.length > 0) {
      lines.push(``, `## ⚠️ Circular Dependencies Detected`, ``)
      for (const cd of [...new Set(circularDeps)].slice(0, 10)) {
        lines.push(`- ${cd}`)
      }
    }

    const topImported = [...new Map(modules.map((m) => [m.file, modules.filter((x) => x.imports.some((i) => i.includes(m.file.replace(".ts", "")))).length]))].sort((a, b) => b[1] - a[1]).slice(0, 5)
    if (topImported.length > 0) {
      lines.push(``, `## Most Imported Modules`)
      for (const [file, count] of topImported) {
        lines.push(`- \`${file}\` — imported by ${count} modules`)
      }
    }

    return {
      output: lines.join("\n"),
      title: `Arch Diagram: ${path.basename(root)}`,
      metadata: {
        moduleCount: modules.length,
        circularDeps: circularDeps.length,
        format: params.format,
      } as Meta,
    }
  },
})
