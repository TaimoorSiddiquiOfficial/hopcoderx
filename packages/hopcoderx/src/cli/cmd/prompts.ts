import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Global } from "../../global"
import path from "path"
import fs from "fs/promises"

interface PromptTemplate {
  id: string
  name: string
  description: string
  template: string
  variables: string[]
  tags: string[]
  createdAt: string
  updatedAt: string
}

const PROMPTS_FILE = () => path.join(Global.Path.config, "prompts.json")

async function loadPrompts(): Promise<Record<string, PromptTemplate>> {
  try {
    const raw = await fs.readFile(PROMPTS_FILE(), "utf8")
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function savePrompts(prompts: Record<string, PromptTemplate>): Promise<void> {
  await fs.writeFile(PROMPTS_FILE(), JSON.stringify(prompts, null, 2), "utf8")
}

function extractVariables(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g) ?? []
  return [...new Set(matches.map((m) => m.slice(2, -2)))]
}

export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] ?? match
  })
}

export const PromptsCommand = cmd({
  command: "prompts <subcommand>",
  describe: "manage saved prompt templates with {{variable}} substitution",
  builder: (yargs: Argv) =>
    yargs
      .command("list", "list all prompt templates", {}, async () => {
        const prompts = await loadPrompts()
        const entries = Object.values(prompts)
        if (entries.length === 0) {
          UI.println(UI.Style.TEXT_DIM + "No prompt templates saved yet. Use 'hopcoderx prompts add' to create one." + UI.Style.TEXT_NORMAL)
          return
        }
        UI.println(UI.Style.TEXT_INFO_BOLD + "Saved prompt templates:" + UI.Style.TEXT_NORMAL)
        for (const p of entries) {
          const vars = p.variables.length ? ` [vars: ${p.variables.join(", ")}]` : ""
          UI.println(`  ${UI.Style.TEXT_SUCCESS_BOLD}${p.id}${UI.Style.TEXT_NORMAL} — ${p.name}${vars}`)
          if (p.description) UI.println(`      ${p.description}`)
        }
      })
      .command(
        "show <id>",
        "show a prompt template",
        (y) => y.positional("id", { type: "string", demandOption: true }),
        async (args) => {
          const prompts = await loadPrompts()
          const p = prompts[String(args.id)]
          if (!p) {
            UI.println(UI.Style.TEXT_DANGER_BOLD + `Template '${args.id}' not found` + UI.Style.TEXT_NORMAL)
            process.exit(1)
          }
          UI.println(UI.Style.TEXT_INFO_BOLD + `${p.name} (${p.id})` + UI.Style.TEXT_NORMAL)
          if (p.description) UI.println(p.description)
          if (p.variables.length) {
            UI.println(UI.Style.TEXT_INFO_BOLD + `Variables: ${p.variables.join(", ")}` + UI.Style.TEXT_NORMAL)
          }
          UI.println("\n" + p.template)
        },
      )
      .command(
        "add <id>",
        "add a new prompt template",
        (y) =>
          y
            .positional("id", { type: "string", demandOption: true })
            .option("name", { alias: "n", type: "string", demandOption: true })
            .option("description", { alias: "d", type: "string", default: "" })
            .option("template", { alias: "t", type: "string", demandOption: true, describe: "template text with {{variable}} placeholders" })
            .option("tags", { type: "string", describe: "comma-separated tags" }),
        async (args) => {
          const prompts = await loadPrompts()
          const id = String(args.id)
          const template = String(args.template)
          const variables = extractVariables(template)
          const now = new Date().toISOString()
          prompts[id] = {
            id,
            name: String(args.name),
            description: String(args.description),
            template,
            variables,
            tags: args.tags ? String(args.tags).split(",").map((t) => t.trim()) : [],
            createdAt: now,
            updatedAt: now,
          }
          await savePrompts(prompts)
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Template '${id}' saved` + UI.Style.TEXT_NORMAL)
          if (variables.length) {
            UI.println(`Variables detected: ${variables.join(", ")}`)
          }
        },
      )
      .command(
        "render <id>",
        "render a template with variable values",
        (y) =>
          y
            .positional("id", { type: "string", demandOption: true })
            .option("set", { alias: "s", type: "string", array: true, describe: "variable=value pairs" }),
        async (args) => {
          const prompts = await loadPrompts()
          const p = prompts[String(args.id)]
          if (!p) {
            UI.println(UI.Style.TEXT_DANGER_BOLD + `Template '${args.id}' not found` + UI.Style.TEXT_NORMAL)
            process.exit(1)
          }

          const vars: Record<string, string> = {}
          for (const kv of args.set ?? []) {
            const [k, ...rest] = String(kv).split("=")
            if (k) vars[k] = rest.join("=")
          }

          const missing = p.variables.filter((v) => !(v in vars))
          if (missing.length) {
            UI.println(UI.Style.TEXT_WARNING_BOLD + `Warning: unset variables: ${missing.join(", ")}` + UI.Style.TEXT_NORMAL)
          }

          UI.println(renderTemplate(p.template, vars))
        },
      )
      .command(
        "remove <id>",
        "remove a prompt template",
        (y) => y
          .positional("id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", description: "preview changes without applying", default: false }),
        async (args) => {
          const prompts = await loadPrompts()
          const id = String(args.id)
          if (!prompts[id]) {
            UI.println(UI.Style.TEXT_DANGER_BOLD + `Template '${id}' not found` + UI.Style.TEXT_NORMAL)
            process.exit(1)
          }
          if (args.dryRun) {
            UI.println(UI.Style.TEXT_INFO + `[dry-run] Would remove template '${id}'` + UI.Style.TEXT_NORMAL)
            return
          }
          delete prompts[id]
          await savePrompts(prompts)
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Template '${id}' removed` + UI.Style.TEXT_NORMAL)
        },
      )
      .command(
        "search <query>",
        "search templates by name, description, or tags",
        (y) => y.positional("query", { type: "string", demandOption: true }),
        async (args) => {
          const prompts = await loadPrompts()
          const q = String(args.query).toLowerCase()
          const matches = Object.values(prompts).filter(
            (p) =>
              p.id.toLowerCase().includes(q) ||
              p.name.toLowerCase().includes(q) ||
              p.description.toLowerCase().includes(q) ||
              p.tags.some((t) => t.toLowerCase().includes(q)),
          )
          if (!matches.length) {
            UI.println(UI.Style.TEXT_DIM + `No templates found for '${args.query}'` + UI.Style.TEXT_NORMAL)
            return
          }
          for (const p of matches) {
            UI.println(`  ${UI.Style.TEXT_SUCCESS_BOLD}${p.id}${UI.Style.TEXT_NORMAL} — ${p.name}`)
          }
        },
      )
      .demandCommand(1, "specify a subcommand: list, show, add, render, remove, search"),
  handler: async () => {},
})

export { type PromptTemplate, loadPrompts, renderTemplate as renderPromptTemplate }
