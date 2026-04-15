/**
 * Snippet Expansion System
 *
 * Text expansion for common coding patterns, templates, and boilerplate.
 * Similar to VS Code snippets but with AI-enhanced context awareness.
 *
 * Usage:
 *   const snippet = await SnippetExpansion.expand("react-fc", { name: "MyComponent" })
 *   const suggestions = await SnippetExpansion.suggest("func")
 */

import { Log } from "@/util/log"
import { readFile, readdir } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { Global } from "@/global"

const log = Log.create({ service: "skills.snippets" })

export namespace SnippetExpansion {
  export interface Snippet {
    /** Unique snippet ID */
    id: string
    /** Trigger prefix (what you type to activate) */
    prefix: string
    /** Human-readable description */
    description: string
    /** Snippet body template */
    body: string | string[]
    /** Variable placeholders */
    variables: SnippetVariable[]
    /** Language scope (e.g., "typescript", "python") */
    scope: string[]
    /** Tags for search */
    tags: string[]
    /** Source: builtin or custom */
    source: "builtin" | "custom" | "project"
  }

  export interface SnippetVariable {
    /** Variable name (e.g., "name", "props") */
    name: string
    /** Default value */
    default?: string
    /** Variable description */
    description?: string
  }

  export interface ExpansionResult {
    /** Expanded snippet text */
    text: string
    /** Variables that need user input */
    pendingVariables: string[]
    /** Cursor position after expansion */
    cursorPosition?: number
  }

  // ─── Built-in Snippets ──────────────────────────────────────────────────────

