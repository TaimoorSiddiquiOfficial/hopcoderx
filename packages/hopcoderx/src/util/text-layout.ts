/**
 * Text Layout Utilities - Pretext-inspired
 *
 * Fast text measurement and layout without DOM/terminal overhead.
 * Uses cached character widths for efficient re-layout.
 *
 * Inspired by: https://github.com/chenglou/pretext
 */

import { Log } from "./log"

const log = Log.create({ service: "text-layout" })

/**
 * Font specification for text measurement
 */
export interface FontSpec {
  /** Font family (monospace, sans-serif, etc.) */
  family?: string
  /** Font size in pixels */
  size?: number
  /** Whether text is bold */
  bold?: boolean
  /** Whether text is italic */
  italic?: boolean
}

/**
 * Dimensions of measured text
 */
export interface Dimensions {
  /** Width in characters (terminal columns) */
  width: number
  /** Height in lines (terminal rows) */
  height: number
}

/**
 * A single line of text with measurement
 */
export interface Line {
  /** Text content */
  text: string
  /** Display width */
  width: number
  /** Whether this line was wrapped */
  wrapped: boolean
}

/**
 * Text wrapping options
 */
export interface WrapOptions {
  /** Maximum width in characters */
  maxWidth: number
  /** Whether to preserve existing line breaks */
  preserveBreaks?: boolean
  /** Whether to break long words if they don't fit */
  breakWords?: boolean
  /** String to append when truncating */
  ellipsis?: string
  /** Whether to trim trailing whitespace */
  trimTrailing?: boolean
}

/**
 * Character width cache for monospace fonts
 * In monospace, most characters have equal width
 */
const monospaceCache = new Map<string, number>()

/**
 * Pre-calculated widths for common ASCII characters (monospace approximation)
 * These are character cell widths, not pixels
 */
const MONOSPACE_WIDTH = 1
const WIDE_CHAR_WIDTH = 2 // CJK, emoji, etc.

/**
 * Check if a character is "wide" (takes 2 terminal columns)
 */
function isWideChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  if (!code) return false

  // CJK Unified Ideographs
  if (code >= 0x4e00 && code <= 0x9fff) return true
  // CJK Unified Ideographs Extension A
  if (code >= 0x3400 && code <= 0x4dbf) return true
  // Hangul Syllables (Korean)
  if (code >= 0xac00 && code <= 0xd7af) return true
  // Full-width forms
  if (code >= 0xff01 && code <= 0xff60) return true
  // Emoji ranges (simplified)
  if (code >= 0x1f300 && code <= 0x1f9ff) return true
  if (code >= 0x2600 && code <= 0x26ff) return true
  if (code >= 0x2700 && code <= 0x27bf) return true

  return false
}

/**
 * Check if a character is a combining character or zero-width
 */
function isCombiningOrZeroWidth(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  if (!code) return false

  // Combining diacritical marks
  if (code >= 0x0300 && code <= 0x036f) return true
  // Zero-width characters
  if (code === 0x200b || code === 0x200c || code === 0x200d) return true

  return false
}

/**
 * Measure the display width of a string in terminal columns
 * Handles wide characters (CJK, emoji) and combining marks
 */
export function measureWidth(text: string): number {
  if (!text) return 0

  let width = 0
  let i = 0

  while (i < text.length) {
    const char = text[i]

    // Skip combining characters and zero-width characters
    if (isCombiningOrZeroWidth(char)) {
      i++
      continue
    }

    // Check for surrogate pairs (emoji, etc.)
    if (char >= "\uD800" && char <= "\uDFFF" && i + 1 < text.length) {
      const next = text[i + 1]
      if (next >= "\uDC00" && next <= "\uDFFF") {
        // This is a surrogate pair
        const fullChar = char + next
        width += isWideChar(fullChar) ? WIDE_CHAR_WIDTH : MONOSPACE_WIDTH
        i += 2
        continue
      }
    }

    // Single character
    width += isWideChar(char) ? WIDE_CHAR_WIDTH : MONOSPACE_WIDTH
    i++
  }

  return width
}

