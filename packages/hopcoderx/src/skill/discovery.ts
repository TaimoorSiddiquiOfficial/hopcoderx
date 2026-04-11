import path from "path"
import { mkdir } from "fs/promises"
import { createHash } from "crypto"
import { Log } from "../util/log"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"

export namespace Discovery {
  const log = Log.create({ service: "skill-discovery" })
  const GITHUB_API = "https://api.github.com"
  const GITHUB_RAW = "https://raw.githubusercontent.com"

  type Index = {
    skills: Array<{
      name: string
      description: string
      files: string[]
    }>
  }

  type GitHubTree = {
    tree?: Array<{
      path: string
      type: "blob" | "tree"
    }>
  }

  type GitHubRepo = {
    default_branch?: string
  }

  type GitHubSource = {
    owner: string
    repo: string
    ref?: string
    subpath?: string
  }

  export function dir() {
    return path.join(Global.Path.cache, "skills")
  }

  export function classify(url: string): "index" | "github" {
    return parseGitHubSource(url) ? "github" : "index"
  }

  async function get(url: string, dest: string): Promise<boolean> {
    if (await Filesystem.exists(dest)) return true
    return fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          log.error("failed to download", { url, status: response.status })
          return false
        }
        if (response.body) await Filesystem.writeStream(dest, response.body)
        return true
      })
      .catch((err) => {
        log.error("failed to download", { url, err })
        return false
      })
  }

  function parseGitHubSource(input: string): GitHubSource | undefined {
    let url: URL
    try {
      url = new URL(input)
    } catch {
      return undefined
    }

    if (url.hostname !== "github.com") return undefined

    const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean)
    if (parts.length < 2) return undefined

    const owner = parts[0]
    const repo = parts[1].replace(/\.git$/, "")
    if (!owner || !repo) return undefined

    if (parts[2] === "tree" && parts[3]) {
      return {
        owner,
        repo,
        ref: decodeURIComponent(parts[3]),
        subpath: parts.slice(4).join("/"),
      }
    }

    return { owner, repo }
  }

  function gitHubHeaders() {
    return {
      Accept: "application/vnd.github+json",
      "User-Agent": "HopCoderX",
    }
  }

  function isSkillPath(file: string) {
    const parts = file.split("/")
    if (parts.at(-1) !== "SKILL.md") return false
    if (parts.length >= 3 && (parts.at(-3) === "skill" || parts.at(-3) === "skills")) return true
    if (parts.length >= 4 && parts.at(-4) === ".claude" && parts.at(-3) === "skills") return true
    if (parts.length >= 4 && parts.at(-4) === ".agents" && parts.at(-3) === "skills") return true
    return false
  }

  async function pullGitHub(url: string): Promise<string[]> {
    const parsed = parseGitHubSource(url)
    if (!parsed) return []

    const repoResponse = await fetch(`${GITHUB_API}/repos/${parsed.owner}/${parsed.repo}`, {
      headers: gitHubHeaders(),
    })
      .then(async (response) => {
        if (!response.ok) {
          log.error("failed to fetch github repo", { url, status: response.status })
          return undefined
        }
        return response.json() as Promise<GitHubRepo>
      })
      .catch((error) => {
        log.error("failed to fetch github repo", { url, error })
        return undefined
      })

    const ref = parsed.ref ?? repoResponse?.default_branch
    if (!ref) {
      log.warn("github repo missing default branch", { url })
      return []
    }

    const treeUrl = `${GITHUB_API}/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`
    const treeResponse = await fetch(treeUrl, {
      headers: gitHubHeaders(),
    })
      .then(async (response) => {
        if (!response.ok) {
          log.error("failed to fetch github tree", { url: treeUrl, status: response.status })
          return undefined
        }
        return response.json() as Promise<GitHubTree>
      })
      .catch((error) => {
        log.error("failed to fetch github tree", { url: treeUrl, error })
        return undefined
      })

    const prefix = parsed.subpath?.replace(/^\/+|\/+$/g, "")
    const tree = treeResponse?.tree ?? []
    const skillRoots = Array.from(
      new Set(
        tree
          .filter((entry) => entry.type === "blob" && isSkillPath(entry.path))
          .map((entry) => entry.path)
          .filter((entry) => !prefix || entry === prefix || entry.startsWith(`${prefix}/`))
          .map((entry) => path.posix.dirname(entry)),
      ),
    )

    if (skillRoots.length === 0) {
      log.warn("no skills found in github repo", { url, ref, prefix })
      return []
    }

    const filesByRoot = new Map<string, string[]>()
    for (const root of skillRoots) {
      filesByRoot.set(
        root,
        tree
          .filter((entry) => entry.type === "blob" && (entry.path === root || entry.path.startsWith(`${root}/`)))
          .map((entry) => entry.path),
      )
    }

    const cacheKey = createHash("sha1").update(`${parsed.owner}/${parsed.repo}@${ref}:${prefix ?? ""}`).digest("hex")
    const cacheRoot = path.join(dir(), "github", cacheKey)
    const result: string[] = []

    await Promise.all(
      skillRoots.map(async (root) => {
        const files = filesByRoot.get(root) ?? []
        await Promise.all(
          files.map(async (file) => {
            const dest = path.join(cacheRoot, ...file.split("/"))
            await mkdir(path.dirname(dest), { recursive: true })
            await get(`${GITHUB_RAW}/${parsed.owner}/${parsed.repo}/${ref}/${file}`, dest)
          }),
        )

        const skillDir = path.join(cacheRoot, ...root.split("/"))
        const md = path.join(skillDir, "SKILL.md")
        if (await Filesystem.exists(md)) result.push(skillDir)
      }),
    )

    return result
  }

  export async function pull(url: string): Promise<string[]> {
    if (classify(url) === "github") {
      return pullGitHub(url)
    }

    const result: string[] = []
    const base = url.endsWith("/") ? url : `${url}/`
    const index = new URL("index.json", base).href
    const cache = dir()
    const host = base.slice(0, -1)

    log.info("fetching index", { url: index })
    const data = await fetch(index)
      .then(async (response) => {
        if (!response.ok) {
          log.error("failed to fetch index", { url: index, status: response.status })
          return undefined
        }
        return response
          .json()
          .then((json) => json as Index)
          .catch((err) => {
            log.error("failed to parse index", { url: index, err })
            return undefined
          })
      })
      .catch((err) => {
        log.error("failed to fetch index", { url: index, err })
        return undefined
      })

    if (!data?.skills || !Array.isArray(data.skills)) {
      log.warn("invalid index format", { url: index })
      return result
    }

    const list = data.skills.filter((skill) => {
      if (!skill?.name || !Array.isArray(skill.files)) {
        log.warn("invalid skill entry", { url: index, skill })
        return false
      }
      return true
    })

    await Promise.all(
      list.map(async (skill) => {
        const root = path.join(cache, skill.name)
        await Promise.all(
          skill.files.map(async (file) => {
            const link = new URL(file, `${host}/${skill.name}/`).href
            const dest = path.join(root, file)
            await mkdir(path.dirname(dest), { recursive: true })
            await get(link, dest)
          }),
        )

        const md = path.join(root, "SKILL.md")
        if (await Filesystem.exists(md)) result.push(root)
      }),
    )

    return result
  }
}
