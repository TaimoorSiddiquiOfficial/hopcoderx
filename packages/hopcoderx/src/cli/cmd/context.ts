/**
 * hopcoderx context — Manage lazy context loading
 *
 * Usage:
 *   hopcoderx context list             List available context files
 *   hopcoderx context status           Show loaded context statistics
 *   hopcoderx context load <file>      Load a context file
 *   hopcoderx context unload <file>    Unload a context file
 *   hopcoderx context clear            Clear all loaded context
 *   hopcoderx context scan             Rescan context directory
 */

import { cmd } from "./cmd"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Config } from "../../config/config"
import { Context, ContextRegistry } from "../../context"
import { Instance } from "../../project/instance"
import path from "path"

export const ContextCommand = cmd({
  command: "context [subcommand] [file]",
  describe: "Manage lazy context loading from .hopcoderx/context/",
  builder: (yargs) =>
    yargs
      .positional("subcommand", {
        choices: ["list", "status", "load", "unload", "clear", "scan"] as const,
        describe: "Context management action",
      })
      .positional("file", {
        type: "string",
        describe: "Context file path or name",
      })
      .option("dir", {
        type: "string",
        describe: "Project directory (default: current)",
      })
      .option("json", {
        type: "boolean",
        describe: "Output as JSON",
        default: false,
      }),
  async handler(args) {
    await Instance.provide({
      directory: (args.dir as string) || process.cwd(),
      async fn() {
        const subcommand = args.subcommand as string | undefined
        const file = args.file as string | undefined
        const json = args.json as boolean

        UI.empty()

        if (!subcommand) {
          await showHelp(json)
          return
        }

        const config = await Config.get()
        const ctx = await Context.create({ projectDir: Instance.directory, config })

        if (!ctx.enabled) {
          if (json) {
            console.log(JSON.stringify({ enabled: false, message: "Context loading is disabled in config" }))
          } else {
            prompts.log.warn("Context loading is disabled in config")
            prompts.log.info("Enable with: hopcoderx config set context.enabled true")
          }
          return
        }

        switch (subcommand) {
          case "list":
            await listContexts(json)
            break
          case "status":
            await showStatus(json)
            break
          case "load":
            await loadFile(file, json)
            break
          case "unload":
            await unloadFile(file, json)
            break
          case "clear":
            await clearContext(json)
            break
          case "scan":
            await scanContext(json)
            break
          default:
            await showHelp(json)
        }
      },
    })
  },
})

async function showHelp(json: boolean) {
  if (json) {
    console.log(
      JSON.stringify({
        commands: {
          list: "List available context files",
          status: "Show loaded context statistics",
          load: "Load a context file (requires file argument)",
          unload: "Unload a context file (requires file argument)",
          clear: "Clear all loaded context",
          scan: "Rescan context directory",
        },
        examples: [
          "hopcoderx context list",
          "hopcoderx context status",
          "hopcoderx context load architecture.md",
          "hopcoderx context unload auth.md",
          "hopcoderx context clear",
        ],
      }),
    )
    return
  }

  prompts.intro("hopcoderx context — Manage lazy context loading")

  console.log(`
${UI.Style.TEXT_NORMAL_BOLD}Commands:${UI.Style.TEXT_NORMAL}
  list                    List available context files
  status                  Show loaded context statistics
  load <file>             Load a context file
  unload <file>           Unload a context file
  clear                   Clear all loaded context
  scan                    Rescan context directory

${UI.Style.TEXT_NORMAL_BOLD}Examples:${UI.Style.TEXT_NORMAL}
  hopcoderx context list
  hopcoderx context status
  hopcoderx context load architecture.md
  hopcoderx context unload auth.md
  hopcoderx context clear
`)

  prompts.outro("Done")
}

async function listContexts(json: boolean) {
  const ctx = Context.get()
  if (!ctx) {
    if (json) {
      console.log(JSON.stringify({ error: "Context not initialized" }))
    } else {
      prompts.log.error("Context not initialized")
    }
    return
  }

  const files = ctx.registry.list()

  if (files.length === 0) {
    if (json) {
      console.log(JSON.stringify({ files: [], message: "No context files found" }))
    } else {
      prompts.log.info("No context files found in .hopcoderx/context/")
      prompts.log.info("Create markdown or JSON files to add context")
    }
    return
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          files: files.map((f) => ({
            path: f.relativePath,
            name: f.name,
            description: f.description,
            tags: f.tags,
            categories: f.categories,
            tokens: f.tokens,
            format: f.format,
          })),
          total: files.length,
          totalTokens: ctx.registry.getTotalTokens(),
        },
        null,
        2,
      ),
    )
    return
  }

  prompts.log.info(`Found ${files.length} context file(s)`)

  const lines = files.map((f) => {
    const icon = f.format === "markdown" ? "📝" : f.format === "json" ? "📋" : "📄"
    const tags = f.tags.length > 0 ? ` [${f.tags.join(", ")}]` : ""
    return `${icon} ${f.relativePath}${tags}\n   ${f.description || "No description"}\n   ${f.tokens} tokens`
  })

  console.log(lines.join("\n\n"))

  prompts.outro(`Total: ${ctx.registry.getTotalTokens().toLocaleString()} tokens`)
}