/**
 * Cached measurement for repeated strings
 */
const measureCache = new Map<string, number>()
const CACHE_LIMIT = 10000

export function measureWidthCached(text: string): number {
  if (measureCache.has(text)) {
    return measureCache.get(text)!
  }

  const width = measureWidth(text)

  // Prune cache if too large
  if (measureCache.size >= CACHE_LIMIT) {
    const firstKey = measureCache.keys().next().value
    if (firstKey) measureCache.delete(firstKey)
  }

  measureCache.set(text, width)
  return width
}

/**
 * Truncate text to fit within a maximum width
 * Appends ellipsis if truncation occurs
 */
export function truncate(
  text: string,
  maxWidth: number,
  options?: {
    ellipsis?: string
    position?: "start" | "middle" | "end"
  },
): string {
  const { ellipsis = "...", position = "end" } = options ?? {}
  const measured = measureWidth(text)

  if (measured <= maxWidth) return text

  const ellipsisWidth = measureWidth(ellipsis)
  const availableWidth = maxWidth - ellipsisWidth

  if (availableWidth <= 0) {
    return ellipsis.slice(0, maxWidth)
  }

  switch (position) {
    case "start":
      // Keep the end, show ellipsis at start: "...text"
      let startResult = ellipsis
      let startWidth = ellipsisWidth
      for (let i = text.length - 1; i >= 0; i--) {
        const char = text[i]
        const charWidth = isWideChar(char) ? 2 : 1
        if (startWidth + charWidth > maxWidth) break
        startResult = char + startResult
        startWidth += charWidth
      }
      return startResult

    case "middle":
      // Split: show start and end with ellipsis in middle
      const halfWidth = Math.floor(availableWidth / 2)
      let leftResult = ""
      let leftWidth = 0
      for (let i = 0; i < text.length; i++) {
        const char = text[i]
        const charWidth = isWideChar(char) ? 2 : 1
        if (leftWidth + charWidth > halfWidth) break
        leftResult += char
        leftWidth += charWidth
      }

      let rightResult = ""
      let rightWidth = 0
      for (let i = text.length - 1; i >= 0; i--) {
        const char = text[i]
        const charWidth = isWideChar(char) ? 2 : 1
        if (rightWidth + charWidth > halfWidth) break
        rightResult = char + rightResult
        rightWidth += charWidth
      }

      return leftResult + ellipsis + rightResult

    case "end":
    default:
      // Keep the start, show ellipsis at end: "text..."
      let endResult = ""
      let endWidth = 0
      for (let i = 0; i < text.length; i++) {
        const char = text[i]
        const charWidth = isWideChar(char) ? 2 : 1
        if (endWidth + charWidth > availableWidth) break
        endResult += char
        endWidth += charWidth
      }
      return endResult + ellipsis
  }
}

/**
 * Wrap text to fit within a maximum width
 * Respects word boundaries unless breakWords is true
 */
