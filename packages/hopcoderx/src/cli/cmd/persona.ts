import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Global } from "../../global"
import path from "path"
import fs from "fs/promises"

interface PersonaConfig {
  id: string
  name: string
  description: string
  systemPrompt: string
  model?: string
  temperature?: number
}

const PERSONAS_FILE = () => path.join(Global.Path.config, "personas.json")

async function loadPersonas(): Promise<Record<string, PersonaConfig>> {
  try {
    const raw = await fs.readFile(PERSONAS_FILE(), "utf8")
    return JSON.parse(raw)
  } catch {
    return defaultPersonas()
  }
}

async function savePersonas(personas: Record<string, PersonaConfig>): Promise<void> {
  await fs.writeFile(PERSONAS_FILE(), JSON.stringify(personas, null, 2), "utf8")
}

function defaultPersonas(): Record<string, PersonaConfig> {
  return {
    frontend: {
      id: "frontend",
      name: "Frontend Specialist",
      description: "Expert in React, TypeScript, CSS, and UX",
      systemPrompt:
        "You are a frontend specialist with deep expertise in React, TypeScript, Tailwind CSS, and modern UX patterns. You prioritize accessibility, performance, and clean component design. When reviewing code, focus on component composition, hook patterns, bundle size, and user experience.",
    },
    security: {
      id: "security",
      name: "Security Auditor",
      description: "Security-first code review and vulnerability analysis",
      systemPrompt:
        "You are a security specialist focused on identifying vulnerabilities, insecure patterns, and attack vectors in code. You know OWASP Top 10, common CVEs, and secure coding practices. When analyzing code, check for injection flaws, broken auth, sensitive data exposure, XXE, broken access control, security misconfigurations, XSS, insecure deserialization, and insufficient logging.",
    },
    performance: {
      id: "performance",
      name: "Performance Engineer",
      description: "Optimization, profiling, and efficiency analysis",
      systemPrompt:
        "You are a performance engineer specializing in profiling, optimization, and efficiency. You analyze algorithmic complexity, memory usage, I/O patterns, caching strategies, and database query optimization. You suggest concrete improvements with measurable impact and can reason about CPU, memory, and network bottlenecks.",
    },
    refactor: {
      id: "refactor",
      name: "Refactoring Expert",
      description: "Clean code, design patterns, and code quality",
      systemPrompt:
        "You are a refactoring expert who applies SOLID principles, design patterns, and clean code practices. You identify code smells, suggest extractions and abstractions, improve naming, and reduce complexity while maintaining behavior. You prefer incremental, safe refactors with clear before/after reasoning.",
    },
    docs: {
      id: "docs",
      name: "Documentation Writer",
      description: "Technical writing and documentation generation",
      systemPrompt:
        "You are a technical writer specializing in developer documentation. You write clear, concise API docs, README files, architecture diagrams (Mermaid), and inline code comments. You understand both beginner and expert audiences and tailor documentation accordingly. You follow the Diátaxis framework: tutorials, how-to guides, reference docs, and explanations.",
    },
    db: {
      id: "db",
      name: "Database Architect",
      description: "SQL, NoSQL, query optimization, and data modeling",
      systemPrompt:
        "You are a database architect with expertise in SQL (PostgreSQL, MySQL, SQLite) and NoSQL (MongoDB, Redis, DynamoDB). You design efficient schemas, write optimized queries, analyze execution plans, and suggest indexing strategies. You understand ACID properties, CAP theorem, and data normalization vs denormalization trade-offs.",
    },
  }
}

