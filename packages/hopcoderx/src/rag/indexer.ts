import { Instance } from "../project/instance"
import { Ripgrep } from "../file/ripgrep"
import { Symbols } from "./symbols"
import { Chunker } from "./chunker"
import { Store } from "./store"
import { Log } from "../util/log"
import { statSync } from "fs"
import path from "path"

const log = Log.create({ service: "rag.indexer" })

const MAX_FILE_SIZE = 512 * 1024
const BATCH = 50

const CODE_GLOBS = [
  "*.ts", "*.tsx", "*.js", "*.jsx", "*.mts", "*.mjs",
  "*.py", "*.rs", "*.go", "*.java", "*.rb", "*.php",
  "*.c", "*.h", "*.cpp", "*.hpp", "*.cc", "*.cs",
  "*.swift", "*.kt", "*.kts", "*.scala", "*.hs",
  "*.ml", "*.mli", "*.ex", "*.exs", "*.sh",
  "*.lua", "*.r", "*.R", "*.jl", "*.clj",
  "*.nix", "*.zig", "*.v", "*.dart",
]

export namespace Indexer {
  let running = false

  export async function index(signal?: AbortSignal) {
    if (running) return
    running = true

    const dir = Instance.directory
    log.info("indexing", { dir })
    const start = Date.now()

    let indexed = 0
    let skipped = 0
    let batch: string[] = []

    const globs = CODE_GLOBS.map((g) => `**/${g}`)

    for await (const filepath of Ripgrep.files({ cwd: dir, glob: globs })) {
      if (signal?.aborted) break

      const abs = path.isAbsolute(filepath) ? filepath : path.join(dir, filepath)
      const rel = path.relative(dir, abs)

      if (stale(abs, rel)) {
        batch.push(abs)
        if (batch.length >= BATCH) {
          indexed += await processBatch(dir, batch)
          batch = []
        }
      } else {
        skipped++
      }
    }

    if (batch.length) indexed += await processBatch(dir, batch)

    running = false
    const elapsed = Date.now() - start
    log.info("indexed", { files: indexed, skipped, elapsed })
    return { indexed, skipped, elapsed }
  }

  export function indexed() {
    return Store.stats()
  }

  export function stale(abs: string, rel: string): boolean {
    const stat = safeStat(abs)
    if (!stat) return false
    if (stat.size > MAX_FILE_SIZE) return false

    const record = Store.file(rel)
    if (!record) return true
    return stat.mtimeMs > record.mtime || stat.size !== record.size
  }

  async function processBatch(dir: string, files: string[]) {
    let count = 0

    for (const abs of files) {
      const rel = path.relative(dir, abs)
      const stat = safeStat(abs)
      if (!stat) continue

      const content = await Bun.file(abs).text().catch(() => null)
      if (!content) continue

      // remove old data
      Store.removeFile(rel)

      // chunk and index
      const chunks = Chunker.chunk(rel, content)
      if (chunks.length) Store.insertChunks(chunks)

      // extract symbols
      const result = Symbols.extract(rel, content)
      if (result.symbols.length) Store.insertSymbols(result.symbols)
      if (result.edges.length) Store.insertEdges(result.edges)

      // record file
      Store.upsertFile(rel, stat.mtimeMs, stat.size)
      count++
    }

    return count
  }
}

function safeStat(filepath: string) {
  return statSync(filepath, { throwIfNoEntry: false }) ?? undefined
}
