import z from "zod"
import { Tool } from "./tool"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import path from "path"

const DESCRIPTION = `AI-powered stack trace debugger. Paste an error + stack trace to get:
1. Root cause analysis — what actually went wrong and why
2. Relevant code snippet locating the exact failure point
3. Concrete fix suggestions with code examples
4. Related issues to check (similar patterns, edge cases)

Supports: JavaScript/TypeScript, Python, Java, Go, Rust, C#, Ruby, PHP stack traces.`

type Meta = Record<string, string | number | boolean | undefined>

function parseStackTrace(stackTrace: string): { frames: Array<{ file: string; line: number; fn: string }>; language: string } {
  const frames: Array<{ file: string; line: number; fn: string }> = []
  let language = "unknown"

  // JavaScript/TypeScript: "  at FunctionName (file.ts:12:34)"
  const jsPattern = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?/g
  let match = jsPattern.exec(stackTrace)
  if (match) {
    language = "typescript"
    do {
      frames.push({ fn: match[1] ?? "<anonymous>", file: match[2], line: parseInt(match[3]) })
    } while ((match = jsPattern.exec(stackTrace)) !== null)
    return { frames, language }
  }

  // Python: "  File \"file.py\", line 12, in function_name"
  const pyPattern = /File "(.+?)", line (\d+), in (.+)/g
  match = pyPattern.exec(stackTrace)
  if (match) {
    language = "python"
    do {
      frames.push({ file: match[1], line: parseInt(match[2]), fn: match[3] })
    } while ((match = pyPattern.exec(stackTrace)) !== null)
    return { frames, language }
  }

  // Go: "goroutine 1 [running]:\nmain.FuncName()\n\t/path/file.go:12 +0x1a"
  const goPattern = /(\S+\.go):(\d+)/g
  match = goPattern.exec(stackTrace)
  if (match) {
    language = "go"
    do {
      frames.push({ file: match[1], line: parseInt(match[2]), fn: "" })
    } while ((match = goPattern.exec(stackTrace)) !== null)
    return { frames, language }
  }

  // Java: "at com.example.Class.method(File.java:12)"
  const javaPattern = /at ([\w$.]+)\((\w+\.java):(\d+)\)/g
  match = javaPattern.exec(stackTrace)
  if (match) {
    language = "java"
    do {
      frames.push({ fn: match[1], file: match[2], line: parseInt(match[3]) })
    } while ((match = javaPattern.exec(stackTrace)) !== null)
    return { frames, language }
  }

  return { frames, language }
}

async function readRelevantCode(frames: Array<{ file: string; line: number; fn: string }>, root: string): Promise<string> {
  const snippets: string[] = []
  for (const frame of frames.slice(0, 3)) {
    const filePath = path.isAbsolute(frame.file) ? frame.file : path.join(root, frame.file)
    const content = await Filesystem.readText(filePath).catch(() => null)
    if (!content) continue
    const lines = content.split("\n")
    const start = Math.max(0, frame.line - 5)
    const end = Math.min(lines.length, frame.line + 5)
    const snippet = lines
      .slice(start, end)
      .map((l, i) => `${start + i + 1}${start + i + 1 === frame.line ? " ►" : "  "} ${l}`)
      .join("\n")
    snippets.push(`**${frame.file}:${frame.line}**\n\`\`\`\n${snippet}\n\`\`\``)
  }
  return snippets.join("\n\n")
}

const parameters = z.object({
  error_message: z.string().describe("The error message (e.g., 'TypeError: Cannot read property of undefined')"),
  stack_trace: z.string().describe("Full stack trace text"),
  language: z.string().optional().describe("Programming language (auto-detected if not provided)"),
  context: z.string().optional().describe("Additional context about what the code is doing when the error occurs"),
})

export const AiDebugTool = Tool.define<typeof parameters, Meta>("ai-debug", {
  description: DESCRIPTION,
  parameters,
  async execute(params, _ctx) {
    const { frames, language } = parseStackTrace(params.stack_trace)
    const detectedLang = params.language ?? language

    const root = Instance.directory ?? process.cwd()
    const codeSnippets = frames.length > 0 ? await readRelevantCode(frames, root) : ""

    const analysisLines: string[] = [
      `# AI Debug Analysis`,
      ``,
      `## Error`,
      `\`\`\``,
      params.error_message,
      `\`\`\``,
      ``,
      `## Detected Language`,
      detectedLang === "unknown" ? "Could not detect — please specify with \`language\` parameter" : detectedLang,
      ``,
      `## Stack Frames (${frames.length} detected)`,
    ]

    if (frames.length > 0) {
      for (const f of frames.slice(0, 5)) {
        analysisLines.push(`- \`${f.file}:${f.line}\` in \`${f.fn || "<top level>"}\``)
      }
    } else {
      analysisLines.push("_No structured frames detected in stack trace_")
    }

    if (codeSnippets) {
      analysisLines.push(``, `## Relevant Code`, codeSnippets)
    }

    analysisLines.push(
      ``,
      `## Root Cause Analysis`,
      `_Pass this output to the AI agent with the instruction: "Analyze this debug output and provide root cause + fix"_`,
      ``,
      `## Full Stack Trace`,
      `\`\`\``,
      params.stack_trace.slice(0, 3000),
      `\`\`\``,
    )

    if (params.context) {
      analysisLines.push(``, `## User Context`, params.context)
    }

    analysisLines.push(
      ``,
      `## Next Steps for AI`,
      `1. Identify the root cause based on the error message and stack frames`,
      `2. Look at the code snippets above for the exact failure point`,
      `3. Suggest a concrete code fix with before/after examples`,
      `4. List any related edge cases or similar patterns to check`,
    )

    return {
      output: analysisLines.join("\n"),
      title: `AI Debug: ${params.error_message.slice(0, 60)}`,
      metadata: {
        language: detectedLang,
        frameCount: frames.length,
        topFile: frames[0]?.file ?? "",
      } as Meta,
    }
  },
})
