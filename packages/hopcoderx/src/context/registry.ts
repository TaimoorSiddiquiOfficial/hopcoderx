/**
 * Context Registry for HopCoderX
 *
 * Scans and indexes context files from .hopcoderx/context/ directory.
 * Supports both markdown (.md) and structured (.json/.yaml) formats.
 *
 * Usage:
 *   const registry = await ContextRegistry.scan(projectDir)
 *   const files = registry.list()
 *   const file = registry.get("architecture.md")
 */

import { readdir, readFile } from "fs/promises"
import { existsSync } from "fs"
import { join, relative } from "path"
import { Glob } from "../util/glob"
import { Log } from "../util/log"
import { Token } from "../util/token"

const log = Log.create({ service: "context-registry" })

export interface ContextFile {
  /** Absolute file path */
  path: string
  /** Relative path from context directory */
  relativePath: string
  /** File name */
  name: string
  /** Description from frontmatter/metadata */
  description: string
  /** Tags for categorization */
  tags: string[]
  /** Estimated token count */
  tokens: number
  /** Last loaded timestamp (null if never) */
  lastLoaded: number | null
  /** Number of times loaded */
  loadCount: number
  /** Relevance score (0-1, computed dynamically) */
  relevanceScore: number
  /** File format */
  format: "markdown" | "json" | "yaml"
  /** Context categories this file belongs to */
  categories: string[]
}

interface MarkdownFrontmatter {
  name?: string
  description?: string
  tags?: string[]
  categories?: string[]
}

interface JsonContext {
  name?: string
  description?: string
  tags?: string[]
  categories?: string[]
  content?: string
}

const DEFAULT_CONTEXT_DIR = ".hopcoderx/context"

function parseMarkdownFrontmatter(content: string): MarkdownFrontmatter {
  const match = content.match(/^---\n([\s\S]+?)\n---\n/)
  if (!match) return {}

  const frontmatter: MarkdownFrontmatter = {}
  const lines = match[1].split("\n")

  for (const line of lines) {
    const colonIdx = line.indexOf(":")
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()

    if (value.startsWith("[") && value.endsWith("]")) {
      const arr = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean)
      if (key === "tags") frontmatter.tags = arr
      else if (key === "categories") frontmatter.categories = arr
    } else if (value.startsWith('"') && value.endsWith('"')) {
      if (key === "name") frontmatter.name = value.slice(1, -1)
      else if (key === "description") frontmatter.description = value.slice(1, -1)
    } else {
      if (key === "name") frontmatter.name = value
      else if (key === "description") frontmatter.description = value
    }
  }

  return frontmatter
}

function extractContentFromMarkdown(content: string): string {
  return content.replace(/^---\n[\s\S]+?\n---\n/, "").trim()
}

function parseJsonContext(content: string): JsonContext {
  try {
    return JSON.parse(content)
  } catch {
    return {}
  }
}

export class ContextRegistry {
  private contextDir: string
  private files: Map<string, ContextFile> = new Map()
  private initialized = false

  constructor(projectDir: string, contextDir?: string) {
    this.contextDir = contextDir || join(projectDir, DEFAULT_CONTEXT_DIR)
  }

