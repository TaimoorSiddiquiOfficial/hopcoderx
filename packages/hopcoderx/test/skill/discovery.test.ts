import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Discovery } from "../../src/skill/discovery"
import { Filesystem } from "../../src/util/filesystem"
import { rm } from "fs/promises"
import path from "path"

let CLOUDFLARE_SKILLS_URL: string
let server: ReturnType<typeof Bun.serve>
let downloadCount = 0

const fixturePath = path.join(import.meta.dir, "../fixture/skills")

beforeAll(async () => {
  await rm(Discovery.dir(), { recursive: true, force: true })

  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)

      // route /.well-known/skills/* to the fixture directory
      if (url.pathname.startsWith("/.well-known/skills/")) {
        const filePath = url.pathname.replace("/.well-known/skills/", "")
        const fullPath = path.join(fixturePath, filePath)

        if (await Filesystem.exists(fullPath)) {
          if (!fullPath.endsWith("index.json")) {
            downloadCount++
          }
          return new Response(Bun.file(fullPath))
        }
      }

      return new Response("Not Found", { status: 404 })
    },
  })

  CLOUDFLARE_SKILLS_URL = `http://localhost:${server.port}/.well-known/skills/`
})

afterAll(async () => {
  server?.stop()
  await rm(Discovery.dir(), { recursive: true, force: true })
})

describe("Discovery.pull", () => {
  test("downloads skills from cloudflare url", async () => {
    const dirs = await Discovery.pull(CLOUDFLARE_SKILLS_URL)
    expect(dirs.length).toBeGreaterThan(0)
    for (const dir of dirs) {
      expect(dir).toStartWith(Discovery.dir())
      const md = path.join(dir, "SKILL.md")
      expect(await Filesystem.exists(md)).toBe(true)
    }
  })

  test("url without trailing slash works", async () => {
    const dirs = await Discovery.pull(CLOUDFLARE_SKILLS_URL.replace(/\/$/, ""))
    expect(dirs.length).toBeGreaterThan(0)
    for (const dir of dirs) {
      const md = path.join(dir, "SKILL.md")
      expect(await Filesystem.exists(md)).toBe(true)
    }
  })

  test("returns empty array for invalid url", async () => {
    const dirs = await Discovery.pull(`http://localhost:${server.port}/invalid-url/`)
    expect(dirs).toEqual([])
  })

  test("returns empty array for non-json response", async () => {
    // any url not explicitly handled in server returns 404 text "Not Found"
    const dirs = await Discovery.pull(`http://localhost:${server.port}/some-other-path/`)
    expect(dirs).toEqual([])
  })

  test("downloads reference files alongside SKILL.md", async () => {
    const dirs = await Discovery.pull(CLOUDFLARE_SKILLS_URL)
    // find a skill dir that should have reference files (e.g. agents-sdk)
    const agentsSdk = dirs.find((d) => d.endsWith(path.join("agents-sdk")))
    expect(agentsSdk).toBeDefined()
    if (agentsSdk) {
      const refs = path.join(agentsSdk, "references")
      expect(await Filesystem.exists(path.join(agentsSdk, "SKILL.md"))).toBe(true)
      // agents-sdk has reference files per the index
      const refDir = await Array.fromAsync(new Bun.Glob("**/*.md").scan({ cwd: refs, onlyFiles: true }))
      expect(refDir.length).toBeGreaterThan(0)
    }
  })

  test("caches downloaded files on second pull", async () => {
    // clear dir and downloadCount
    await rm(Discovery.dir(), { recursive: true, force: true })
    downloadCount = 0

    // first pull to populate cache
    const first = await Discovery.pull(CLOUDFLARE_SKILLS_URL)
    expect(first.length).toBeGreaterThan(0)
    const firstCount = downloadCount
    expect(firstCount).toBeGreaterThan(0)

    // second pull should return same results from cache
    const second = await Discovery.pull(CLOUDFLARE_SKILLS_URL)
    expect(second.length).toBe(first.length)
    expect(second.sort()).toEqual(first.sort())

    // second pull should NOT increment download count
    expect(downloadCount).toBe(firstCount)
  })

  test("downloads skills from github repo urls", async () => {
    const originalFetch = globalThis.fetch
    await rm(Discovery.dir(), { recursive: true, force: true })

    let rawDownloads = 0
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url

        if (url === "https://api.github.com/repos/acme/skills-repo") {
          return Response.json({ default_branch: "main" })
        }

        if (url === "https://api.github.com/repos/acme/skills-repo/git/trees/main?recursive=1") {
          return Response.json({
            tree: [
              { path: "skills/use-redis/SKILL.md", type: "blob" },
              { path: "skills/use-redis/references/setup.md", type: "blob" },
              { path: "plugins/railway/skills/use-railway/SKILL.md", type: "blob" },
              { path: "plugins/railway/skills/use-railway/references/deploy.md", type: "blob" },
            ],
          })
        }

        if (url === "https://raw.githubusercontent.com/acme/skills-repo/main/skills/use-redis/SKILL.md") {
          rawDownloads++
          return new Response(`---
name: use-redis
description: Redis skill.
---

# Redis
`)
        }

        if (url === "https://raw.githubusercontent.com/acme/skills-repo/main/skills/use-redis/references/setup.md") {
          rawDownloads++
          return new Response("# Setup")
        }

        if (url === "https://raw.githubusercontent.com/acme/skills-repo/main/plugins/railway/skills/use-railway/SKILL.md") {
          rawDownloads++
          return new Response(`---
name: use-railway
description: Railway skill.
---

# Railway
`)
        }

        if (url === "https://raw.githubusercontent.com/acme/skills-repo/main/plugins/railway/skills/use-railway/references/deploy.md") {
          rawDownloads++
          return new Response("# Deploy")
        }

        return originalFetch(input as any, init)
      },
      { preconnect: originalFetch.preconnect },
    ) as typeof fetch

    try {
      const dirs = await Discovery.pull("https://github.com/acme/skills-repo")
      expect(dirs.length).toBe(2)
      expect(rawDownloads).toBe(4)

      for (const dir of dirs) {
        expect(await Filesystem.exists(path.join(dir, "SKILL.md"))).toBe(true)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