export const PersonaCommand = cmd({
  command: "persona <subcommand>",
  describe: "manage named agent specialist personas",
  builder: (yargs: Argv) =>
    yargs
      .command("list", "list all personas", {}, async () => {
        const personas = await loadPersonas()
        UI.println(UI.Style.TEXT_INFO_BOLD + "Available personas:" + UI.Style.TEXT_NORMAL)
        for (const [id, p] of Object.entries(personas)) {
          UI.println(`  ${UI.Style.TEXT_SUCCESS_BOLD}${id}${UI.Style.TEXT_NORMAL} — ${p.name}: ${p.description}`)
        }
      })
      .command(
        "show <id>",
        "show a persona's system prompt",
        (y) => y.positional("id", { type: "string", demandOption: true }),
        async (args) => {
          const personas = await loadPersonas()
          const p = personas[String(args.id)]
          if (!p) {
            UI.println(UI.Style.TEXT_DANGER_BOLD + `Persona '${args.id}' not found` + UI.Style.TEXT_NORMAL)
            process.exit(1)
          }
          UI.println(UI.Style.TEXT_INFO_BOLD + `${p.name} (${p.id})` + UI.Style.TEXT_NORMAL)
          UI.println(p.description)
          UI.println("\n" + UI.Style.TEXT_INFO_BOLD + "System prompt:" + UI.Style.TEXT_NORMAL)
          UI.println(p.systemPrompt)
        },
      )
      .command(
        "add <id>",
        "add a new persona",
        (y) =>
          y
            .positional("id", { type: "string", demandOption: true })
            .option("name", { type: "string", demandOption: true })
            .option("description", { alias: "d", type: "string", default: "" })
            .option("prompt", { alias: "p", type: "string", demandOption: true, describe: "system prompt text" })
            .option("model", { type: "string", describe: "preferred model ID" }),
        async (args) => {
          const personas = await loadPersonas()
          const id = String(args.id)
          personas[id] = {
            id,
            name: String(args.name),
            description: String(args.description),
            systemPrompt: String(args.prompt),
            model: args.model ? String(args.model) : undefined,
          }
          await savePersonas(personas)
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Persona '${id}' saved` + UI.Style.TEXT_NORMAL)
        },
      )
      .command(
        "remove <id>",
        "remove a persona",
        (y) => y
          .positional("id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", description: "preview changes without applying", default: false }),
        async (args) => {
          const personas = await loadPersonas()
          const id = String(args.id)
          if (!personas[id]) {
            UI.println(UI.Style.TEXT_DANGER_BOLD + `Persona '${id}' not found` + UI.Style.TEXT_NORMAL)
            process.exit(1)
          }
          if (args.dryRun) {
            UI.println(UI.Style.TEXT_INFO + `[dry-run] Would remove persona '${id}'` + UI.Style.TEXT_NORMAL)
            return
          }
          delete personas[id]
          await savePersonas(personas)
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Persona '${id}' removed` + UI.Style.TEXT_NORMAL)
        },
      )
      .command(
        "reset",
        "reset to default personas",
        (y) => y.option("dry-run", { type: "boolean", description: "preview changes without applying", default: false }),
        async (args) => {
          if (args.dryRun) {
            UI.println(UI.Style.TEXT_INFO + "[dry-run] Would reset personas to defaults" + UI.Style.TEXT_NORMAL)
            return
          }
          await savePersonas(defaultPersonas())
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Personas reset to defaults" + UI.Style.TEXT_NORMAL)
        },
      )
      .command(
        "edit <id>",
        "edit a persona's configuration",
        (y) =>
          y
            .positional("id", { type: "string", demandOption: true })
            .option("name", { type: "string", describe: "persona name" })
            .option("description", { alias: "d", type: "string", describe: "persona description" })
            .option("prompt", { alias: "p", type: "string", describe: "system prompt text" })
            .option("model", { type: "string", describe: "preferred model ID" })
            .option("temperature", { type: "number", describe: "temperature 0-2", default: 0.7 }),
        async (args) => {
          const personas = await loadPersonas()
          const id = String(args.id)
          const p = personas[id]
          if (!p) {
            UI.println(UI.Style.TEXT_DANGER_BOLD + `Persona '${id}' not found` + UI.Style.TEXT_NORMAL)
            process.exit(1)
          }
          if (args.name) p.name = String(args.name)
          if (args.description) p.description = String(args.description)
          if (args.prompt) p.systemPrompt = String(args.prompt)
          if (args.model) p.model = String(args.model)
          if (args.temperature !== undefined) p.temperature = Number(args.temperature)
          await savePersonas(personas)
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Persona '${id}' updated` + UI.Style.TEXT_NORMAL)
        },
      )
      .demandCommand(1, "specify a subcommand: list, show, add, remove, reset, edit"),
  handler: async () => {},
})

export async function getPersonaPrompt(id: string): Promise<string | undefined> {
  const personas = await loadPersonas()
  return personas[id]?.systemPrompt
}

export { defaultPersonas, loadPersonas, type PersonaConfig }