  const BUILTIN_SNIPPETS: Snippet[] = [
    // React snippets
    {
      id: "react-fc",
      prefix: "rfc",
      description: "React Functional Component",
      body: [
        "export function ${name}(${props}): JSX.Element {",
        "  return (",
        "    <div>",
        "      ${1}",
        "    </div>",
        "  )",
        "}",
      ],
      variables: [
        { name: "name", default: "Component", description: "Component name" },
        { name: "props", default: "", description: "Props destructuring" },
      ],
      scope: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
      tags: ["react", "component", "functional"],
      source: "builtin",
    },
    {
      id: "react-hook",
      prefix: "rhook",
      description: "Custom React Hook",
      body: [
        "export function use${name}(${params}): ${returnType} {",
        "  ${1}",
        "  return ${result}",
        "}",
      ],
      variables: [
        { name: "name", default: "Something", description: "Hook name (without use prefix)" },
        { name: "params", default: "", description: "Hook parameters" },
        { name: "returnType", default: "unknown", description: "Return type" },
        { name: "result", default: "", description: "Return value" },
      ],
      scope: ["typescript", "typescriptreact"],
      tags: ["react", "hook", "custom"],
      source: "builtin",
    },
    {
      id: "react-useeffect",
      prefix: "rue",
      description: "React useEffect Hook",
      body: [
        "useEffect(() => {",
        "  ${1}",
        "  return () => {",
        "    ${cleanup}",
        "  }",
        "}, [${dependencies}])",
      ],
      variables: [
        { name: "dependencies", default: "", description: "Dependency array" },
        { name: "cleanup", default: "", description: "Cleanup function" },
      ],
      scope: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
      tags: ["react", "useeffect", "hook"],
      source: "builtin",
    },
    {
      id: "react-usestate",
      prefix: "rus",
      description: "React useState Hook",
      body: [
        "const [${state}, set${capitalizeState}] = useState<${type}>(${initial})",
      ],
      variables: [
        { name: "state", default: "count", description: "State variable name" },
        { name: "type", default: "number", description: "State type" },
        { name: "initial", default: "0", description: "Initial value" },
      ],
      scope: ["typescript", "typescriptreact"],
      tags: ["react", "usestate", "hook"],
      source: "builtin",
    },
    {
      id: "nextjs-page",
      prefix: "npage",
      description: "Next.js Page Component",
      body: [
        "import type { NextPage } from 'next'",
        "",
        "interface Props {",
        "  ${prop}",
        "}",
        "",
        "const ${name}: NextPage<Props> = ({ ${prop} }) => {",
        "  return (",
        "    <div>",
        "      ${1}",
        "    </div>",
        "  )",
        "}",
        "",
        "export default ${name}",
      ],
      variables: [
        { name: "name", default: "Page", description: "Page component name" },
        { name: "prop", default: "", description: "Props" },
      ],
      scope: ["typescript", "typescriptreact"],
      tags: ["nextjs", "page", "react"],
      source: "builtin",
    },
    {
      id: "nextjs-api",
      prefix: "napi",
      description: "Next.js API Route",
      body: [
        "import type { NextApiRequest, NextApiResponse } from 'next'",
        "",
        "export default function handler(req: NextApiRequest, res: NextApiResponse) {",
        "  ${1}",
        "  res.status(200).json({ data: 'ok' })",
        "}",
      ],
      variables: [],
      scope: ["typescript", "typescriptreact"],
      tags: ["nextjs", "api", "route"],
      source: "builtin",
    },
    // Express snippets
    {
      id: "express-route",
      prefix: "exroute",
      description: "Express Route Handler",
      body: [
        "app.${method}('${path}', async (req, res) => {",
        "  try {",
        "    ${1}",
        "    res.json({ data: 'ok' })",
        "  } catch (error) {",
        "    res.status(500).json({ error: 'Internal server error' })",
        "  }",
        "})",
      ],
      variables: [
        { name: "method", default: "get", description: "HTTP method" },
        { name: "path", default: "/api/endpoint", description: "Route path" },
      ],
      scope: ["typescript", "javascript"],
      tags: ["express", "route", "api"],
      source: "builtin",
    },
    {
      id: "express-middleware",
      prefix: "exmw",
      description: "Express Middleware",
      body: [
        "export function ${name}(req, res, next) {",
        "  ${1}",
        "  next()",
        "}",
      ],
      variables: [
        { name: "name", default: "myMiddleware", description: "Middleware name" },
      ],
      scope: ["typescript", "javascript"],
      tags: ["express", "middleware"],
      source: "builtin",
    },
    // TypeScript snippets
    {
      id: "ts-interface",
      prefix: "tsif",
      description: "TypeScript Interface",
      body: [
        "export interface ${name} {",
        "  ${prop}: ${type}",
        "}",
      ],
      variables: [
        { name: "name", default: "MyInterface", description: "Interface name" },
        { name: "prop", default: "id", description: "Property name" },
        { name: "type", default: "string", description: "Property type" },
      ],
      scope: ["typescript", "typescriptreact"],
      tags: ["typescript", "interface", "type"],
      source: "builtin",
    },
    {
      id: "ts-type",
      prefix: "tstype",
      description: "TypeScript Type Alias",
      body: [
        "export type ${name} = ${definition}",
      ],
      variables: [
        { name: "name", default: "MyType", description: "Type name" },
        { name: "definition", default: "string | number", description: "Type definition" },
      ],
      scope: ["typescript", "typescriptreact"],
      tags: ["typescript", "type", "alias"],
      source: "builtin",
    },
    {
      id: "ts-enum",
      prefix: "tsenum",
      description: "TypeScript Enum",
      body: [
        "export enum ${name} {",
        "  ${member} = '${value}',",
        "}",
      ],
      variables: [
        { name: "name", default: "MyEnum", description: "Enum name" },
        { name: "member", default: "Option1", description: "Enum member" },
        { name: "value", default: "option1", description: "Enum value" },
      ],
      scope: ["typescript", "typescriptreact"],
      tags: ["typescript", "enum"],
      source: "builtin",
    },
    // General snippets
    {
      id: "function",
      prefix: "func",
      description: "Function Declaration",
      body: [
        "export function ${name}(${params}): ${returnType} {",
        "  ${1}",
        "}",
      ],
      variables: [
        { name: "name", default: "myFunction", description: "Function name" },
        { name: "params", default: "", description: "Parameters" },
        { name: "returnType", default: "void", description: "Return type" },
      ],
      scope: ["typescript", "javascript"],
      tags: ["function", "export"],
      source: "builtin",
    },
    {
      id: "async-function",
      prefix: "async",
      description: "Async Function",
      body: [
        "export async function ${name}(${params}): Promise<${returnType}> {",
        "  ${1}",
        "}",
      ],
      variables: [
        { name: "name", default: "myFunction", description: "Function name" },
        { name: "params", default: "", description: "Parameters" },
        { name: "returnType", default: "void", description: "Return type" },
      ],
      scope: ["typescript", "javascript"],
      tags: ["async", "function", "promise"],
      source: "builtin",
    },
    {
      id: "class",
      prefix: "class",
      description: "Class Declaration",
      body: [
        "export class ${name} {",
        "  constructor(${params}) {",
        "    ${1}",
        "  }",
        "}",
      ],
      variables: [
        { name: "name", default: "MyClass", description: "Class name" },
        { name: "params", default: "", description: "Constructor parameters" },
      ],
      scope: ["typescript", "javascript"],
      tags: ["class", "oop"],
      source: "builtin",
    },
    {
      id: "try-catch",
      prefix: "try",
      description: "Try-Catch Block",
      body: [
        "try {",
        "  ${1}",
        "} catch (error) {",
        "  console.error('${context} error:', error)",
        "  throw error",
        "}",
      ],
      variables: [
        { name: "context", default: "operation", description: "Operation context" },
      ],
      scope: ["typescript", "javascript"],
      tags: ["error", "try", "catch"],
      source: "builtin",
    },
    {
      id: "console-log",
      prefix: "log",
      description: "Console Log",
      body: [
        "console.log('${label}:', ${value})",
      ],
      variables: [
        { name: "label", default: "debug", description: "Log label" },
        { name: "value", default: "data", description: "Value to log" },
      ],
      scope: ["typescript", "javascript", "python"],
      tags: ["debug", "log", "console"],
      source: "builtin",
    },
    // Python snippets
    {
      id: "python-function",
      prefix: "pfunc",
      description: "Python Function",
      body: [
        "def ${name}(${params}):",
        "    \"\"\"${docstring}\"\"\"",
        "    ${1}",
        "    return ${result}",
      ],
      variables: [
        { name: "name", default: "my_function", description: "Function name" },
        { name: "params", default: "", description: "Parameters" },
        { name: "docstring", default: "Function description", description: "Docstring" },
        { name: "result", default: "None", description: "Return value" },
      ],
      scope: ["python"],
      tags: ["python", "function"],
      source: "builtin",
    },
    {
      id: "python-class",
      prefix: "pclass",
      description: "Python Class",
      body: [
        "class ${name}:",
        "    \"\"\"${docstring}\"\"\"",
        "    ",
        "    def __init__(self, ${params}):",
        "        ${1}",
        "    ",
        "    def ${method}(self):",
        "        pass",
      ],
      variables: [
        { name: "name", default: "MyClass", description: "Class name" },
        { name: "params", default: "", description: "Init parameters" },
        { name: "docstring", default: "Class description", description: "Docstring" },
        { name: "method", default: "do_something", description: "Method name" },
      ],
      scope: ["python"],
      tags: ["python", "class"],
      source: "builtin",
    },
  ]

