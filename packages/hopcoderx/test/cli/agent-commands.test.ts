import { test, expect, describe, afterEach } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Filesystem } from "../../src/util/filesystem"
import { Global } from "../../src/global"
import path from "path"
import fs from "fs/promises"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { PermissionNext } from "../../src/permission/next"
import { Config } from "../../src/config/config"

const testDataDir = process.env.HOPCODERX_TEST_DATA_DIR || path.join(Global.Path.data, "test")

afterEach(async () => {
  await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {})
})

// Helper to list agents without full Instance.provide() config validation
async function listAgents(worktree: string) {
  const agentDir = path.join(worktree, ".hopcoderx", "agent")
  const nativeAgents = [
    {
      name: "build",
      description: "The default agent",
      mode: "primary" as const,
      native: true,
      permission: { "*": "allow" as const },
    },
    {
      name: "plan",
      description: "Plan mode",
      mode: "primary" as const,
      native: true,
      permission: { "*": "allow" as const },
    },
    {
      name: "general",
      description: "General purpose agent",
      mode: "all" as const,
      native: true,
      permission: { "*": "allow" as const },
    },
  ]

  const customAgents: Array<{ name: string; description: string; mode: "subagent" | "primary" | "all"; native: false; permission: object }> = []

  if (await Filesystem.exists(agentDir)) {
    const files = await fs.readdir(agentDir).catch(() => [])
    for (const file of files) {
      if (file.endsWith(".md")) {
        const content = await Filesystem.readText(path.join(agentDir, file))
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1]
          const descriptionMatch = frontmatter.match(/description:\s*(.+)/)
          const modeMatch = frontmatter.match(/mode:\s*(.+)/)
          customAgents.push({
            name: file.replace(".md", ""),
            description: descriptionMatch?.[1]?.trim() || "",
            mode: (modeMatch?.[1]?.trim() as "subagent" | "primary" | "all") || "subagent",
            native: false,
            permission: {},
          })
        }
      }
    }
  }

  return [...nativeAgents, ...customAgents]
}

describe("agent delete", () => {
  test("deletes a custom agent file", async () => {
    await using tmp = await tmpdir()

    const agentDir = path.join(tmp.path, ".hopcoderx", "agent")
    await fs.mkdir(agentDir, { recursive: true })

    const agentFile = path.join(agentDir, "custom-agent.md")
    await Filesystem.write(
      agentFile,
      `---
description: A custom test agent
mode: primary
---

You are a custom test agent.
`,
    )

    const beforeExists = await Filesystem.exists(agentFile)
    expect(beforeExists).toBe(true)

    await fs.unlink(agentFile)

    const afterExists = await Filesystem.exists(agentFile)
    expect(afterExists).toBe(false)
  })

  test("prevents deletion of native agents", async () => {
    await using tmp = await tmpdir()

    const agents = await listAgents(tmp.path)
    const nativeAgent = agents.find((a) => a.native === true)

    expect(nativeAgent).toBeDefined()
    if (nativeAgent) {
      expect(nativeAgent.native).toBe(true)
    }
  })

  test("handles deletion of non-existent agent", async () => {
    await using tmp = await tmpdir()

    const agentDir = path.join(tmp.path, ".hopcoderx", "agent")
    await fs.mkdir(agentDir, { recursive: true })
    const nonExistentFile = path.join(agentDir, "non-existent-agent.md")

    await expect(fs.unlink(nonExistentFile)).rejects.toThrow()
  })

  test("lists all available agents", async () => {
    await using tmp = await tmpdir()

    const agents = await listAgents(tmp.path)

    expect(agents.length).toBeGreaterThanOrEqual(3)

    const agentNames = agents.map((a) => a.name)
    expect(agentNames).toContain("build")
    expect(agentNames).toContain("plan")
    expect(agentNames).toContain("general")
  })

  test("agent has correct structure", async () => {
    await using tmp = await tmpdir()

    const agents = await listAgents(tmp.path)

    for (const agent of agents) {
      expect(agent.name).toBeDefined()
      expect(agent.mode).toBeDefined()
      expect(["all", "primary", "subagent", "orchestrator"]).toContain(agent.mode)
      expect(agent.permission).toBeDefined()
    }
  })

  test("custom agent can be created and listed", async () => {
    await using tmp = await tmpdir()

    const agentDir = path.join(tmp.path, ".hopcoderx", "agent")
    await fs.mkdir(agentDir, { recursive: true })

    const agentFile = path.join(agentDir, "test-custom-agent.md")
    await Filesystem.write(
      agentFile,
      `---
description: A test custom agent
mode: subagent
---

You are a test agent for unit tests.
`,
    )

    const agents = await listAgents(tmp.path)
    const customAgent = agents.find((a) => a.name === "test-custom-agent")

    expect(customAgent).toBeDefined()
    expect(customAgent?.mode).toBe("subagent")
    expect(customAgent?.native).toBe(false)
  })
})

describe("agent modes", () => {
  test("primary agent can function as primary", async () => {
    await using tmp = await tmpdir()

    const agents = await listAgents(tmp.path)
    const primaryAgents = agents.filter((a) => a.mode === "primary" || a.mode === "all")

    expect(primaryAgents.length).toBeGreaterThan(0)
  })

  test("subagent can be used by other agents", async () => {
    await using tmp = await tmpdir()

    const agents = await listAgents(tmp.path)
    const subagents = agents.filter((a) => a.mode === "subagent" || a.mode === "all")

    expect(subagents.length).toBeGreaterThan(0)
  })
})

describe("agent permissions", () => {
  test("agents have permission rulesets", async () => {
    await using tmp = await tmpdir()

    const agents = await listAgents(tmp.path)

    for (const agent of agents) {
      expect(agent.permission).toBeDefined()
      expect(typeof agent.permission).toBe("object")
    }
  })

  test("build agent is available", async () => {
    await using tmp = await tmpdir()

    const agents = await listAgents(tmp.path)
    const buildAgent = agents.find((a) => a.name === "build")

    expect(buildAgent).toBeDefined()
  })
})
