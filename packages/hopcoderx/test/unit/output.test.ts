/**
 * Unit tests for output formatting utilities
 */

import { describe, it, expect } from "bun:test"
import { formatOutput, toTable, toCSV, toMarkdown, toHTML } from "../../src/cli/output"

describe("Output Formatting", () => {
  const testData = [
    { name: "Alice", age: 30, city: "New York" },
    { name: "Bob", age: 25, city: "Los Angeles" },
    { name: "Charlie", age: 35, city: "Chicago" },
  ]

  describe("formatOutput", () => {
    it("should format as JSON", () => {
      const result = formatOutput(testData, { format: "json" })
      expect(result).toContain('"name": "Alice"')
      expect(result).toContain('"age": 30')
    })

    it("should format as YAML", () => {
      const result = formatOutput(testData, { format: "yaml" })
      expect(result).toContain("- name: Alice")
    })

    it("should format as table by default", () => {
      const result = formatOutput(testData)
      expect(result).toContain("name")
      expect(result).toContain("Alice")
    })

    it("should handle empty arrays", () => {
      const result = formatOutput([])
      expect(result).toBe("No data")
    })

    it("should handle single object", () => {
      const result = formatOutput({ name: "Test", value: 123 }, { format: "json" })
      expect(result).toContain('"name": "Test"')
    })
  })

  describe("toTable", () => {
    it("should create table with headers", () => {
      const result = toTable(testData, { headers: true })
      expect(result).toContain("name")
      expect(result).toContain("age")
      expect(result).toContain("city")
    })

    it("should create table without headers", () => {
      const result = toTable(testData, { headers: false })
      expect(result).not.toContain("│")
      expect(result).toContain("Alice")
    })

    it("should handle empty data", () => {
      const result = toTable([])
      expect(result).toBe("No data")
    })

    it("should truncate long values in compact mode", () => {
      const longData = [{ name: "VeryLongNameThatExceedsLimit", value: "test" }]
      const result = toTable(longData, { style: "compact" })
      expect(result.length).toBeLessThan(200)
    })
  })

  describe("toCSV", () => {
    it("should create CSV with headers", () => {
      const result = toCSV(testData, true)
      const lines = result.split("\n")
      expect(lines[0]).toContain("name,age,city")
      expect(lines.length).toBe(4) // header + 3 rows
    })

    it("should create CSV without headers", () => {
      const result = toCSV(testData, false)
      const lines = result.split("\n")
      expect(lines.length).toBe(3) // 3 rows only
      expect(lines[0]).toContain("Alice")
    })

    it("should escape commas in values", () => {
      const data = [{ name: "Test, Value", other: "ok" }]
      const result = toCSV(data)
      expect(result).toContain('"Test, Value"')
    })

    it("should escape quotes in values", () => {
      const data = [{ name: 'Test "Quote"', other: "ok" }]
      const result = toCSV(data)
      expect(result).toContain('""')
    })

    it("should handle empty data", () => {
      const result = toCSV([])
      expect(result).toBe("")
    })
  })

  describe("toMarkdown", () => {
    it("should create markdown table with headers", () => {
      const result = toMarkdown(testData, true)
      expect(result).toContain("| name | age | city |")
      expect(result).toContain("| --- | --- | --- |")
      expect(result).toContain("| Alice")
    })

    it("should create markdown table without headers", () => {
      const result = toMarkdown(testData, false)
      expect(result).not.toContain("---")
      expect(result).toContain("| Alice")
    })

    it("should escape pipe characters", () => {
      const data = [{ name: "Test | Value" }]
      const result = toMarkdown(data)
      expect(result).toContain("Test \\| Value")
    })

    it("should handle empty data", () => {
      const result = toMarkdown([])
      expect(result).toBe("_No data_")
    })
  })

  describe("toHTML", () => {
    it("should create HTML table with headers", () => {
      const result = toHTML(testData, true)
      expect(result).toContain("<table")
      expect(result).toContain("<thead>")
      expect(result).toContain("<th")
      expect(result).toContain("</table>")
    })

    it("should create HTMLtable without headers", () => {
      const result = toHTML(testData, false)
      expect(result).not.toContain("<thead>")
      expect(result).toContain("<tbody>")
    })

    it("should escape HTML entities", () => {
      const data = [{ name: "<script>alert('xss')</script>" }]
      const result = toHTML(data)
      expect(result).not.toContain("<script>")
      expect(result).toContain("&lt;script&gt;")
    })

    it("should handle empty data", () => {
      const result = toHTML([])
      expect(result).toContain("<em>No data</em>")
    })
  })
})