export function wrap(
  text: string,
  maxWidth: number,
  options?: WrapOptions,
): string[] {
  const {
    preserveBreaks = true,
    breakWords = false,
    trimTrailing = true,
  } = options ?? {}

  if (maxWidth <= 0) return []
  if (!text) return [""]

  // Handle existing line breaks
  if (preserveBreaks && text.includes("\n")) {
    const lines = text.split("\n")
    const wrappedLines: string[] = []
    for (const line of lines) {
      const trimmed = trimTrailing ? line.trimEnd() : line
      if (measureWidth(trimmed) <= maxWidth) {
        wrappedLines.push(trimmed)
      } else {
        wrappedLines.push(...wrap(trimmed, maxWidth, { ...options, preserveBreaks: false }))
      }
    }
    return wrappedLines
  }

  const trimmed = trimTrailing ? text.trimEnd() : text
  const measured = measureWidth(trimmed)

  // No wrapping needed
  if (measured <= maxWidth) {
    return [trimmed]
  }

  const lines: string[] = []
  let currentLine = ""
  let currentWidth = 0

  // Split into words (by spaces)
  const words = trimmed.split(/(\s+)/)

  for (const word of words) {
    const wordWidth = measureWidth(word)
    const isWhitespace = /^\s+$/.test(word)

    // If this is a single word/whitespace that's too long
    if (wordWidth > maxWidth && !breakWords && currentLine === "") {
      // Break the word across lines
      let remaining = word
      while (remaining) {
        const chunkWidth = maxWidth
        let chunk = ""
        let chunkMeasured = 0

        for (let i = 0; i < remaining.length; i++) {
          const char = remaining[i]
          const charWidth = isWideChar(char) ? 2 : 1
          if (chunkMeasured + charWidth > chunkWidth) break
          chunk += char
          chunkMeasured += charWidth
        }

        lines.push(chunk)
        remaining = remaining.slice(chunk.length)
      }
      continue
    }

    // If adding this word would exceed max width
    if (currentWidth + wordWidth > maxWidth && currentLine !== "") {
      lines.push(currentLine)
      currentLine = isWhitespace ? "" : word
      currentWidth = isWhitespace ? 0 : wordWidth
      continue
    }

    // Add word to current line
    currentLine += word
    currentWidth += wordWidth
  }

  // Don't forget the last line
  if (currentLine) {
    lines.push(currentLine)
  }

  return lines
}

/**
 * Wrap text and return structured Line objects
 */
export function getLines(
  text: string,
  maxWidth: number,
  options?: WrapOptions,
): Line[] {
  const wrapped = wrap(text, maxWidth, options)
  return wrapped.map((line, index) => ({
    text: line,
    width: measureWidth(line),
    wrapped: index > 0,
  }))
}

/**
 * Calculate the height of multi-line text
 */
export function getHeight(
  text: string,
  maxWidth: number,
  lineHeight?: number,
): number {
  const lines = getLines(text, maxWidth)
  const lh = lineHeight ?? 1
  return lines.length * lh
}

/**
 * Measure full dimensions of text (width and height)
 */
export function measure(
  text: string,
  options?: {
    maxWidth?: number
    lineHeight?: number
  },
): Dimensions {
  const { maxWidth, lineHeight } = options ?? {}

  if (!text) {
    return { width: 0, height: lineHeight ?? 1 }
  }

  if (maxWidth !== undefined) {
    const lines = getLines(text, maxWidth)
    const width = Math.max(...lines.map((l) => l.width))
    const height = lines.length * (lineHeight ?? 1)
    return { width, height }
  }

  // Single-line measurement
  const lines = text.split("\n")
  const width = Math.max(...lines.map((l) => measureWidth(l)))
  const height = lines.length * (lineHeight ?? 1)
  return { width, height }
}

/**
 * Pad text to a specific width
 */
export function padRight(text: string, targetWidth: number, char = " "): string {
  const currentWidth = measureWidth(text)
  const paddingNeeded = targetWidth - currentWidth
  if (paddingNeeded <= 0) return text
  return text + char.repeat(paddingNeeded)
}

/**
 * Pad text on the left to a specific width
 */
export function padLeft(text: string, targetWidth: number, char = " "): string {
  const currentWidth = measureWidth(text)
  const paddingNeeded = targetWidth - currentWidth
  if (paddingNeeded <= 0) return text
  return char.repeat(paddingNeeded) + text
}

/**
 * Center text within a specific width
 */
export function center(text: string, targetWidth: number, char = " "): string {
  const currentWidth = measureWidth(text)
  const paddingNeeded = targetWidth - currentWidth
  if (paddingNeeded <= 0) return text

  const leftPadding = Math.floor(paddingNeeded / 2)
  const rightPadding = paddingNeeded - leftPadding
  return char.repeat(leftPadding) + text + char.repeat(rightPadding)
}

