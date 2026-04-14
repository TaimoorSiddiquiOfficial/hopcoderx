/**
 * hopcoderx new — Scaffold new commands, tools, skills, and agents
 *
 * Usage:
 *   hopcoderx new command <name>     Create a new CLI command
 *   hopcoderx new tool <name>        Create a new tool implementation
 *   hopcoderx new skill <name>       Create a new skill markdown file
 *   hopcoderx new agent <name>       Create a new agent definition
 *   hopcoderx new plugin <name>      Create a new plugin package structure
 */

import { cmd } from "./cmd"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { promises as fs } from "fs"
import path from "path"
import { Global } from "../../global"
import { Instance } from "../../project/instance"

// ─── Templates ────────────────────────────────────────────────────────────────

const COMMAND_TEMPLATE = `/**
 * hopcoderx {{name}} — {{description}}
 *
 * Usage:
 *   hopcoderx {{name}} [options]
 */

import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"

export const {{pascalName}}Command = cmd({
  command: "{{name}}",
  describe: "{{description}}",
  builder: (yargs: Argv) =>
    yargs
      .option("verbose", {
        type: "boolean",
        describe: "Enable verbose output",
        default: false,
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("{{pascalName}}")

        // TODO: Implement command logic here
        prompts.log.info("Command executed successfully")

        prompts.outro("Done")
      },
    })
  },
})
`

const TOOL_TEMPLATE = `/**
 * {{name}} tool — {{description}}
 */

import z from "zod"
import { Tool } from "../tool/tool"
import { UI } from "../ui"

export const {{pascalName}}Tool = Tool.define(
  "{{name}}",
  {
    description: "{{description}}",
    parameters: z.object({
      // TODO: Define your parameters here
      input: z.string().describe("Input parameter"),
    }),
    async execute(args, ctx) {
      // TODO: Implement tool logic here
      UI.println("Tool executed: " + args.input)

      return {
        title: "{{pascalName}} completed",
        metadata: {},
        output: "Success",
      }
    },
  },
  {
    capabilities: ["read-only"], // or "filesystem", "network", "execution", "ai"
  },
)
`

const SKILL_TEMPLATE = `---
name: {{name}}
description: {{description}}
---

# {{pascalName}} Skill

## Purpose

This skill provides expertise in {{domain}}.

## Capabilities

- Capability 1
- Capability 2
- Capability 3

## Guidelines

1. Always follow best practices for {{domain}}
2. Ask clarifying questions when requirements are unclear
3. Provide examples and explanations

## Tools

This skill uses the following tools:
- read
- write
- bash

## Examples

### Example 1

User: "How do I implement X?"
Assistant: "Here's how to implement X..."

### Example 2

User: "Review this code for Y"
Assistant: "Looking at the code, I notice..."
`

const AGENT_TEMPLATE = `---
name: {{name}}
description: {{description}}
mode: all  # subagent, primary, or all
---

# {{pascalName}} Agent

## Role

You are {{name}}, {{role_description}}.

## Expertise

- Area of expertise 1
- Area of expertise 2
- Area of expertise 3

## Behavior

1. Always maintain a professional and helpful tone
2. Ask clarifying questions when needed
3. Provide step-by-step explanations
4. Cite sources when referencing external information

## Tools

You have access to all standard tools. Use them judiciously.

## Examples

### Example Interaction

User: "{{example_task}}"
Assistant: "I'll help you with that. Let me start by..."
`

const PLUGIN_TEMPLATE = `/**
 * {{name}} plugin for HopCoderX
 */

import type { Plugin } from "@hopcoderx/plugin"

export default {
  name: "{{name}}",
  version: "1.0.0",
  description: "{{description}}",

  async activate(ctx) {
    // Called when plugin is loaded
    ctx.log.info("{{name}} plugin activated")
  },

  async deactivate(ctx) {
    // Called when plugin is unloaded
    ctx.log.info("{{name}} plugin deactivated")
  },

  // Register custom commands
  commands: [
    {
      name: "{{name}}-command",
      description: "A command from the {{name}} plugin",
      async handler(args, ctx) {
        // Command implementation
      },
    },
  ],

  // Register custom tools
  tools: [],

  // Register hooks
  hooks: {
    // "before-tool-call": async (ctx) => {},
    // "after-agent-reply": async (ctx) => {},
  },
}
`

