/**
 * Skill Discovery Enhancement
 *
 * Dynamically discover skills from:
 * - Project structure (detect frameworks, tools, configs)
 * - GitHub repositories (awesome lists, skill repos)
 * - Local filesystem (skill files in .hopcoderx/skills)
 *
 * Usage:
 *   const skills = await SkillDiscovery.scanProject(process.cwd())
 *   await SkillDiscovery.autoApply(skills)
 */

import { Log } from "@/util/log"
import { readFile, readdir } from "fs/promises"
import { existsSync } from "fs"
import { join, basename } from "path"
import { SkillRegistry, type Skill } from "./skills"
import { SkillsMarketplace, type MarketplaceSearchResult } from "./marketplace"

const log = Log.create({ service: "skills.discovery" })

export namespace SkillDiscovery {
  export interface DiscoveredSkill {
    /** Skill ID/name */
    id: string
    /** Display name */
    name: string
    /** Description */
    description: string
    /** Source of discovery */
    source: "project" | "github" | "local" | "marketplace"
    /** Confidence score (0-1) */
    confidence: number
    /** Recommended skill packages to install */
    recommendations: SkillRecommendation[]
    /** Detected project context */
    context?: ProjectContext
  }

  export interface SkillRecommendation {
    /** npm package name */
    package: string
    /** Why this skill is recommended */
    reason: string
    /** Installation priority */
    priority: "high" | "medium" | "low"
  }

  export interface ProjectContext {
    /** Detected frameworks (e.g., "react", "express", "nextjs") */
    frameworks: string[]
    /** Detected tools (e.g., "docker", "terraform", "kubernetes") */
    tools: string[]
    /** Detected languages (e.g., "typescript", "python", "go") */
    languages: string[]
    /** Package.json dependencies */
    dependencies: Record<string, string>
    /** Project root directory */
    root: string
  }

  /**
   * Scan a project directory and discover relevant skills
   */
  export async function scanProject(root: string): Promise<DiscoveredSkill[]> {
    const context = await analyzeProject(root)
    const discovered: DiscoveredSkill[] = []

    // Framework-specific skills
    for (const framework of context.frameworks) {
      const skill = await discoverFrameworkSkill(framework, context)
      if (skill) discovered.push(skill)
    }

    // Tool-specific skills
    for (const tool of context.tools) {
      const skill = await discoverToolSkill(tool, context)
      if (skill) discovered.push(skill)
    }

    // Local skill files
    const localSkills = await scanLocalSkills(root)
    discovered.push(...localSkills)

    // Sort by confidence
    discovered.sort((a, b) => b.confidence - a.confidence)

    log.info("project scanned", {
      root,
      frameworks: context.frameworks,
      tools: context.tools,
      discoveredCount: discovered.length,
    })

    return discovered
  }

  /**
   * Analyze project structure to detect frameworks, tools, and languages
   */
  export async function analyzeProject(root: string): Promise<ProjectContext> {
    const context: ProjectContext = {
      frameworks: [],
      tools: [],
      languages: [],
      dependencies: {},
      root,
    }

    // Check for package.json
    const pkgJsonPath = join(root, "package.json")
    if (existsSync(pkgJsonPath)) {
      const pkg = JSON.parse(await readFile(pkgJsonPath, "utf8"))
      context.dependencies = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      }

      // Detect frameworks from dependencies
      const frameworkPatterns: Record<string, string[]> = {
        react: ["react", "react-dom"],
        nextjs: ["next"],
        vue: ["vue", "nuxt"],
        svelte: ["svelte", "sveltekit"],
        express: ["express"],
        fastify: ["fastify"],
        nestjs: ["@nestjs/core"],
        angular: ["@angular/core"],
        remix: ["@remix-run/node"],
        astro: ["astro"],
        tailwind: ["tailwindcss"],
        prisma: ["prisma", "@prisma/client"],
        drizzle: ["drizzle-orm"],
        graphql: ["graphql", "apollo-server", "apollo-client"],
        jest: ["jest", "@types/jest"],
        vitest: ["vitest"],
        playwright: ["playwright"],
        cypress: ["cypress"],
        storybook: ["storybook"],
      }

      for (const [framework, deps] of Object.entries(frameworkPatterns)) {
        if (deps.some((dep) => dep in context.dependencies)) {
          context.frameworks.push(framework)
        }
      }

      // Detect TypeScript
      if (context.dependencies["typescript"] || existsSync(join(root, "tsconfig.json"))) {
        context.languages.push("typescript")
      } else if (Object.keys(context.dependencies).some((d) => d.endsWith(".js") || d.includes("babel"))) {
        context.languages.push("javascript")
      }
    }

    // Check for Python
    if (existsSync(join(root, "requirements.txt")) || existsSync(join(root, "pyproject.toml")) || existsSync(join(root, "setup.py"))) {
      context.languages.push("python")
    }

    // Check for Go
    if (existsSync(join(root, "go.mod")) || existsSync(join(root, "go.sum"))) {
      context.languages.push("go")
    }