/**
 * Strip ANSI escape codes from text for measurement
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
}

/**
 * Measure text without ANSI codes
 */
export function measureWidthWithoutAnsi(text: string): number {
  return measureWidth(stripAnsi(text))
}

/**
 * Fill a rectangular area with text
 */
export function fill(
  width: number,
  height: number,
  text: string,
  options?: {
    align?: "left" | "center" | "right"
    valign?: "top" | "middle" | "bottom"
  },
): string[] {
  const { align = "left", valign = "top" } = options ?? {}
  const lines = getLines(text, width)

  // Pad each line to full width
  const paddedLines = lines.map((line) => {
    switch (align) {
      case "center":
        return center(line.text, width)
      case "right":
        return padLeft(line.text, width)
      case "left":
      default:
        return padRight(line.text, width)
    }
  })

  // Pad to full height
  const emptyLine = " ".repeat(width)
  while (paddedLines.length < height) {
    switch (valign) {
      case "middle":
        paddedLines.unshift(emptyLine)
        break
      case "bottom":
        paddedLines.unshift(emptyLine)
        break
      case "top":
      default:
        paddedLines.push(emptyLine)
        break
    }
  }

  // Trim if too many lines
  if (paddedLines.length > height) {
    switch (valign) {
      case "middle":
        return paddedLines.slice(Math.floor((paddedLines.length - height) / 2), Math.floor((paddedLines.length - height) / 2) + height)
      case "bottom":
        return paddedLines.slice(paddedLines.length - height)
      case "top":
      default:
        return paddedLines.slice(0, height)
    }
  }

  return paddedLines
}

/**
 * Create a horizontal rule
 */
export function hrule(width: number, char = "─"): string {
  return char.repeat(width)
}

/**
 * Create a vertical rule (single character)
 */
export function vrule(char = "│"): string {
  return char
}

/**
 * Create a box with borders
 */
export function box(
  content: string | string[],
  options?: {
    width?: number
    padding?: number
    border?: boolean
    title?: string
  },
): string[] {
  const {
    width: maxWidth,
    padding = 0,
    border = true,
    title,
  } = options ?? {}

  const lines = Array.isArray(content) ? content : content.split("\n")

  // Calculate content width
  const maxContentWidth = Math.max(...lines.map((l) => measureWidth(l)))
  const innerWidth = maxWidth ?? maxContentWidth

  // Add padding
  const paddedContent: string[] = []
  const paddingLine = " ".repeat(innerWidth + padding * 2)

  for (let i = 0; i < padding; i++) {
    paddedContent.push(paddingLine)
  }

  for (const line of lines) {
    const padded = " ".repeat(padding) + padRight(line, innerWidth) + " ".repeat(padding)
    paddedContent.push(padded)
  }

  for (let i = 0; i < padding; i++) {
    paddedContent.push(paddingLine)
  }

  // Add border
  if (border) {
    const totalWidth = innerWidth + padding * 2 + 2
    const topBorder = title
      ? `┌${title}┬${hrule(totalWidth - 3 - title.length)}┐`
      : `┌${hrule(totalWidth - 2)}┐`
    const bottomBorder = `└${hrule(totalWidth - 2)}┘`

    const bordered: string[] = [topBorder]
    for (const line of paddedContent) {
      bordered.push(`│${padRight(line, totalWidth - 2)}│`)
    }
    bordered.push(bottomBorder)

    return bordered
  }

  return paddedContent
}

export const TextLayout = {
  measure,
  measureWidth,
  measureWidthCached,
  measureWidthWithoutAnsi,
  wrap,
  truncate,
  getLines,
  getHeight,
  padRight,
  padLeft,
  center,
  stripAnsi,
  fill,
  hrule,
  vrule,
  box,
  isWideChar,
}

export default TextLayout