const PLUGIN_PACKAGE_TEMPLATE = `{
  "name": "{{package-name}}",
  "version": "1.0.0",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "@hopcoderx/plugin": "*"
  }
}
`

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("")
}

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]/g, "-")
    .toLowerCase()
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => vars[key.trim()] || "")
}

async function writeFileIfNotExists(filePath: string, content: string, overwrite: boolean = false): Promise<boolean> {
  const exists = await fs.access(filePath).then(() => true).catch(() => false)

  if (exists && !overwrite) {
    return false
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, "utf8")
  return true
}

// ─── Scaffolders ──────────────────────────────────────────────────────────────

interface ScaffoldOptions {
  name: string
  description: string
  outputDir: string
  overwrite?: boolean
}

async function scaffoldCommand(opts: ScaffoldOptions): Promise<void> {
  const vars = {
    name: toKebabCase(opts.name),
    pascalName: toPascalCase(opts.name),
    description: opts.description || "New CLI command",
  }

  const fileName = `${vars.name}.ts`
  const filePath = path.join(opts.outputDir, "src", "cli", "cmd", fileName)

  const content = renderTemplate(COMMAND_TEMPLATE, vars)
  const created = await writeFileIfNotExists(filePath, content, opts.overwrite)

  if (!created) {
    throw new Error(`File already exists: ${filePath}`)
  }

  // Also need to register in command-groups
  UI.println(`  Created: ${filePath}`)
  UI.println(UI.Style.TEXT_DIM + `  Next: Add {{pascalName}}Command to src/cli/command-groups/*.ts`.replace(/\{\{pascalName\}\}/, vars.pascalName) + UI.Style.TEXT_NORMAL)
}

async function scaffoldTool(opts: ScaffoldOptions): Promise<void> {
  const vars = {
    name: toKebabCase(opts.name),
    pascalName: toPascalCase(opts.name),
    description: opts.description || "New tool",
  }

  const fileName = `${vars.name}.ts`
  const filePath = path.join(opts.outputDir, "src", "tool", fileName)

  const content = renderTemplate(TOOL_TEMPLATE, vars)
  const created = await writeFileIfNotExists(filePath, content, opts.overwrite)

  if (!created) {
    throw new Error(`File already exists: ${filePath}`)
  }

  UI.println(`  Created: ${filePath}`)
}

async function scaffoldSkill(opts: ScaffoldOptions): Promise<void> {
  const vars = {
    name: toKebabCase(opts.name),
    pascalName: toPascalCase(opts.name),
    description: opts.description || "New skill",
    domain: "your domain",
  }

  const fileName = `${vars.name}.md`
  const filePath = path.join(opts.outputDir, ".hopcoderx", "skill", fileName)

  const content = renderTemplate(SKILL_TEMPLATE, vars)
  const created = await writeFileIfNotExists(filePath, content, opts.overwrite)

  if (!created) {
    throw new Error(`File already exists: ${filePath}`)
  }

  UI.println(`  Created: ${filePath}`)
}

async function scaffoldAgent(opts: ScaffoldOptions): Promise<void> {
  const vars = {
    name: toKebabCase(opts.name),
    pascalName: toPascalCase(opts.name),
    description: opts.description || "New agent",
    role_description: "a specialized AI assistant",
    example_task: "Help me with a task",
  }

  const fileName = `${vars.name}.md`
  const filePath = path.join(opts.outputDir, ".hopcoderx", "agent", fileName)

  const content = renderTemplate(AGENT_TEMPLATE, vars)
  const created = await writeFileIfNotExists(filePath, content, opts.overwrite)

  if (!created) {
    throw new Error(`File already exists: ${filePath}`)
  }

  UI.println(`  Created: ${filePath}`)
}

