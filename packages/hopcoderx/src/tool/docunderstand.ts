/**
 * Document understanding tool — PDF, DOCX, HTML → structured text.
 *
 * Extracts text content from:
 *   - PDF files (via poppler pdftotext or fallback to raw buffer)
 *   - DOCX files (via unzip + XML extraction)
 *   - HTML files (via regex tag stripping)
 *   - Markdown files (passthrough)
 *   - Plain text (passthrough)
 *
 * Use cases:
 *   - Spec documents → implementation plans
 *   - API documentation → code generation
 *   - Error reports → debugging
 */

import { z } from "zod"
import { Tool } from "../tool/tool"
import { readFile } from "fs/promises"
import { existsSync } from "fs"
import { extname, basename } from "path"
import { execFile } from "child_process"
import { promisify } from "util"

const execFileAsync = promisify(execFile)
type Meta = Record<string, string | number | boolean | undefined>

async function extractPDF(filePath: string): Promise<string> {
  // Try pdftotext first (poppler-utils)
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", filePath, "-"])
    return stdout
  } catch { /* not installed */ }
  // Fallback: return raw content warning
  return "(PDF binary content — install poppler-utils for text extraction: `apt install poppler-utils` / `brew install poppler`)"
}

async function extractDOCX(filePath: string): Promise<string> {
  // Try docx2txt or unzip approach
  try {
    const { stdout } = await execFileAsync("sh", ["-c", `unzip -p "${filePath}" word/document.xml | sed 's/<[^>]*>//g' | sed '/^[[:space:]]*$/d'`])
    return stdout.slice(0, 50_000)
  } catch { /* not available */ }
  // Try python-docx approach
  try {
    const { stdout } = await execFileAsync("python3", ["-c", `
import sys
try:
  from docx import Document
  doc = Document(sys.argv[1])
  print('\\n'.join(p.text for p in doc.paragraphs))
except ImportError:
  print('(install python-docx: pip install python-docx)')
`, filePath])
    return stdout
  } catch {}
  return "(DOCX extraction failed — install python-docx or unzip)"
}

function extractHTML(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{3,}/g, "\n\n")
    .trim()
    .slice(0, 100_000)
}

const parameters = z.object({
  file: z.string().describe("Path to the document (PDF, DOCX, HTML, MD, TXT)"),
  maxChars: z
    .number()
    .optional()
    .default(20000)
    .describe("Maximum characters to return (default 20000)"),
  summary: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, ask agent to summarize rather than return raw text"),
})

export const DocUnderstandingTool = Tool.define<typeof parameters, Meta>("read-doc", {
  description:
    "Extract text from PDF, DOCX, HTML, Markdown, or plain text documents. Use for spec docs, API docs, error reports.",
  parameters,
  async execute({ file, maxChars, summary }) {
    if (!existsSync(file)) {
      return { title: "read-doc", output: `File not found: ${file}`, metadata: {} as Meta }
    }

    const ext = extname(file).toLowerCase()
    const name = basename(file)
    let content = ""

    try {
      switch (ext) {
        case ".pdf":
          content = await extractPDF(file)
          break
        case ".docx":
        case ".doc":
          content = await extractDOCX(file)
          break
        case ".html":
        case ".htm":
          content = extractHTML(await readFile(file, "utf8"))
          break
        case ".md":
        case ".txt":
        case ".rst":
        case ".adoc":
          content = await readFile(file, "utf8")
          break
        default:
          // Try as text
          content = await readFile(file, "utf8")
      }
    } catch (e) {
      return {
        title: "read-doc",
        output: `Failed to read document: ${e instanceof Error ? e.message : e}`,
        metadata: {} as Meta,
      }
    }

    const limit = maxChars ?? 20000
    const truncated = content.length > limit
    const text = content.slice(0, limit)

    const header = summary
      ? `Document: ${name} (${ext})\nPlease summarize the following content:\n\n`
      : `Document: ${name} (${ext})\n${"─".repeat(40)}\n\n`

    return {
      title: "read-doc",
      output: header + text + (truncated ? `\n\n[… truncated at ${limit} chars. Total: ${content.length}]` : ""),
      metadata: {
        file,
        ext,
        charCount: content.length,
        truncated,
      } as Meta,
    }
  },
})
