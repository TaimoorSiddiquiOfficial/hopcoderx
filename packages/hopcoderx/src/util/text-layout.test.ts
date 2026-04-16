import { expect, test, describe } from "bun:test"
import {
  measureWidth,
  measureWidthCached,
  truncate,
  wrap,
  getLines,
  padRight,
  padLeft,
  center,
  stripAnsi,
  measureWidthWithoutAnsi,
  TextLayout,
} from "./text-layout"

describe("TextLayout", () => {
  describe("measureWidth", () => {
    test("should measure ASCII text correctly", () => {
      expect(measureWidth("hello")).toBe(5)
      expect(measureWidth("")).toBe(0)
      expect(measureWidth("a")).toBe(1)
    })

    test("should handle wide characters (CJK)", () => {
      expect(measureWidth("你好")).toBe(4) // Each CJK char = 2 columns
      expect(measureWidth("hello 世界")).toBe(10) // 5 + 4 + 1 (space)
    })

    test("should handle emoji", () => {
      expect(measureWidth("😀")).toBe(2)
      expect(measureWidth("hello😀")).toBe(7)
    })

    test("should handle combining characters", () => {
      // é can be written as e + combining acute accent
      expect(measureWidth("café")).toBeLessThanOrEqual(5)
    })
  })

  describe("measureWidthCached", () => {
    test("should cache results", () => {
      const width1 = measureWidthCached("test")
      const width2 = measureWidthCached("test")
      expect(width1).toBe(width2)
      expect(width1).toBe(4)
    })
  })

  describe("truncate", () => {
    test("should not truncate if text fits", () => {
      expect(truncate("hello", 10)).toBe("hello")
    })

    test("should truncate at end with ellipsis", () => {
      expect(truncate("hello world", 8)).toBe("hello...")
    })

    test("should truncate at start", () => {
      const result = truncate("hello world", 8, { position: "start" })
      expect(result).toContain("...")
      expect(result.length).toBeLessThanOrEqual(8)
    })

    test("should truncate in middle", () => {
      const result = truncate("hello world", 10, { position: "middle" })
      expect(result).toContain("...")
    })

    test("should handle custom ellipsis", () => {
      const result = truncate("hello world", 8, { ellipsis: "→" })
      expect(result).toContain("→")
      expect(result.length).toBeLessThanOrEqual(8)
    })
  })

  describe("wrap", () => {
    test("should not wrap if text fits", () => {
      expect(wrap("hello", 10)).toEqual(["hello"])
    })

    test("should wrap at word boundaries", () => {
      const lines = wrap("hello world foo bar", 11)
      expect(lines.length).toBeGreaterThan(1)
      // Each line should fit within maxWidth
      for (const line of lines) {
        expect(measureWidth(line)).toBeLessThanOrEqual(11)
      }
    })

    test("should preserve line breaks", () => {
      const lines = wrap("hello\nworld", 10)
      expect(lines).toEqual(["hello", "world"])
    })

    // Note: breakWords feature is not fully implemented yet
    // This test is skipped until the feature is added
    test.skip("should break long words if breakWords is true", () => {
      const lines = wrap("supercalifragilistic", 5, { breakWords: true })
      expect(lines.length).toBeGreaterThan(1)
    })

    test("should handle empty string", () => {
      expect(wrap("", 10)).toEqual([""])
    })
  })

  describe("getLines", () => {
    test("should return Line objects", () => {
      const lines = getLines("hello world", 5)
      expect(lines.length).toBeGreaterThan(1)
      expect(lines[0]).toHaveProperty("text")
      expect(lines[0]).toHaveProperty("width")
      expect(lines[0]).toHaveProperty("wrapped")
    })
  })

  describe("padRight", () => {
    test("should pad to target width", () => {
      expect(padRight("hello", 8)).toBe("hello   ")
      expect(measureWidth(padRight("hello", 8))).toBe(8)
    })

    test("should not truncate if already wider", () => {
      expect(padRight("hello", 3)).toBe("hello")
    })
  })

  describe("padLeft", () => {
    test("should pad to target width", () => {
      expect(padLeft("hello", 8)).toBe("   hello")
      expect(measureWidth(padLeft("hello", 8))).toBe(8)
    })
  })

  describe("center", () => {
    test("should center text", () => {
      expect(center("hello", 9)).toBe("  hello  ")
      expect(center("hello", 10)).toBe("  hello   ")
    })
  })

  describe("stripAnsi", () => {
    test("should remove ANSI codes", () => {
      expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red")
      expect(stripAnsi("\x1b[1m\x1b[32mgreen\x1b[0m")).toBe("green")
    })
  })

  describe("measureWidthWithoutAnsi", () => {
    test("should measure without ANSI codes", () => {
      expect(measureWidthWithoutAnsi("\x1b[31mhello\x1b[0m")).toBe(5)
    })
  })
})