  /** Scan context directory and build index */
  async scan(include?: string[], exclude?: string[]): Promise<void> {
    if (!existsSync(this.contextDir)) {
      log.debug("context directory not found", { dir: this.contextDir })
      this.initialized = true
      return
    }

    const patterns = include?.length ? include : ["**/*.md", "**/*.json", "**/*.yaml"]
    const excludePatterns = exclude || ["**/node_modules/**", "**/.git/**", "**/README.md"]

    try {
      const matches: string[] = []
      for (const pattern of patterns) {
        const results = await Glob.scan(pattern, {
          cwd: this.contextDir,
          absolute: true,
          include: "file",
        })
        matches.push(...results)
      }

      for (const filePath of matches) {
        await this.indexFile(filePath)
      }

      log.info("context registry scanned", {
        dir: this.contextDir,
        fileCount: this.files.size,
        formats: {
          markdown: Array.from(this.files.values()).filter((f) => f.format === "markdown").length,
          json: Array.from(this.files.values()).filter((f) => f.format === "json").length,
          yaml: Array.from(this.files.values()).filter((f) => f.format === "yaml").length,
        },
      })
    } catch (err) {
      log.warn("context registry scan failed", {
        dir: this.contextDir,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    this.initialized = true
  }

  private async indexFile(filePath: string): Promise<void> {
    try {
      const content = await readFile(filePath, "utf8")
      const relativePath = relative(this.contextDir, filePath)
      const ext = filePath.split(".").pop()?.toLowerCase()

      let format: ContextFile["format"] = "markdown"
      let name = relativePath
      let description = ""
      let tags: string[] = []
      let categories: string[] = []
      let contentForTokens = content

      if (ext === "md") {
        format = "markdown"
        const frontmatter = parseMarkdownFrontmatter(content)
        name = frontmatter.name || relativePath
        description = frontmatter.description || ""
        tags = frontmatter.tags || []
        categories = frontmatter.categories || []
        contentForTokens = extractContentFromMarkdown(content)
      } else if (ext === "json") {
        format = "json"
        const json = parseJsonContext(content)
        name = json.name || relativePath
        description = json.description || ""
        tags = json.tags || []
        categories = json.categories || []
      } else if (ext === "yaml" || ext === "yml") {
        format = "yaml"
        // YAML parsing would require a dependency, use basic parsing
        name = relativePath
        description = ""
      }

      const tokens = Token.estimate(contentForTokens)

      const contextFile: ContextFile = {
        path: filePath,
        relativePath,
        name: typeof name === "string" ? name : relativePath,
        description: typeof description === "string" ? description : "",
        tags: Array.isArray(tags) ? tags : [],
        categories: Array.isArray(categories) ? categories : [],
        tokens,
        lastLoaded: null,
        loadCount: 0,
        relevanceScore: 0,
        format,
      }

      this.files.set(filePath, contextFile)
    } catch (err) {
      log.warn("failed to index context file", {
        file: filePath,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /** List all indexed context files */
  list(options?: { format?: ContextFile["format"]; category?: string }): ContextFile[] {
    let files = Array.from(this.files.values())

    if (options?.format) {
      files = files.filter((f) => f.format === options.format)
    }

    if (options?.category) {
      files = files.filter((f) => f.categories.includes(options.category!))
    }

    return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  }

  /** Get a specific context file by path or name */
  get(identifier: string): ContextFile | undefined {
    // Try exact path match
    const byPath = this.files.get(identifier)
    if (byPath) return byPath

    // Try name match
    for (const file of this.files.values()) {
      if (file.name === identifier || file.relativePath === identifier) {
        return file
      }
    }

    return undefined
  }

  /** Update load statistics for a file */
  recordLoad(filePath: string): void {
    const file = this.files.get(filePath)
    if (file) {
      file.lastLoaded = Date.now()
      file.loadCount++
    }
  }

  /** Update relevance scores for all files */
  updateRelevance(query: string, recentFiles?: string[]): void {
    const queryLower = query.toLowerCase()
    const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 2)

    for (const file of this.files.values()) {
      let score = 0

      // Keyword matching in query
      for (const term of queryTerms) {
        if (file.name.toLowerCase().includes(term)) score += 0.2
        if (file.description.toLowerCase().includes(term)) score += 0.15
        if (file.tags.some((t) => t.toLowerCase().includes(term))) score += 0.1
        if (file.categories.some((c) => c.toLowerCase().includes(term))) score += 0.1
      }

      // Recency bonus (files loaded recently)
      if (file.lastLoaded) {
        const ageHours = (Date.now() - file.lastLoaded) / (1000 * 60 * 60)
        if (ageHours < 1) score += 0.1
        else if (ageHours < 24) score += 0.05
      }

      // Recent file bonus (referenced in conversation)
      if (recentFiles?.includes(file.path)) {
        score += 0.15
      }

      file.relevanceScore = Math.min(1, score)
    }
  }

  /** Get files sorted by relevance */
  getByRelevance(limit?: number): ContextFile[] {
    const files = Array.from(this.files.values()).sort((a, b) => b.relevanceScore - a.relevanceScore)
    return limit ? files.slice(0, limit) : files
  }

  /** Get total tokens of all indexed files */
  getTotalTokens(): number {
    let total = 0
    for (const file of this.files.values()) {
      total += file.tokens
    }
    return total
  }

  /** Check if registry is initialized */
  isInitialized(): boolean {
    return this.initialized
  }

  /** Get context directory path */
  getDirectory(): string {
    return this.contextDir
  }
}