  // ─── API ─────────────────────────────────────────────────────────────────────

  /**
   * Expand a snippet by its ID or prefix
   */
  export function expand(
    identifier: string,
    variables?: Record<string, string>,
    language?: string,
  ): ExpansionResult {
    const snippet = find(identifier, language)
    if (!snippet) {
      throw new Error(`Snippet not found: ${identifier}`)
    }

    const body = Array.isArray(snippet.body) ? snippet.body.join("\n") : snippet.body
    const pendingVariables: string[] = []
    let expanded = body

    // Replace variables
    for (const variable of snippet.variables) {
      const value = variables?.[variable.name] ?? variable.default ?? `\${${variable.name}}`
      if (value.startsWith("${") || value === "") {
        pendingVariables.push(variable.name)
      }
      expanded = expanded.replace(new RegExp(`\\$\\{${variable.name}\\}`, "g"), value)
    }

    // Handle cursor position markers
    let cursorPosition: number | undefined
    const cursorMatch = expanded.match(/\$(\d+)/)
    if (cursorMatch) {
      cursorPosition = cursorMatch.index
      expanded = expanded.replace(/\$\d+/g, "")
    }

    return {
      text: expanded,
      pendingVariables,
      cursorPosition,
    }
  }

  /**
   * Find a snippet by ID or prefix
   */
  export function find(identifier: string, language?: string): Snippet | null {
    // Search built-in snippets
    for (const snippet of BUILTIN_SNIPPETS) {
      if (snippet.id === identifier || snippet.prefix === identifier) {
        if (language && !snippet.scope.includes(language)) {
          continue
        }
        return snippet
      }
    }

    // Search custom snippets
    const customSnippets = getCustomSnippets()
    for (const snippet of customSnippets) {
      if (snippet.id === identifier || snippet.prefix === identifier) {
        if (language && !snippet.scope.includes(language)) {
          continue
        }
        return snippet
      }
    }

    return null
  }

