import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"

describe("tool.registry", () => {
  test("loads tools from .hopcoderx/tool (singular)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const HopCoderXDir = path.join(dir, ".hopcoderx")
        await fs.mkdir(HopCoderXDir, { recursive: true })

        const toolDir = path.join(HopCoderXDir, "tool")
        await fs.mkdir(toolDir, { recursive: true })

        await Bun.write(
          path.join(toolDir, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  })

  test("loads tools from .hopcoderx/tools (plural)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const HopCoderXDir = path.join(dir, ".hopcoderx")
        await fs.mkdir(HopCoderXDir, { recursive: true })

        const toolsDir = path.join(HopCoderXDir, "tools")
        await fs.mkdir(toolsDir, { recursive: true })

        await Bun.write(
          path.join(toolsDir, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  })

  test("loads tools with external dependencies without crashing", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const HopCoderXDir = path.join(dir, ".hopcoderx")
        await fs.mkdir(HopCoderXDir, { recursive: true })

        const toolsDir = path.join(HopCoderXDir, "tools")
        await fs.mkdir(toolsDir, { recursive: true })

        await Bun.write(
          path.join(HopCoderXDir, "package.json"),
          JSON.stringify({
            name: "custom-tools",
            dependencies: {
              "@hopcoderx/plugin": "^0.0.0",
              cowsay: "^1.6.0",
            },
          }),
        )

        await Bun.write(
          path.join(toolsDir, "cowsay.ts"),
          [
            "import { say } from 'cowsay'",
            "export default {",
            "  description: 'tool that imports cowsay at top level',",
            "  args: { text: { type: 'string' } },",
            "  execute: async ({ text }: { text: string }) => {",
            "    return say({ text })",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("cowsay")
      },
    })
  })

  // ─── byCapability ─────────────────────────────────────────────────────────

  describe("byCapability", () => {
    test("returns empty array for empty caps list", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tools = await ToolRegistry.byCapability([])
          expect(tools).toEqual([])
        },
      })
    })

    test("returns filesystem tools", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tools = await ToolRegistry.byCapability(["filesystem"])
          const ids = tools.map((t) => t.id)
          expect(ids).toContain("bash")
          expect(ids).toContain("edit")
          expect(ids).toContain("write")
          expect(ids).toContain("read")
          // network-only tools should not appear
          expect(ids).not.toContain("webfetch")
        },
      })
    })

    test("returns network tools", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tools = await ToolRegistry.byCapability(["network"])
          const ids = tools.map((t) => t.id)
          expect(ids).toContain("webfetch")
          expect(ids).toContain("http")
          // filesystem-only tools should not appear
          expect(ids).not.toContain("edit")
          expect(ids).not.toContain("write")
        },
      })
    })

    test("returns read-only tools", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tools = await ToolRegistry.byCapability(["read-only"])
          const ids = tools.map((t) => t.id)
          expect(ids).toContain("read")
          expect(ids).toContain("glob")
          expect(ids).toContain("grep")
          expect(ids).toContain("semanticsearch")
          // execution tools should not appear
          expect(ids).not.toContain("bash")
          expect(ids).not.toContain("task")
        },
      })
    })

    test("union match: returns tools matching any of the given caps", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tools = await ToolRegistry.byCapability(["ai", "execution"])
          const ids = tools.map((t) => t.id)
          // ai tools (confirmed real IDs)
          expect(ids).toContain("transcribe")
          expect(ids).toContain("videogen")
          // execution tools
          expect(ids).toContain("bash")
          expect(ids).toContain("task")
        },
      })
    })
  })
})
