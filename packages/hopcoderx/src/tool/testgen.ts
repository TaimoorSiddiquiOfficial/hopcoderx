import z from "zod"
import { Tool } from "./tool"
import { BashTool } from "./bash"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import path from "path"
import { $ } from "bun"

const log = Log.create({ service: "testgen" })

const DESCRIPTION = `Automatically generate and run unit tests for a given source file or function.

Steps performed:
1. Reads the source file to understand exported functions, classes, and types
2. Generates a comprehensive test file using the project's existing test framework
3. Runs the tests and iterates on failures (up to 3 times)
4. Returns a summary of test results

Use this tool to quickly add test coverage for new or untested code.`

type Meta = Record<string, string | number | boolean | undefined>

const parameters = z.object({
  file: z.string().describe("Path to the source file to generate tests for (relative to project root)"),
  framework: z
    .enum(["auto", "bun", "vitest", "jest", "mocha", "pytest", "go-test"])
    .default("auto")
    .describe("Test framework to use. 'auto' detects from package.json"),
  focus: z.string().optional().describe("Specific function or class name to focus tests on (optional)"),
  outputFile: z
    .string()
    .optional()
    .describe("Where to write the test file (defaults to <file>.test.<ext> or __tests__/<file>)"),
})

export const TestgenTool = Tool.define<typeof parameters, Meta>("testgen", {
  description: DESCRIPTION,
  parameters,
  async execute({ file, framework, focus, outputFile }, ctx) {
    const dir = Instance.directory
    const absFile = path.isAbsolute(file) ? file : path.join(dir, file)

    let source: string
    try {
      source = await Filesystem.readText(absFile)
    } catch {
      return {
        title: `testgen: ${file}`,
        metadata: {} as Meta,
        output: `Error: Could not read file "${file}". Make sure the path is correct.`,
      }
    }

    // Auto-detect framework
    let detectedFramework: "auto" | "bun" | "vitest" | "jest" | "mocha" | "pytest" | "go-test" = framework
    if (framework === "auto") {
      detectedFramework = (await detectFramework(dir)) as typeof detectedFramework
    }

    // Determine output path
    const ext = path.extname(file)
    const base = path.basename(file, ext)
    const fileDir = path.dirname(file)
    const testExt = [".py"].includes(ext) ? ext : ext || ".ts"
    const resolvedOutput =
      outputFile ??
      (await findTestDir(dir, fileDir)
        .then((d) => path.join(d, `${base}.test${testExt}`))
        .catch(() => path.join(fileDir, `${base}.test${testExt}`)))

    const absOutput = path.isAbsolute(resolvedOutput) ? resolvedOutput : path.join(dir, resolvedOutput)

    // Check if test file already exists
    const exists = await Filesystem.exists(absOutput)
    if (exists) {
      return {
        title: `testgen: ${file}`,
        metadata: { framework: detectedFramework, outputFile: resolvedOutput },
        output: `Test file already exists at "${resolvedOutput}". Delete it first or specify a different --outputFile to regenerate.`,
      }
    }

    // Generate test content using the LLM via the bash tool approach
    const runCmd = getRunCommand(detectedFramework as string, resolvedOutput)
    const focusHint = focus ? ` Focus specifically on the \`${focus}\` function/class.` : ""

    // Build a structured prompt that the agent will use
    const prompt = [
      `Source file: ${file}`,
      `Framework: ${detectedFramework}`,
      `Output: ${resolvedOutput}`,
      `Run command: ${runCmd}`,
      "",
      focus ? `Focus on: ${focus}` : "Cover all exported symbols",
      "",
      "Source code:",
      "```",
      source.slice(0, 8000),
      "```",
    ].join("\n")

    log.info("testgen request", { file, framework: detectedFramework, output: resolvedOutput })

    return {
      title: `testgen: ${file}`,
      metadata: {
        framework: detectedFramework,
        sourceFile: file,
        outputFile: resolvedOutput,
        runCommand: runCmd,
      },
      output: [
        `## Test Generation Plan for \`${file}\``,
        "",
        `**Framework detected:** ${detectedFramework}`,
        `**Output file:** ${resolvedOutput}`,
        `**Run command:** \`${runCmd}\``,
        focusHint ? `**Focus:** ${focus}` : "",
        "",
        "### Instructions for agent",
        `1. Write a comprehensive test file at \`${resolvedOutput}\` for the source above`,
        "2. Include: happy path, edge cases, error handling, boundary values",
        "3. Import from the source file correctly",
        `4. Run \`${runCmd}\` and fix any failures (iterate up to 3 times)`,
        "5. Report final pass/fail summary",
        "",
        "### Source analysis",
        prompt,
      ]
        .filter(Boolean)
        .join("\n"),
    }
  },
})

async function detectFramework(dir: string): Promise<string> {
  try {
    const pkg = await Filesystem.readJson(path.join(dir, "package.json"))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (deps.vitest) return "vitest"
    if (deps.jest || deps["@jest/core"]) return "jest"
    if (deps.mocha) return "mocha"
    if (deps.bun || pkg.runtime === "bun") return "bun"
    // Check lockfile
    const hasBunLock = await Filesystem.exists(path.join(dir, "bun.lockb"))
    if (hasBunLock) return "bun"
    return "jest"
  } catch {
    try {
      const hasGoMod = await Filesystem.exists(path.join(dir, "go.mod"))
      if (hasGoMod) return "go-test"
      const hasSetupPy = await Filesystem.exists(path.join(dir, "setup.py"))
      const hasPyProject = await Filesystem.exists(path.join(dir, "pyproject.toml"))
      if (hasSetupPy || hasPyProject) return "pytest"
    } catch {}
    return "jest"
  }
}

async function findTestDir(rootDir: string, fileDir: string): Promise<string> {
  const candidates = [
    path.join(rootDir, "__tests__"),
    path.join(rootDir, "test"),
    path.join(rootDir, "tests"),
    path.join(fileDir, "__tests__"),
    path.join(fileDir, "test"),
  ]
  for (const c of candidates) {
    if (await Filesystem.exists(c)) return c
  }
  return fileDir
}

function getRunCommand(framework: string, testFile: string): string {
  switch (framework) {
    case "vitest":
      return `npx vitest run ${testFile}`
    case "jest":
      return `npx jest ${testFile}`
    case "mocha":
      return `npx mocha ${testFile}`
    case "bun":
      return `bun test ${testFile}`
    case "pytest":
      return `python -m pytest ${testFile} -v`
    case "go-test":
      return `go test ./...`
    default:
      return `bun test ${testFile}`
  }
}
