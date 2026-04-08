/**
 * Symbol Graph — tracks cross-file references and import relationships.
 * Enhances RAG with context about how symbols relate across the codebase.
 */
import path from "path"
import { Filesystem } from "../util/filesystem"
import { Symbols } from "./symbols"
import { Log } from "../util/log"
import { existsSync, statSync } from "fs"

const log = Log.create({ service: "rag.symbol-graph" })

export namespace SymbolGraph {
  export interface Node {
    id: string            // "filepath:symbolName"
    filepath: string
    name: string
    kind: string
    start_line: number
    end_line: number
    exported: boolean
  }

  export interface Edge {
    from: string          // source node id
    to: string            // target node id (may be unresolved: "unknown:symbolName")
    kind: "import" | "call" | "extends" | "implements" | "type-ref"
  }

  export interface Graph {
    nodes: Map<string, Node>
    edges: Edge[]
    /** Map from symbol name → list of node ids that define it */
    byName: Map<string, string[]>
  }

  /** Build a symbol graph for the given file list */
  export async function build(files: string[]): Promise<Graph> {
    const graph: Graph = {
      nodes: new Map(),
      edges: [],
      byName: new Map(),
    }

    for (const filepath of files) {
      if (!existsSync(filepath)) continue
      try {
        const content = await Filesystem.readText(filepath)
        ingestFile(graph, filepath, content)
      } catch {
        // skip unreadable files
      }
    }

    // Second pass: resolve cross-file references
    resolveEdges(graph)

    log.info("symbol graph built", { nodes: graph.nodes.size, edges: graph.edges.length })
    return graph
  }

  function ingestFile(graph: Graph, filepath: string, content: string): void {
    const { symbols } = Symbols.extract(filepath, content)
    const lines = content.split("\n")

    // Register nodes
    for (const sym of symbols) {
      const id = `${filepath}:${sym.name}`
      const exported = sym.signature?.startsWith("export") ?? false
      const node: Node = {
        id,
        filepath,
        name: sym.name,
        kind: sym.kind,
        start_line: sym.start_line,
        end_line: sym.end_line,
        exported,
      }
      graph.nodes.set(id, node)

      const existing = graph.byName.get(sym.name) ?? []
      existing.push(id)
      graph.byName.set(sym.name, existing)
    }

    // Extract import edges
    const importEdges = extractImports(filepath, lines)
    graph.edges.push(...importEdges)

    // Extract call/type-ref edges (simple heuristic)
    const refEdges = extractReferences(filepath, symbols, lines)
    graph.edges.push(...refEdges)
  }

  function extractImports(filepath: string, lines: string[]): Edge[] {
    const edges: Edge[] = []
    const dir = path.dirname(filepath)

    // Patterns: import { X } from "./foo", import X from "./foo", require("./foo")
    const importRe = /(?:import\s+.*?from\s+|require\s*\(\s*)["'](\.\.?\/[^"']+)["']/g

    for (const line of lines) {
      let m: RegExpExecArray | null
      importRe.lastIndex = 0
      while ((m = importRe.exec(line)) !== null) {
        const importPath = m[1]!
        // Resolve to absolute
        let resolved = path.resolve(dir, importPath)
        // Try common extensions
        if (!existsSync(resolved)) {
          for (const ext of [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js"]) {
            if (existsSync(resolved + ext)) {
              resolved = resolved + ext
              break
            }
          }
        }
        edges.push({
          from: filepath + ":*",  // file-level import
          to: resolved + ":*",
          kind: "import",
        })
      }
    }

    return edges
  }

  function extractReferences(filepath: string, symbols: Symbols.Symbol[], lines: string[]): Edge[] {
    const edges: Edge[] = []
    const content = lines.join("\n")

    for (const sym of symbols) {
      const symLines = lines.slice(sym.start_line - 1, sym.end_line)
      const symContent = symLines.join("\n")

      // extends/implements
      const extendsM = symContent.match(/(?:extends|implements)\s+(\w+)/)
      if (extendsM) {
        edges.push({
          from: `${filepath}:${sym.name}`,
          to: `unknown:${extendsM[1]}`,
          kind: sym.kind === "class" ? "extends" : "implements",
        })
      }

      // Function calls (heuristic — capital letter identifiers likely type refs)
      const typeRefs = symContent.matchAll(/(?::\s*|<\s*|,\s*)([A-Z]\w+)/g)
      for (const ref of typeRefs) {
        const refName = ref[1]!
        if (refName !== sym.name) {
          edges.push({
            from: `${filepath}:${sym.name}`,
            to: `unknown:${refName}`,
            kind: "type-ref",
          })
        }
      }
    }

    return edges
  }

  function resolveEdges(graph: Graph): void {
    for (const edge of graph.edges) {
      if (edge.to.startsWith("unknown:")) {
        const symbolName = edge.to.slice("unknown:".length)
        const candidates = graph.byName.get(symbolName)
        if (candidates && candidates.length === 1) {
          edge.to = candidates[0]!
        }
      }
    }
  }

  /** Get all nodes that reference a given node */
  export function referencedBy(graph: Graph, nodeId: string): Node[] {
    const refs = graph.edges
      .filter((e) => e.to === nodeId)
      .map((e) => graph.nodes.get(e.from))
      .filter(Boolean) as Node[]
    return refs
  }

  /** Get all nodes that a given node references */
  export function references(graph: Graph, nodeId: string): Node[] {
    const refs = graph.edges
      .filter((e) => e.from === nodeId)
      .map((e) => graph.nodes.get(e.to))
      .filter(Boolean) as Node[]
    return refs
  }

  /** Get the import tree for a file */
  export function importTree(graph: Graph, filepath: string, depth = 2): Map<string, number> {
    const result = new Map<string, number>()
    const visited = new Set<string>()

    function visit(fp: string, d: number): void {
      if (d <= 0 || visited.has(fp)) return
      visited.add(fp)
      const imports = graph.edges.filter((e) => e.from === fp + ":*" && e.kind === "import")
      for (const imp of imports) {
        const targetFile = imp.to.replace(":*", "")
        result.set(targetFile, d)
        visit(targetFile, d - 1)
      }
    }

    visit(filepath, depth)
    return result
  }

  /** Serialize graph to a compact JSON string for storage */
  export function serialize(graph: Graph): string {
    return JSON.stringify({
      nodes: Array.from(graph.nodes.values()),
      edges: graph.edges,
    })
  }

  /** Deserialize from stored JSON */
  export function deserialize(json: string): Graph {
    const data = JSON.parse(json)
    const graph: Graph = { nodes: new Map(), edges: data.edges, byName: new Map() }
    for (const node of data.nodes as Node[]) {
      graph.nodes.set(node.id, node)
      const existing = graph.byName.get(node.name) ?? []
      existing.push(node.id)
      graph.byName.set(node.name, existing)
    }
    return graph
  }
}
