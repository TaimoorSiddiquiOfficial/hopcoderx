import { existsSync, readdirSync } from "fs"
import { readFile } from "fs/promises"
import { join } from "path"
import { HubWorkflows } from "./workflows"
import { HubBundles } from "./bundles"
import { HubPresets } from "./presets"

export namespace HubSuggest {
  export interface Suggestion {
    workflowID: string
    workflowName: string
    score: number
    reasons: string[]
    command: string
  }

  interface Signal {
    workflowID: string
    reason: string
    weight: number
  }

  function detectSignals(dir: string): Signal[] {
    const signals: Signal[] = []
    let files: string[] = []
    try {
      files = readdirSync(dir)
    } catch {
      return signals
    }

    const has = (name: string) => files.includes(name) || existsSync(join(dir, name))
    const hasExt = (ext: string) => files.some((f) => f.endsWith(ext))
    const hasDir = (name: string) => existsSync(join(dir, name)) && readdirSync(join(dir, name)).length > 0

    // ── GitHub / VCS signals ──────────────────────────────────────────────────
    if (hasDir(".github")) {
      signals.push({ workflowID: "workflow:triage", reason: ".github/ directory detected", weight: 3 })
      signals.push({ workflowID: "workflow:code-review", reason: ".github/ directory detected", weight: 2 })
    }
    if (has("CODEOWNERS") || has(".github/CODEOWNERS")) {
      signals.push({ workflowID: "workflow:triage", reason: "CODEOWNERS file found", weight: 2 })
    }

    // ── Infrastructure signals ────────────────────────────────────────────────
    if (hasExt(".tf") || has("terraform.tfvars") || hasDir(".terraform")) {
      signals.push({ workflowID: "workflow:cloud-infra", reason: "Terraform files detected", weight: 4 })
    }
    if (has("Dockerfile") || has("docker-compose.yml") || has("docker-compose.yaml")) {
      signals.push({ workflowID: "workflow:cloud-infra", reason: "Docker configuration detected", weight: 2 })
    }
    if (has("kubernetes") || hasDir("k8s") || hasDir("manifests") || hasExt(".yaml") && files.some((f) => f.endsWith(".yaml"))) {
      // Only score k8s if there are actual k8s-flavored yaml files
      const yamlFiles = files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      if (yamlFiles.length > 0) {
        signals.push({ workflowID: "workflow:cloud-infra", reason: "YAML manifests detected (possible k8s)", weight: 1 })
      }
    }
    if (has("Pulumi.yaml") || has("Pulumi.yml") || hasDir("pulumi")) {
      signals.push({ workflowID: "workflow:cloud-infra", reason: "Pulumi project detected", weight: 4 })
    }

    // ── Full-stack / web dev signals ──────────────────────────────────────────
    if (has("package.json")) {
      signals.push({ workflowID: "workflow:fullstack", reason: "package.json found", weight: 1 })
      try {
        const pkg = JSON.parse(require("fs").readFileSync(join(dir, "package.json"), "utf8"))
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
        const webFrameworks = ["react", "vue", "angular", "svelte", "next", "nuxt", "remix", "astro"]
        const matched = webFrameworks.filter((f) => deps[f] || deps[`@${f}/core`])
        if (matched.length > 0) {
          signals.push({ workflowID: "workflow:fullstack", reason: `Web framework detected: ${matched.join(", ")}`, weight: 3 })
        }
        if (deps["prisma"] || deps["@prisma/client"] || deps["drizzle-orm"] || deps["typeorm"] || deps["sequelize"]) {
          signals.push({ workflowID: "workflow:fullstack", reason: "ORM/database client detected", weight: 2 })
          signals.push({ workflowID: "workflow:data", reason: "ORM/database client detected", weight: 1 })
        }
        if (deps["express"] || deps["fastify"] || deps["hono"] || deps["koa"] || deps["nestjs"]) {
          signals.push({ workflowID: "workflow:fullstack", reason: "API framework detected", weight: 2 })
        }
      } catch {
        // ignore parse errors
      }
    }

    // ── Data signals ──────────────────────────────────────────────────────────
    if (has("requirements.txt") || has("pyproject.toml") || has("setup.py")) {
      try {
        const content = existsSync(join(dir, "requirements.txt"))
          ? require("fs").readFileSync(join(dir, "requirements.txt"), "utf8")
          : ""
        const dataLibs = ["pandas", "numpy", "scipy", "sklearn", "torch", "tensorflow", "polars", "duckdb"]
        const matched = dataLibs.filter((lib) => content.toLowerCase().includes(lib))
        if (matched.length > 0) {
          signals.push({ workflowID: "workflow:data", reason: `Data science libraries detected: ${matched.join(", ")}`, weight: 4 })
        }
      } catch {
        // ignore
      }
      signals.push({ workflowID: "workflow:data", reason: "Python project detected", weight: 1 })
    }
    if (hasExt(".sql") || has("schema.sql") || has("migrations") || hasDir("migrations") || hasDir("db")) {
      signals.push({ workflowID: "workflow:data", reason: "SQL files or migration directory detected", weight: 3 })
    }
    if (has("dbt_project.yml") || hasDir("models") || hasDir("dbt")) {
      signals.push({ workflowID: "workflow:data", reason: "dbt project detected", weight: 4 })
    }

    // ── Security signals ──────────────────────────────────────────────────────
    if (has(".snyk") || has("snyk.yml") || has(".trivyignore")) {
      signals.push({ workflowID: "workflow:security", reason: "Security scanning config detected", weight: 3 })
    }
    if (has("SECURITY.md") || has("security.md") || has(".github/SECURITY.md")) {
      signals.push({ workflowID: "workflow:security", reason: "SECURITY.md found", weight: 2 })
    }
    if (hasDir("audit") || has("audit.yml")) {
      signals.push({ workflowID: "workflow:security", reason: "Audit directory or config found", weight: 2 })
    }

    // ── Design signals ────────────────────────────────────────────────────────
    if (has("figma.json") || has(".figmarc") || has("figma.config.js") || has("figma.config.ts")) {
      signals.push({ workflowID: "workflow:design", reason: "Figma config detected", weight: 4 })
    }
    if (has("tokens.json") || has("design-tokens.json") || hasDir("tokens") || hasDir("design-tokens")) {
      signals.push({ workflowID: "workflow:design", reason: "Design tokens directory found", weight: 3 })
    }
    if (has("storybook.config.js") || has(".storybook") || hasDir(".storybook")) {
      signals.push({ workflowID: "workflow:design", reason: "Storybook configuration detected", weight: 2 })
      signals.push({ workflowID: "workflow:fullstack", reason: "Storybook (component library) detected", weight: 1 })
    }

    // ── Planning signals ──────────────────────────────────────────────────────
    if (has("ARCHITECTURE.md") || has("architecture.md") || has("RFC.md") || hasDir("docs/rfcs") || hasDir("rfcs")) {
      signals.push({ workflowID: "workflow:plan", reason: "Architecture or RFC documentation found", weight: 2 })
    }
    if (has("ROADMAP.md") || has("roadmap.md") || has("TODO.md")) {
      signals.push({ workflowID: "workflow:plan", reason: "Roadmap or TODO documentation found", weight: 2 })
    }

    return signals
  }

  /** Score and rank workflow suggestions for the given project directory. */
  export function suggest(dir: string, limit = 5): Suggestion[] {
    const signals = detectSignals(dir)
    const scores = new Map<string, { score: number; reasons: Set<string> }>()

    for (const signal of signals) {
      if (!scores.has(signal.workflowID)) {
        scores.set(signal.workflowID, { score: 0, reasons: new Set() })
      }
      const entry = scores.get(signal.workflowID)!
      entry.score += signal.weight
      entry.reasons.add(signal.reason)
    }

    const results: Suggestion[] = []
    for (const [workflowID, { score, reasons }] of scores.entries()) {
      const workflow = HubWorkflows.get(workflowID)
      if (!workflow) continue
      results.push({
        workflowID,
        workflowName: workflow.name,
        score,
        reasons: Array.from(reasons),
        command: `hopcoderx hub workflow ${workflow.name}`,
      })
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  /** True if there are any detectable project signals in the directory. */
  export function hasSignals(dir: string): boolean {
    return detectSignals(dir).length > 0
  }
}
