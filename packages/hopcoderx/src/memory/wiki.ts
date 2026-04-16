/**
 * Obsidian/Markdown vault memory backend.
 *
 * Stores memory entries as individual .md files in a vault directory.
 * Compatible with Obsidian, Foam, and any Markdown-based knowledge base.
 *
 * File format:
 *   ---
 *   id: <uuid>
 *   tags: [pattern, typescript]
 *   score: 0.8
 *   createdAt: 1234567890000
 *   updatedAt: 1234567890000
 *   accessCount: 3
 *   projectScope: /path/to/project
 *   ---
 *
 *   <content>
 *
 * Config: set `memory.backend = "wiki"` and `memory.wiki.vaultPath = "/path/to/vault"` in hopcoderx config.
 */

import { readdir, readFile, writeFile, unlink, mkdir, access } from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"
import type { MemoryBackend, MemoryEntry, MemorySearchResult } from "./memory"
import { Log } from "../util/log"

const log = Log.create({ service: "memory-wiki" })

interface WikiFrontmatter {
  id: string
  tags: string[]
  score: number
  createdAt: number
  updatedAt: number
  accessCount: number
  projectScope: string | null
}

function parseFrontmatter(raw: string): { meta: WikiFrontmatter; content: string } | null {
  const match = raw.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/)
  if (!match) return null
  try {
    const lines = match[1].split("\n")
    const meta: Record<string, unknown> = {}
    for (const line of lines) {
      const colonIdx = line.indexOf(":")
      if (colonIdx === -1) continue
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      if (value.startsWith("[") && value.endsWith("]")) {
        meta[key] = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean)
      } else if (value === "null" || value === "~") {
        meta[key] = null
      } else if (!isNaN(Number(value)) && value !== "") {
        meta[key] = Number(value)
      } else {
        meta[key] = value.replace(/^['"]|['"]$/g, "")
      }
    }
    return {
      meta: {
        id: String(meta.id ?? randomUUID()),
        tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : [],
        score: Number(meta.score ?? 0.5),
        createdAt: Number(meta.createdAt ?? Date.now()),
        updatedAt: Number(meta.updatedAt ?? Date.now()),
        accessCount: Number(meta.accessCount ?? 0),
        projectScope: (meta.projectScope as string | null) ?? null,
      },
      content: match[2].trim(),
    }
  } catch {
    return null
  }
}

function serializeEntry(entry: MemoryEntry): string {
  const tagStr = `[${entry.tags.map((t) => `"${t}"`).join(", ")}]`
  const fm = [
    "---",
    `id: ${entry.id}`,
    `tags: ${tagStr}`,
    `score: ${entry.score}`,
    `createdAt: ${entry.createdAt}`,
    `updatedAt: ${entry.updatedAt}`,
    `accessCount: ${entry.accessCount}`,
    `projectScope: ${entry.projectScope ?? "null"}`,
    "---",
    "",
    entry.content,
  ].join("\n")
  return fm
}

function simpleScore(content: string, query: string): number {
  const qWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
  const text = content.toLowerCase()
  if (qWords.length === 0) return 0
  const hits = qWords.filter((w) => text.includes(w)).length
  return hits / qWords.length
}

export class WikiMemoryBackend implements MemoryBackend {
  readonly id = "wiki"
  readonly name = "Obsidian/Markdown Vault"

  private vaultPath: string
  private cache: Map<string, MemoryEntry> = new Map()
  private initialized = false

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath
  }

  private entryPath(id: string): string {
    return path.join(this.vaultPath, `${id}.md`)
  }

  async init(): Promise<void> {
    try {
      await mkdir(this.vaultPath, { recursive: true })
      // Load all existing entries into cache
      const files = await readdir(this.vaultPath).catch(() => [])
      for (const file of files) {
        if (!file.endsWith(".md")) continue
        try {
          const raw = await readFile(path.join(this.vaultPath, file), "utf8")
          const parsed = parseFrontmatter(raw)
          if (parsed) {
            const entry: MemoryEntry = { ...parsed.meta, content: parsed.content }
            this.cache.set(entry.id, entry)
          }
        } catch {}
      }
      this.initialized = true
      log.info("wiki memory backend initialized", { vaultPath: this.vaultPath, entries: this.cache.size })
    } catch (err) {
      log.warn("wiki memory init failed", { err: String(err) })
    }
  }

  async upsert(input: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt" | "accessCount"> & { id?: string }): Promise<MemoryEntry> {
    const now = Date.now()
    const existing = input.id ? this.cache.get(input.id) : null
    const entry: MemoryEntry = {
      id: input.id ?? randomUUID(),
      content: input.content,
      tags: input.tags,
      projectScope: input.projectScope,
      score: input.score,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      accessCount: existing?.accessCount ?? 0,
    }
    this.cache.set(entry.id, entry)
    await writeFile(this.entryPath(entry.id), serializeEntry(entry), "utf8")
    return entry
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const cached = this.cache.get(id)
    if (cached) {
      // Bump access count
      cached.accessCount++
      cached.updatedAt = Date.now()
      this.cache.set(id, cached)
      await writeFile(this.entryPath(id), serializeEntry(cached), "utf8")
      return cached
    }
    try {
      const raw = await readFile(this.entryPath(id), "utf8")
      const parsed = parseFrontmatter(raw)
      if (!parsed) return null
      const entry: MemoryEntry = { ...parsed.meta, content: parsed.content }
      this.cache.set(entry.id, entry)
      return entry
    } catch {
      return null
    }
  }

  async delete(id: string): Promise<void> {
    this.cache.delete(id)
    try {
      await unlink(this.entryPath(id))
    } catch (e) {
      Log.Default.warn("failed to delete wiki entry", {
        service: "wiki.delete",
        id,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  async search(query: string, opts?: { limit?: number; projectScope?: string | null; tags?: string[] }): Promise<MemorySearchResult[]> {
    const results: MemorySearchResult[] = []
    for (const entry of this.cache.values()) {
      if (opts?.projectScope !== undefined && entry.projectScope !== opts.projectScope) continue
      if (opts?.tags?.length && !opts.tags.some((t) => entry.tags.includes(t))) continue
      const similarity = simpleScore(`${entry.content} ${entry.tags.join(" ")}`, query)
      if (similarity > 0) results.push({ entry, similarity })
    }
    return results.sort((a, b) => b.similarity - a.similarity).slice(0, opts?.limit ?? 10)
  }

  async list(opts?: { projectScope?: string | null; tags?: string[]; limit?: number }): Promise<MemoryEntry[]> {
    let entries = [...this.cache.values()]
    if (opts?.projectScope !== undefined) entries = entries.filter((e) => e.projectScope === opts.projectScope)
    if (opts?.tags?.length) entries = entries.filter((e) => opts.tags!.some((t) => e.tags.includes(t)))
    return entries.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, opts?.limit ?? 100)
  }

  async export(): Promise<MemoryEntry[]> {
    return [...this.cache.values()]
  }

  async clear(): Promise<void> {
    const ids = [...this.cache.keys()]
    this.cache.clear()
    await Promise.all(ids.map((id) => unlink(this.entryPath(id)).catch(() => {})))
  }

  async close(): Promise<void> {
    this.cache.clear()
  }
}