    // Check for Rust
    if (existsSync(join(root, "Cargo.toml")) || existsSync(join(root, "Cargo.lock"))) {
      context.languages.push("rust")
    }

    // Check for Java/Kotlin
    if (existsSync(join(root, "pom.xml")) || existsSync(join(root, "build.gradle")) || existsSync(join(root, "build.gradle.kts"))) {
      context.languages.push("java")
    }

    // Detect tools from config files
    const toolPatterns: Record<string, string> = {
      docker: "Dockerfile",
      "docker-compose": "docker-compose.yml",
      terraform: "terraform.tf",
      kubernetes: "k8s/",
      helm: "Chart.yaml",
      github: ".github/",
      gitlab: ".gitlab/",
      vercel: "vercel.json",
      netlify: "netlify.toml",
      sentry: "sentry.properties",
      aws: "aws/",
      azure: "azure/",
      gcp: "gcp/",
    }

    for (const [tool, file] of Object.entries(toolPatterns)) {
      if (existsSync(join(root, file))) {
        context.tools.push(tool)
      }
    }

    // Check for .hopcoderx config
    const hopcoderxDir = join(root, ".hopcoderx")
    if (existsSync(hopcoderxDir)) {
      try {
        const configPath = join(hopcoderxDir, "config.json")
        if (existsSync(configPath)) {
          const config = JSON.parse(await readFile(configPath, "utf8"))
          if (config.skills?.enabled) {
            context.tools.push("hopcoderx")
          }
        }
      } catch {
        // Ignore config parse errors
      }
    }

