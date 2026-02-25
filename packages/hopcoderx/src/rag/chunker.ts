import { Symbols } from "./symbols"

const CHUNK_TARGET = 60
const CHUNK_OVERLAP = 10
const CHUNK_MIN = 5
const MAX_FILE_LINES = 50000

export namespace Chunker {
  export interface Chunk {
    filepath: string
    content: string
    symbol_name: string
    symbol_type: string
    start_line: number
    end_line: number
  }

  export function chunk(filepath: string, content: string): Chunk[] {
    const lines = content.split("\n")
    if (lines.length > MAX_FILE_LINES) return []

    const { symbols } = Symbols.extract(filepath, content)

    // if we have symbols, create symbol-based chunks
    if (symbols.length > 0) return symbolChunks(filepath, lines, symbols)

    // fallback to sliding window
    return windowChunks(filepath, lines)
  }

  function symbolChunks(filepath: string, lines: string[], symbols: Symbols.Symbol[]): Chunk[] {
    const result: Chunk[] = []
    const covered = new Set<number>()

    // sort by start line
    const sorted = [...symbols].sort((a, b) => a.start_line - b.start_line)

    for (const sym of sorted) {
      const start = Math.max(0, sym.start_line - 1)
      const end = Math.min(lines.length - 1, sym.end_line - 1)
      if (end - start < CHUNK_MIN) continue

      const slice = lines.slice(start, end + 1).join("\n")
      if (!slice.trim()) continue

      result.push({
        filepath,
        content: slice,
        symbol_name: sym.name,
        symbol_type: sym.kind,
        start_line: sym.start_line,
        end_line: sym.end_line,
      })

      for (let i = start; i <= end; i++) covered.add(i)
    }

    // fill gaps with window chunks for uncovered regions
    let gap_start = -1
    for (let i = 0; i <= lines.length; i++) {
      if (i < lines.length && !covered.has(i)) {
        if (gap_start < 0) gap_start = i
        continue
      }
      if (gap_start >= 0) {
        const gap = lines.slice(gap_start, i)
        if (gap.length >= CHUNK_MIN && gap.some((l) => l.trim())) {
          result.push({
            filepath,
            content: gap.join("\n"),
            symbol_name: "",
            symbol_type: "block",
            start_line: gap_start + 1,
            end_line: i,
          })
        }
        gap_start = -1
      }
    }

    return result
  }

  function windowChunks(filepath: string, lines: string[]): Chunk[] {
    const result: Chunk[] = []
    const step = CHUNK_TARGET - CHUNK_OVERLAP

    for (let i = 0; i < lines.length; i += step) {
      const end = Math.min(i + CHUNK_TARGET, lines.length)
      const slice = lines.slice(i, end)
      if (slice.length < CHUNK_MIN) continue
      if (!slice.some((l) => l.trim())) continue

      result.push({
        filepath,
        content: slice.join("\n"),
        symbol_name: "",
        symbol_type: "block",
        start_line: i + 1,
        end_line: end,
      })

      if (end >= lines.length) break
    }

    return result
  }
}
