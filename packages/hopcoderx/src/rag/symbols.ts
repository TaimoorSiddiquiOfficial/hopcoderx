import path from "path"

const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript",
  ".mts": "typescript", ".mjs": "javascript", ".cts": "typescript", ".cjs": "javascript",
  ".py": "python", ".rs": "rust", ".go": "go", ".java": "java",
  ".rb": "ruby", ".php": "php", ".c": "c", ".h": "c", ".cpp": "cpp",
  ".hpp": "cpp", ".cc": "cpp", ".cs": "csharp", ".swift": "swift",
  ".kt": "kotlin", ".kts": "kotlin", ".scala": "scala", ".hs": "haskell",
  ".ml": "ocaml", ".mli": "ocaml", ".ex": "elixir", ".exs": "elixir",
  ".sh": "bash", ".bash": "bash", ".zsh": "bash", ".lua": "lua",
  ".r": "r", ".R": "r", ".jl": "julia", ".clj": "clojure",
  ".nix": "nix", ".zig": "zig", ".v": "v", ".dart": "dart",
}

interface Pattern {
  re: RegExp
  kind: string
  group: number
  signature?: boolean
}

const PATTERNS: Record<string, Pattern[]> = {
  typescript: [
    { re: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m, kind: "function", group: 1, signature: true },
    { re: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/m, kind: "class", group: 1, signature: true },
    { re: /^(?:export\s+)?interface\s+(\w+)/m, kind: "interface", group: 1, signature: true },
    { re: /^(?:export\s+)?type\s+(\w+)/m, kind: "type", group: 1, signature: true },
    { re: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/m, kind: "variable", group: 1 },
    { re: /^(?:export\s+)?enum\s+(\w+)/m, kind: "enum", group: 1 },
    { re: /^(?:export\s+)?namespace\s+(\w+)/m, kind: "namespace", group: 1 },
    { re: /^\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/m, kind: "method", group: 1, signature: true },
  ],
  python: [
    { re: /^(?:async\s+)?def\s+(\w+)/m, kind: "function", group: 1, signature: true },
    { re: /^class\s+(\w+)/m, kind: "class", group: 1, signature: true },
  ],
  rust: [
    { re: /^(?:pub(?:\(.*?\))?\s+)?(?:async\s+)?fn\s+(\w+)/m, kind: "function", group: 1, signature: true },
    { re: /^(?:pub(?:\(.*?\))?\s+)?struct\s+(\w+)/m, kind: "struct", group: 1, signature: true },
    { re: /^(?:pub(?:\(.*?\))?\s+)?enum\s+(\w+)/m, kind: "enum", group: 1, signature: true },
    { re: /^(?:pub(?:\(.*?\))?\s+)?trait\s+(\w+)/m, kind: "trait", group: 1, signature: true },
    { re: /^(?:pub(?:\(.*?\))?\s+)?impl(?:<[^>]*>)?\s+(\w+)/m, kind: "impl", group: 1 },
    { re: /^(?:pub(?:\(.*?\))?\s+)?mod\s+(\w+)/m, kind: "module", group: 1 },
  ],
  go: [
    { re: /^func\s+(?:\(.*?\)\s+)?(\w+)/m, kind: "function", group: 1, signature: true },
    { re: /^type\s+(\w+)\s+struct/m, kind: "struct", group: 1, signature: true },
    { re: /^type\s+(\w+)\s+interface/m, kind: "interface", group: 1, signature: true },
    { re: /^type\s+(\w+)/m, kind: "type", group: 1 },
  ],
  java: [
    { re: /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:abstract\s+)?class\s+(\w+)/m, kind: "class", group: 1, signature: true },
    { re: /^\s*(?:public|private|protected)?\s*(?:static\s+)?\w+(?:<[^>]*>)?\s+(\w+)\s*\(/m, kind: "method", group: 1, signature: true },
    { re: /^\s*(?:public|private|protected)?\s*interface\s+(\w+)/m, kind: "interface", group: 1, signature: true },
    { re: /^\s*(?:public|private|protected)?\s*enum\s+(\w+)/m, kind: "enum", group: 1 },
  ],
  ruby: [
    { re: /^\s*def\s+(\w+)/m, kind: "method", group: 1, signature: true },
    { re: /^\s*class\s+(\w+)/m, kind: "class", group: 1, signature: true },
    { re: /^\s*module\s+(\w+)/m, kind: "module", group: 1 },
  ],
  php: [
    { re: /^\s*(?:public|private|protected)?\s*function\s+(\w+)/m, kind: "function", group: 1, signature: true },
    { re: /^\s*(?:abstract\s+)?class\s+(\w+)/m, kind: "class", group: 1, signature: true },
    { re: /^\s*interface\s+(\w+)/m, kind: "interface", group: 1, signature: true },
  ],
  c: [
    { re: /^(?:static\s+)?(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*\{/m, kind: "function", group: 1, signature: true },
    { re: /^typedef\s+struct\s+(\w+)/m, kind: "struct", group: 1 },
    { re: /^struct\s+(\w+)/m, kind: "struct", group: 1 },
  ],
  cpp: [
    { re: /^(?:static\s+)?(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*(?:const\s*)?(?:override\s*)?\{/m, kind: "function", group: 1, signature: true },
    { re: /^(?:template\s*<[^>]*>\s*)?class\s+(\w+)/m, kind: "class", group: 1, signature: true },
    { re: /^struct\s+(\w+)/m, kind: "struct", group: 1 },
    { re: /^namespace\s+(\w+)/m, kind: "namespace", group: 1 },
  ],
  csharp: [
    { re: /^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?(?:abstract\s+)?class\s+(\w+)/m, kind: "class", group: 1, signature: true },
    { re: /^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?\w+\s+(\w+)\s*\(/m, kind: "method", group: 1, signature: true },
    { re: /^\s*interface\s+(\w+)/m, kind: "interface", group: 1, signature: true },
  ],
  swift: [
    { re: /^\s*(?:public|private|internal|open)?\s*(?:static\s+)?func\s+(\w+)/m, kind: "function", group: 1, signature: true },
    { re: /^\s*(?:public|private|internal|open)?\s*class\s+(\w+)/m, kind: "class", group: 1, signature: true },
    { re: /^\s*(?:public|private|internal|open)?\s*struct\s+(\w+)/m, kind: "struct", group: 1, signature: true },
    { re: /^\s*(?:public|private|internal|open)?\s*protocol\s+(\w+)/m, kind: "protocol", group: 1, signature: true },
    { re: /^\s*(?:public|private|internal|open)?\s*enum\s+(\w+)/m, kind: "enum", group: 1 },
  ],
  bash: [
    { re: /^(?:function\s+)?(\w+)\s*\(\)/m, kind: "function", group: 1 },
  ],
  lua: [
    { re: /^(?:local\s+)?function\s+([\w.]+)/m, kind: "function", group: 1 },
  ],
}
PATTERNS.javascript = PATTERNS.typescript
PATTERNS.kotlin = PATTERNS.java

const IMPORT_PATTERNS: Record<string, RegExp[]> = {
  typescript: [
    /^\s*import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*]+)?\s*(?:,\s*\{[^}]*\})?\s*from\s+["']([^"']+)["']/m,
    /^\s*(?:const|let|var)\s+\w+\s*=\s*require\s*\(["']([^"']+)["']\)/m,
  ],
  python: [
    /^\s*(?:from\s+([\w.]+)\s+)?import\s+/m,
  ],
  rust: [
    /^\s*use\s+([\w:]+)/m,
  ],
  go: [
    /^\s*import\s+(?:\(\s*)?"([^"]+)"/m,
  ],
  java: [
    /^\s*import\s+(?:static\s+)?([\w.]+)/m,
  ],
  ruby: [
    /^\s*require\s+["']([^"']+)["']/m,
  ],
}
IMPORT_PATTERNS.javascript = IMPORT_PATTERNS.typescript

export namespace Symbols {
  export interface Symbol {
    filepath: string
    name: string
    kind: string
    start_line: number
    end_line: number
    parent?: string
    signature?: string
  }

  export interface Edge {
    source_filepath: string
    source_symbol: string
    target_symbol: string
    kind: string
  }

  export function language(filepath: string) {
    return LANGUAGE_MAP[path.extname(filepath)]
  }

  export function extract(filepath: string, content: string) {
    const lang = language(filepath)
    if (!lang) return { symbols: [] as Symbol[], edges: [] as Edge[] }

    const lines = content.split("\n")
    const patterns = PATTERNS[lang] ?? []
    const imports = IMPORT_PATTERNS[lang] ?? []

    const syms: Symbol[] = []
    const eds: Edge[] = []
    const stack: { name: string; indent: number; brace: number }[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const indent = line.search(/\S/)
      if (indent < 0) continue

      for (const pat of patterns) {
        const match = line.match(pat.re)
        if (!match) continue
        const name = match[pat.group]
        if (!name || name.length < 2) continue

        // find end of symbol by tracking braces or indent
        const end = findEnd(lines, i, lang)
        const parent = stack.length ? stack[stack.length - 1].name : undefined

        syms.push({
          filepath,
          name,
          kind: pat.kind,
          start_line: i + 1,
          end_line: end + 1,
          parent,
          signature: pat.signature ? line.trim() : undefined,
        })

        if (pat.kind === "class" || pat.kind === "namespace" || pat.kind === "module" || pat.kind === "impl") {
          stack.push({ name, indent, brace: braceCount(lines, i) })
        }
        break
      }

      // pop stack when indent or braces close
      while (stack.length) {
        const top = stack[stack.length - 1]
        if (indent <= top.indent && i > 0) stack.pop()
        else break
      }

      // extract imports as edges
      for (const re of imports) {
        const match = line.match(re)
        if (!match) continue
        const target = match[1]
        if (!target) continue
        eds.push({
          source_filepath: filepath,
          source_symbol: path.basename(filepath, path.extname(filepath)),
          target_symbol: target,
          kind: "imports",
        })
      }
    }

    return { symbols: syms, edges: eds }
  }
}

function findEnd(lines: string[], start: number, lang: string): number {
  const brace = ["typescript", "javascript", "rust", "go", "java", "c", "cpp", "csharp", "swift", "php", "kotlin"]
  if (brace.includes(lang)) return findBraceEnd(lines, start)
  if (lang === "python") return findIndentEnd(lines, start)
  if (lang === "ruby" || lang === "lua") return findKeywordEnd(lines, start, /^\s*end\b/)
  return Math.min(start + 30, lines.length - 1)
}

function findBraceEnd(lines: string[], start: number): number {
  let depth = 0
  let found = false
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { depth++; found = true }
      if (ch === "}") depth--
      if (found && depth <= 0) return i
    }
  }
  return Math.min(start + 50, lines.length - 1)
}

function findIndentEnd(lines: string[], start: number): number {
  const base = lines[start].search(/\S/)
  for (let i = start + 1; i < lines.length; i++) {
    const indent = lines[i].search(/\S/)
    if (indent < 0) continue
    if (indent <= base) return i - 1
  }
  return lines.length - 1
}

function findKeywordEnd(lines: string[], start: number, re: RegExp): number {
  for (let i = start + 1; i < lines.length; i++) {
    if (re.test(lines[i])) return i
  }
  return Math.min(start + 50, lines.length - 1)
}

function braceCount(lines: string[], line: number): number {
  let count = 0
  for (const ch of lines[line]) {
    if (ch === "{") count++
    if (ch === "}") count--
  }
  return count
}