    return context
  }

  /**
   * Discover skills related to a detected framework
   */
  async function discoverFrameworkSkill(framework: string, context: ProjectContext): Promise<DiscoveredSkill | null> {
    const recommendations: SkillRecommendation[] = []

    // Framework-specific skill recommendations
    const frameworkSkills: Record<string, SkillRecommendation[]> = {
      react: [
        { package: "hopcoderx-skill-react-components", reason: "React component generation and refactoring", priority: "high" },
        { package: "hopcoderx-skill-react-testing", reason: "React Testing Library integration", priority: "medium" },
      ],
      nextjs: [
        { package: "hopcoderx-skill-nextjs", reason: "Next.js app router and pages router support", priority: "high" },
        { package: "hopcoderx-skill-vercel", reason: "Vercel deployment management", priority: "medium" },
      ],
      express: [
        { package: "hopcoderx-skill-express", reason: "Express.js middleware and routing", priority: "high" },
        { package: "hopcoderx-skill-docker", reason: "Container management for Node.js apps", priority: "medium" },
      ],
      nestjs: [
        { package: "hopcoderx-skill-nestjs", reason: "NestJS decorators and modules", priority: "high" },
      ],
      vue: [
        { package: "hopcoderx-skill-vue", reason: "Vue 3 composition API support", priority: "high" },
      ],
      svelte: [
        { package: "hopcoderx-skill-svelte", reason: "SvelteKit routing and stores", priority: "high" },
      ],
      tailwind: [
        { package: "hopcoderx-skill-tailwind", reason: "Tailwind CSS utility classes", priority: "medium" },
      ],
      prisma: [
        { package: "hopcoderx-skill-prisma", reason: "Prisma schema and migrations", priority: "high" },
      ],
      drizzle: [
        { package: "hopcoderx-skill-drizzle", reason: "Drizzle ORM schema generation", priority: "high" },
      ],
      jest: [
        { package: "hopcoderx-skill-jest", reason: "Jest test generation and mocking", priority: "medium" },
      ],
      playwright: [
        { package: "hopcoderx-skill-playwright", reason: "Playwright E2E test generation", priority: "medium" },
      ],
    }

    const skills = frameworkSkills[framework] || []
    if (skills.length === 0) return null

    return {
      id: `framework-${framework}`,
      name: `${framework} Framework Support`,
      description: `Detected ${framework} framework in project. Install recommended skills for enhanced support.`,
      source: "project",
      confidence: 0.9,
      recommendations: skills,
      context,
    }
  }

  /**
   * Discover skills related to a detected tool
   */
  async function discoverToolSkill(tool: string, context: ProjectContext): Promise<DiscoveredSkill | null> {
    const recommendations: SkillRecommendation[] = []

    // Tool-specific skill recommendations
    const toolSkills: Record<string, SkillRecommendation[]> = {
      docker: [
        { package: "hopcoderx-skill-docker", reason: "Docker container management", priority: "high" },
      ],
      "docker-compose": [
        { package: "hopcoderx-skill-docker", reason: "Docker Compose multi-container support", priority: "high" },
      ],
      terraform: [
        { package: "hopcoderx-skill-terraform", reason: "Terraform HCL generation and validation", priority: "high" },
      ],
      kubernetes: [
        { package: "hopcoderx-skill-kubernetes", reason: "K8s manifest generation", priority: "high" },
      ],
      github: [
        { package: "hopcoderx-skill-github", reason: "GitHub API integration for issues and PRs", priority: "high" },
        { package: "hopcoderx-skill-github-actions", reason: "GitHub Actions workflow generation", priority: "medium" },
      ],
      gitlab: [
        { package: "hopcoderx-skill-gitlab", reason: "GitLab CI/CD pipeline management", priority: "high" },
      ],
      vercel: [
        { package: "hopcoderx-skill-vercel", reason: "Vercel deployment and preview URLs", priority: "high" },
      ],
      netlify: [
        { package: "hopcoderx-skill-netlify", reason: "Netlify deployment management", priority: "high" },
      ],
      sentry: [
        { package: "hopcoderx-skill-sentry", reason: "Sentry error tracking integration", priority: "medium" },
      ],
      aws: [
        { package: "hopcoderx-skill-aws", reason: "AWS SDK and CloudFormation support", priority: "high" },
      ],
      azure: [
        { package: "hopcoderx-skill-azure", reason: "Azure DevOps and ARM templates", priority: "high" },
      ],
      gcp: [
        { package: "hopcoderx-skill-gcp", reason: "Google Cloud deployment support", priority: "high" },
      ],
    }

    const skills = toolSkills[tool] || []
    if (skills.length === 0) return null

    return {
      id: `tool-${tool}`,
      name: `${tool} Integration`,
      description: `Detected ${tool} configuration. Install recommended skills for enhanced support.`,
      source: "project",
      confidence: 0.85,
      recommendations: skills,
      context,
    }
  }

  /**
   * Scan for local skill files in .hopcoderx/skills directory
   */
  async function scanLocalSkills(root: string): Promise<DiscoveredSkill[]> {
    const skillsDir = join(root, ".hopcoderx", "skills")
    if (!existsSync(skillsDir)) return []

    const discovered: DiscoveredSkill[] = []

    try {
      const files = await readdir(skillsDir, { withFileTypes: true })
      for (const file of files) {
        if (file.isDirectory() || file.name.endsWith(".ts") || file.name.endsWith(".js")) {
          const skillName = basename(file.name, ".ts").replace(".js", "")
          discovered.push({
            id: `local-${skillName}`,
            name: skillName,
            description: `Local skill file found in project`,
            source: "local",
            confidence: 1.0,
            recommendations: [],
          })
        }
      }
    } catch (err) {
      log.error("failed to scan local skills", { error: err })
    }

    return discovered
  }

  /**
   * Search GitHub for awesome lists and skill repositories
   */
  export async function searchGitHub(query: string): Promise<MarketplaceSearchResult[]> {
    const results: MarketplaceSearchResult[] = []

    try {
      // Search for awesome-opencode style lists
      const searchQuery = encodeURIComponent(`awesome opencode skill ${query}`)
      const res = await fetch(`https://api.github.com/search/repositories?q=${searchQuery}&sort=stars&order=desc&per_page=10`, {
        headers: {
          Accept: "application/vnd.github.v3+json",
        },
        signal: AbortSignal.timeout(5000),
      })

      if (!res.ok) return results

      const data = await res.json() as { items: any[] }
      for (const item of data.items.slice(0, 5)) {
        results.push({
          name: item.full_name,
          description: item.description || "",
          version: "latest",
          npmUrl: item.html_url,
          author: item.owner?.login,
          homepage: item.homepage,
        })
      }
    } catch (err) {
      log.error("github search failed", { error: err })
    }

    return results
  }

  /**
   * Auto-apply relevant skills based on project analysis
   * Returns list of skills that were auto-applied
   */
  export async function autoApply(discovered: DiscoveredSkill[]): Promise<string[]> {
    const applied: string[] = []
    const marketplace = new SkillsMarketplace()

    for (const skill of discovered) {
      // Only auto-apply high confidence skills
      if (skill.confidence < 0.8) continue

      for (const rec of skill.recommendations) {
        if (rec.priority !== "high") continue

        try {
          // Check if already installed
          const installed = await marketplace.list()
          if (installed.some((s) => s.name === rec.package)) {
            log.info("skill already installed", { package: rec.package })
            continue
          }

          // Auto-install high priority skills
          await marketplace.install(rec.package)
          applied.push(rec.package)
          log.info("skill auto-installed", { package: rec.package, reason: rec.reason })
        } catch (err) {
          log.warn("auto-install failed", { package: rec.package, error: err })
        }
      }
    }

    return applied
  }

  /**
   * Get skill recommendations for a project
   */
  export async function getRecommendations(root: string): Promise<{
    discovered: DiscoveredSkill[]
    allRecommendations: SkillRecommendation[]
  }> {
    const discovered = await scanProject(root)
    const allRecommendations: SkillRecommendation[] = []

    for (const skill of discovered) {
      allRecommendations.push(...skill.recommendations)
    }

    // Deduplicate by package name
    const unique = new Map<string, SkillRecommendation>()
    for (const rec of allRecommendations) {
      if (!unique.has(rec.package)) {
        unique.set(rec.package, rec)
      }
    }

    // Sort by priority
    const sorted = Array.from(unique.values()).sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 }
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    })

    return {
      discovered,
      allRecommendations: sorted,
    }
  }
}
