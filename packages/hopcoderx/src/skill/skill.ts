import z from "zod"
import path from "path"
import os from "os"
import { readFile } from "fs/promises"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { NamedError } from "@hopcoderx/util/error"
import { ConfigMarkdown } from "../config/markdown"
import { Log } from "../util/log"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Flag } from "@/flag/flag"
import { Bus } from "@/bus"
import { Session } from "@/session"
import { Discovery } from "./discovery"
import { Glob } from "../util/glob"
import { HubManifest } from "../hub/manifest"

export namespace Skill {
  const log = Log.create({ service: "skill" })
  export const Source = z.object({
    kind: z.enum([
      "builtin",
      "external-global",
      "external-project",
      "config-directory",
      "config-path",
      "remote-index",
      "remote-github",
    ]),
    origin: z.string(),
    root: z.string(),
    precedence: z.number().int(),
  })
  export type Source = z.infer<typeof Source>

  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
    content: z.string(),
    source: Source,
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    homepage: z.string().optional(),
    auth: HubManifest.Auth.optional(),
    embeddedMcp: z.array(HubManifest.EmbeddedMcp).optional(),
    presets: z.array(z.string()).optional(),
  })
  export type Info = z.infer<typeof Info>

  const CompanionManifest = z.object({
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    homepage: z.string().optional(),
    auth: HubManifest.Auth.optional(),
    embeddedMcp: z.array(HubManifest.EmbeddedMcp).optional(),
    presets: z.array(z.string()).optional(),
  })
  type CompanionManifest = z.infer<typeof CompanionManifest>

  export const Conflict = z.object({
    name: z.string(),
    winnerLocation: z.string(),
    winnerSource: Source,
    overriddenLocation: z.string(),
    overriddenSource: Source,
  })
  export type Conflict = z.infer<typeof Conflict>

  export const InvalidError = NamedError.create(
    "SkillInvalidError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
    }),
  )

  export const NameMismatchError = NamedError.create(
    "SkillNameMismatchError",
    z.object({
      path: z.string(),
      expected: z.string(),
      actual: z.string(),
    }),
  )

  // External skill directories to search for (project-level and global)
  // These follow the directory layout used by Claude Code and other agents.
  const EXTERNAL_DIRS = [".claude", ".agents"]
  const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
  const HOPCODERX_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
  const SKILL_PATTERN = "**/SKILL.md"

  // Built-in skills bundled with HopCoderX (lowest priority — user skills override)
  const BUILTIN_DIR = path.join(import.meta.dir, "builtin")
  const PRECEDENCE = {
    builtin: 10,
    "external-global": 20,
    "external-project": 30,
    "config-directory": 40,
    "config-path": 50,
    "remote-index": 60,
    "remote-github": 60,
  } as const

  export const state = Instance.state(async () => {
    const skills: Record<string, Info & { order: number }> = {}
    const dirs = new Set<string>()
    const conflicts: Conflict[] = []
    let order = 0

    const loadCompanionManifest = async (match: string): Promise<CompanionManifest | undefined> => {
      const companionPath = path.join(path.dirname(match), "hub.manifest.json")
      if (!(await Filesystem.exists(companionPath))) return undefined
      try {
        return CompanionManifest.parse(JSON.parse(await readFile(companionPath, "utf8")))
      } catch (err) {
        const message = `Failed to parse hub manifest ${companionPath}`
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load skill companion manifest", { path: companionPath, err })
        return undefined
      }
    }

    const addSkill = async (match: string, source: Source) => {
      const md = await ConfigMarkdown.parse(match).catch((err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse skill ${match}`
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load skill", { skill: match, err })
        return undefined
      })

      if (!md) return

      const parsed = Info.pick({ name: true, description: true }).safeParse(md.data)
      if (!parsed.success) return
      const companion = await loadCompanionManifest(match)

      const next = {
        name: parsed.data.name,
        description: parsed.data.description,
        location: match,
        content: md.content,
        source,
        category: companion?.category,
        tags: companion?.tags,
        homepage: companion?.homepage,
        auth: companion?.auth,
        embeddedMcp: companion?.embeddedMcp,
        presets: companion?.presets,
        order: order++,
      }

      const existing = skills[parsed.data.name]
      if (existing) {
        const shouldReplace =
          source.precedence > existing.source.precedence ||
          (source.precedence === existing.source.precedence && next.order > existing.order)

        const winner = shouldReplace ? next : existing
        const overridden = shouldReplace ? existing : next

        conflicts.push({
          name: parsed.data.name,
          winnerLocation: winner.location,
          winnerSource: winner.source,
          overriddenLocation: overridden.location,
          overriddenSource: overridden.source,
        })

        log.warn("duplicate skill name", {
          name: parsed.data.name,
          winner: winner.location,
          overridden: overridden.location,
        })

        if (!shouldReplace) return
      }

      dirs.add(path.dirname(match))
      skills[parsed.data.name] = next
    }

    const sourceFor = (kind: Source["kind"], origin: string, root: string): Source => ({
      kind,
      origin,
      root,
      precedence: PRECEDENCE[kind],
    })

    const scanPattern = async (
      pattern: string,
      cwd: string,
      sourceKind: Source["kind"],
      origin: string,
      dot = true,
      symlink = true,
    ) => {
      const matches = await Glob.scan(pattern, {
        cwd,
        absolute: true,
        include: "file",
        dot,
        symlink,
      })
      for (const match of matches) {
        await addSkill(match, sourceFor(sourceKind, origin, path.dirname(match)))
      }
    }

    const scanExternal = async (root: string, scope: "global" | "project") => {
      return Glob.scan(EXTERNAL_SKILL_PATTERN, {
        cwd: root,
        absolute: true,
        include: "file",
        dot: true,
        symlink: true,
      })
        .then((matches) =>
          Promise.all(
            matches.map((match) =>
              addSkill(
                match,
                sourceFor(scope === "global" ? "external-global" : "external-project", root, path.dirname(match)),
              ),
            ),
          ),
        )
        .catch((error) => {
          log.error(`failed to scan ${scope} skills`, { dir: root, error })
        })
    }

    // Load built-in skills first (lowest priority — all user/external skills override these)
    if (!Flag.HOPCODERX_DISABLE_BUILTIN_SKILLS && (await Filesystem.isDir(BUILTIN_DIR))) {
      await scanPattern(SKILL_PATTERN, BUILTIN_DIR, "builtin", BUILTIN_DIR, false, false).catch((e: unknown) => {
        log.warn("failed to scan builtin skills", { error: e })
      })
    }

    // Scan external skill directories (.claude/skills/, .agents/skills/, etc.)
    // Load global (home) first, then project-level (so project-level overwrites)
    if (!Flag.HOPCODERX_DISABLE_EXTERNAL_SKILLS) {
      for (const dir of EXTERNAL_DIRS) {
        const root = path.join(Global.Path.home, dir)
        if (!(await Filesystem.isDir(root))) continue
        await scanExternal(root, "global")
      }

      for await (const root of Filesystem.up({
        targets: EXTERNAL_DIRS,
        start: Instance.directory,
        stop: Instance.worktree,
      })) {
        await scanExternal(root, "project")
      }
    }

    // Scan .hopcoderx/skill/ directories
    for (const dir of await Config.directories()) {
      await scanPattern(HOPCODERX_SKILL_PATTERN, dir, "config-directory", dir)
    }

    // Scan additional skill paths from config
    const config = await Config.get()
    for (const skillPath of config.skills?.paths ?? []) {
      const expanded = skillPath.startsWith("~/") ? path.join(os.homedir(), skillPath.slice(2)) : skillPath
      const resolved = path.isAbsolute(expanded) ? expanded : path.join(Instance.directory, expanded)
      if (!(await Filesystem.isDir(resolved))) {
        log.warn("skill path not found", { path: resolved })
        continue
      }
      await scanPattern(SKILL_PATTERN, resolved, "config-path", resolved)
    }

    // Download and load skills from URLs
    for (const url of config.skills?.urls ?? []) {
      const list = await Discovery.pull(url)
      const sourceKind = Discovery.classify(url) === "github" ? "remote-github" : "remote-index"
      for (const dir of list) {
        dirs.add(dir)
        const matches = await Glob.scan(SKILL_PATTERN, {
          cwd: dir,
          absolute: true,
          include: "file",
          symlink: true,
        })
        for (const match of matches) {
          await addSkill(match, sourceFor(sourceKind, url, dir))
        }
      }
    }

    return {
      skills: Object.fromEntries(Object.entries(skills).map(([name, info]) => [name, Info.parse(info)])),
      dirs: Array.from(dirs),
      conflicts,
    }
  })

  export async function get(name: string) {
    return state().then((x) => x.skills[name])
  }

  export async function all() {
    return state().then((x) => Object.values(x.skills))
  }

  export async function dirs() {
    return state().then((x) => x.dirs)
  }

  export async function conflicts() {
    return state().then((x) => x.conflicts)
  }
}