  /**
   * Suggest snippets based on a search query
   */
  export function suggest(query: string, language?: string): Snippet[] {
    const allSnippets = [...BUILTIN_SNIPPETS, ...getCustomSnippets()]
    const queryLower = query.toLowerCase()

    return allSnippets.filter((snippet) => {
      if (language && !snippet.scope.includes(language)) {
        return false
      }

      // Match against prefix, description, tags, or id
      return (
        snippet.prefix.toLowerCase().includes(queryLower) ||
        snippet.description.toLowerCase().includes(queryLower) ||
        snippet.tags.some((tag) => tag.toLowerCase().includes(queryLower)) ||
        snippet.id.toLowerCase().includes(queryLower)
      )
    }).slice(0, 10)
  }

  /**
   * Get all available snippets
   */
  export function all(language?: string): Snippet[] {
    const allSnippets = [...BUILTIN_SNIPPETS, ...getCustomSnippets()]
    if (!language) return allSnippets
    return allSnippets.filter((snippet) => snippet.scope.includes(language))
  }

  /**
   * Get custom snippets from user config
   */
  export function getCustomSnippets(): Snippet[] {
    const snippetsDir = join(Global.Path.config, "snippets")
    if (!existsSync(snippetsDir)) return []

    const snippets: Snippet[] = []

    try {
      // Load snippets from JSON files
      for (const file of readdirSync(snippetsDir)) {
        if (file.endsWith(".json")) {
          const filePath = join(snippetsDir, file)
          const content = JSON.parse(readFile(filePath, "utf8"))

          if (Array.isArray(content)) {
            for (const snippet of content) {
              snippets.push({
                ...snippet,
                source: "custom",
              })
            }
          }
        }
      }
    } catch (err) {
      log.error("failed to load custom snippets", { error: err })
    }

    return snippets
  }

  /**
   * Save a custom snippet
   */
  export async function saveCustom(snippet: Omit<Snippet, "source">): Promise<void> {
    const snippetsDir = join(Global.Path.config, "snippets")
    const snippetsFile = join(snippetsDir, "custom.json")

    // Ensure directory exists
    await Global.Path.config // Initialize if needed
    const { mkdir } = await import("fs/promises")
    await mkdir(snippetsDir, { recursive: true })

    // Load existing snippets
    let existing: Snippet[] = []
    if (existsSync(snippetsFile)) {
      const { readFile } = await import("fs/promises")
      existing = JSON.parse(await readFile(snippetsFile, "utf8"))
    }

    // Add or update snippet
    const index = existing.findIndex((s) => s.id === snippet.id)
    if (index >= 0) {
      existing[index] = { ...snippet, source: "custom" }
    } else {
      existing.push({ ...snippet, source: "custom" })
    }

    // Save
    const { writeFile } = await import("fs/promises")
    await writeFile(snippetsFile, JSON.stringify(existing, null, 2))

    log.info("custom snippet saved", { id: snippet.id })
  }

  /**
   * Delete a custom snippet
   */
  export async function deleteCustom(id: string): Promise<boolean> {
    const snippetsFile = join(Global.Path.config, "snippets", "custom.json")
    if (!existsSync(snippetsFile)) return false

    const { readFile, writeFile } = await import("fs/promises")
    const existing: Snippet[] = JSON.parse(await readFile(snippetsFile, "utf8"))
    const filtered = existing.filter((s) => s.id !== id)

    if (filtered.length === existing.length) return false

    await writeFile(snippetsFile, JSON.stringify(filtered, null, 2))
    log.info("custom snippet deleted", { id })
    return true
  }

  // Helper for readdirSync (since we're mixing sync/async)
  function readdirSync(dir: string) {
    const { readdirSync: sync } = require("fs")
    return sync(dir)
  }

  function readFile(path: string, encoding: string) {
    const { readFile: sync } = require("fs")
    return sync(path, encoding)
  }
}