async function showStatus(json: boolean) {
  const stats = Context.getStats()

  if (json) {
    console.log(JSON.stringify(stats, null, 2))
    return
  }

  if (!stats?.enabled) {
    prompts.log.warn("Context loading is disabled")
    return
  }

  prompts.log.info("Context Loading Status")

  const utilizationBar = "█".repeat(Math.round(stats.utilizationPercent / 5)) + "░".repeat(20 - Math.round(stats.utilizationPercent / 5))

  console.log(`
${UI.Style.TEXT_NORMAL_BOLD}Loaded Files:${UI.Style.TEXT_NORMAL}   ${stats.loadedFiles}
${UI.Style.TEXT_NORMAL_BOLD}Tokens:${UI.Style.TEXT_NORMAL}         ${stats.totalTokens.toLocaleString()}
${UI.Style.TEXT_NORMAL_BOLD}Usage:${UI.Style.TEXT_NORMAL}          ${utilizationBar} ${stats.utilizationPercent}%
${UI.Style.TEXT_NORMAL_BOLD}Remaining:${UI.Style.TEXT_NORMAL}      ${(stats.maxTokens - stats.totalTokens).toLocaleString()} tokens
`)

  const loadedPaths = Context.getLoadedPaths()
  if (loadedPaths.length > 0) {
    console.log(`${UI.Style.TEXT_NORMAL_BOLD}Currently Loaded:${UI.Style.TEXT_NORMAL}`)
    loadedPaths.forEach((p) => console.log(`  • ${p}`))
  } else {
    console.log(`${UI.Style.TEXT_NORMAL_BOLD}Currently Loaded:${UI.Style.TEXT_NORMAL}  (none)`)
  }

  prompts.outro("Done")
}

async function loadFile(filePath: string | undefined, json: boolean) {
  if (!filePath) {
    if (json) {
      console.log(JSON.stringify({ error: "File argument required" }))
    } else {
      prompts.log.error("File argument required")
      console.log("Usage: hopcoderx context load <file>")
    }
    return
  }

  const success = await Context.load(filePath)

  if (json) {
    console.log(JSON.stringify({ loaded: success, file: filePath }))
    return
  }

  if (success) {
    prompts.log.success(`Loaded: ${filePath}`)
  } else {
    prompts.log.error(`Failed to load: ${filePath}`)
    prompts.log.info("Check that the file exists in .hopcoderx/context/")
  }

  prompts.outro("Done")
}

async function unloadFile(filePath: string | undefined, json: boolean) {
  if (!filePath) {
    if (json) {
      console.log(JSON.stringify({ error: "File argument required" }))
    } else {
      prompts.log.error("File argument required")
      console.log("Usage: hopcoderx context unload <file>")
    }
    return
  }

  const success = Context.unload(filePath)

  if (json) {
    console.log(JSON.stringify({ unloaded: success, file: filePath }))
    return
  }

  if (success) {
    prompts.log.success(`Unloaded: ${filePath}`)
  } else {
    prompts.log.warn(`File was not loaded: ${filePath}`)
  }

  prompts.outro("Done")
}

async function clearContext(json: boolean) {
  Context.clear()

  if (json) {
    console.log(JSON.stringify({ cleared: true }))
    return
  }

  prompts.log.success("Cleared all loaded context")
  prompts.outro("Done")
}

async function scanContext(json: boolean) {
  const ctx = Context.get()
  if (!ctx) {
    if (json) {
      console.log(JSON.stringify({ error: "Context not initialized" }))
    } else {
      prompts.log.error("Context not initialized")
    }
    return
  }

  const config = await Config.get()
  await ctx.registry.scan(config.context?.include, config.context?.exclude)

  const files = ctx.registry.list()

  if (json) {
    console.log(
      JSON.stringify(
        {
          scanned: true,
          directory: ctx.registry.getDirectory(),
          fileCount: files.length,
          totalTokens: ctx.registry.getTotalTokens(),
        },
        null,
        2,
      ),
    )
    return
  }

  prompts.log.success(`Scanned: ${ctx.registry.getDirectory()}`)
  prompts.log.info(`Found ${files.length} context file(s)`)
  prompts.outro(`Total: ${ctx.registry.getTotalTokens().toLocaleString()} tokens`)
}