async function scaffoldPlugin(opts: ScaffoldOptions): Promise<void> {
  const vars = {
    name: toKebabCase(opts.name),
    pascalName: toPascalCase(opts.name),
    description: opts.description || "New plugin",
    "package-name": `@hopcoderx/${toKebabCase(opts.name)}`,
  }

  const pluginDir = path.join(opts.outputDir, "packages", vars.name)

  // Create src/index.ts
  const indexContent = renderTemplate(PLUGIN_TEMPLATE, vars)
  const indexPath = path.join(pluginDir, "src", "index.ts")
  await writeFileIfNotExists(indexPath, indexContent, opts.overwrite)
  UI.println(`  Created: ${indexPath}`)

  // Create package.json
  const pkgContent = renderTemplate(PLUGIN_PACKAGE_TEMPLATE, vars)
  const pkgPath = path.join(pluginDir, "package.json")
  await writeFileIfNotExists(pkgPath, pkgContent, opts.overwrite)
  UI.println(`  Created: ${pkgPath}`)

  // Create tsconfig.json
  const tsconfig = {
    extends: "../../tsconfig.json",
    compilerOptions: {
      outDir: "./dist",
      rootDir: "./src",
    },
    include: ["src/**/*"],
  }
  const tsconfigPath = path.join(pluginDir, "tsconfig.json")
  await writeFileIfNotExists(tsconfigPath, JSON.stringify(tsconfig, null, 2), opts.overwrite)
  UI.println(`  Created: ${tsconfigPath}`)
}

// ─── CLI Command ──────────────────────────────────────────────────────────────

export const NewCommand = cmd({
  command: "new <type> <name>",
  describe: "Scaffold new commands, tools, skills, agents, and plugins",
  builder: (yargs) =>
    yargs
      .positional("type", {
        choices: ["command", "tool", "skill", "agent", "plugin"] as const,
        describe: "Type of scaffold",
      })
      .positional("name", {
        type: "string",
        describe: "Name for the new component",
      })
      .option("description", {
        alias: "d",
        type: "string",
        describe: "Description",
      })
      .option("dir", {
        type: "string",
        describe: "Output directory (default: current project)",
      })
      .option("overwrite", {
        type: "boolean",
        describe: "Overwrite existing files",
        default: false,
      }),
  async handler(args) {
    const type = args.type as string
    const name = args.name as string

    if (!name || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
      UI.println(UI.Style.TEXT_DANGER + "Invalid name. Use letters, numbers, hyphens, and underscores." + UI.Style.TEXT_NORMAL)
      process.exit(1)
    }

    UI.empty()
    prompts.intro(`Create ${type}: ${name}`)

    const description =
      args.description ||
      (await prompts.text({
        message: "Description",
        placeholder: `Describe the ${type}`,
      }))

    if (prompts.isCancel(description)) {
      prompts.outro("Cancelled")
      return
    }

    const outputDir = (args.dir as string) || process.cwd()

    const opts: ScaffoldOptions = {
      name,
      description: description || `New ${type}`,
      outputDir,
      overwrite: args.overwrite as boolean,
    }

    const spinner = prompts.spinner()
    spinner.start(`Creating ${type}...`)

    try {
      switch (type) {
        case "command":
          await scaffoldCommand(opts)
          break
        case "tool":
          await scaffoldTool(opts)
          break
        case "skill":
          await scaffoldSkill(opts)
          break
        case "agent":
          await scaffoldAgent(opts)
          break
        case "plugin":
          await scaffoldPlugin(opts)
          break
        default:
          throw new Error(`Unknown type: ${type}`)
      }

      spinner.stop()
      prompts.log.success(`${type} created successfully!`)
      prompts.log.info("Edit the generated file(s) to implement your logic")
    } catch (e: any) {
      spinner.stop()
      prompts.log.error(e.message)
      prompts.outro("Failed")
      process.exit(1)
    }

    prompts.outro("Done")
  },
})
