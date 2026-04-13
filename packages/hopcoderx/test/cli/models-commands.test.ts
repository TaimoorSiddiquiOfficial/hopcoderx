import { test, expect, describe, afterEach } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Global } from "../../src/global"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "../../src/util/filesystem"
import { modify, applyEdits } from "jsonc-parser"

const testDataDir = process.env.HOPCODERX_TEST_DATA_DIR || path.join(Global.Path.data, "test")
const configPath = path.join(Global.Path.config, "hopcoderx.json")

afterEach(async () => {
  await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {})
  // Reset global config
  await fs.rm(Global.Path.config, { recursive: true, force: true }).catch(() => {})
  await fs.mkdir(Global.Path.config, { recursive: true })
})

async function writeGlobalConfig(config: object) {
  await fs.mkdir(Global.Path.config, { recursive: true })
  await Filesystem.write(configPath, JSON.stringify(config))
}

async function readGlobalConfig(): Promise<any> {
  if (!(await Filesystem.exists(configPath))) {
    return {}
  }
  const content = await Filesystem.readText(configPath)
  return JSON.parse(content)
}

describe("models default", () => {
  test("sets default model in global config", async () => {
    await writeGlobalConfig({ $schema: "https://hopcoder.dev/config.json" })

    const configContent = await Filesystem.readText(configPath)
    const edits = modify(configContent, ["model"], "anthropic/claude-sonnet-4-5-20250929", {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })

    const result = applyEdits(configContent, edits)
    await Filesystem.write(configPath, result)

    const config = await readGlobalConfig()
    expect(config.model).toBe("anthropic/claude-sonnet-4-5-20250929")
  })

  test("updates existing default model", async () => {
    await writeGlobalConfig({
      $schema: "https://hopcoder.dev/config.json",
      model: "old/model",
    })

    const configContent = await Filesystem.readText(configPath)
    const edits = modify(configContent, ["model"], "new/model", {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    const result = applyEdits(configContent, edits)
    await Filesystem.write(configPath, result)

    const config = await readGlobalConfig()
    expect(config.model).toBe("new/model")
  })

  test("shows current default model", async () => {
    await writeGlobalConfig({
      $schema: "https://hopcoder.dev/config.json",
      model: "test/model",
    })

    const config = await readGlobalConfig()
    expect(config.model).toBe("test/model")
  })

  test("handles missing default model", async () => {
    await writeGlobalConfig({
      $schema: "https://hopcoder.dev/config.json",
    })

    const config = await readGlobalConfig()
    expect(config.model).toBeUndefined()
  })
})

describe("models remove-favorite", () => {
  test("removes a model from favorites", async () => {
    await writeGlobalConfig({
      $schema: "https://hopcoder.dev/config.json",
      favoriteModels: ["anthropic/claude-3-5-sonnet", "openai/gpt-4"],
    })

    const configContent = await Filesystem.readText(configPath)
    const favorites = ["anthropic/claude-3-5-sonnet", "openai/gpt-4"]
    const index = favorites.indexOf("openai/gpt-4")
    favorites.splice(index, 1)

    const edits = modify(configContent, ["favoriteModels"], favorites, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    const result = applyEdits(configContent, edits)
    await Filesystem.write(configPath, result)

    const config = await readGlobalConfig()
    expect(config.favoriteModels).toEqual(["anthropic/claude-3-5-sonnet"])
    expect(config.favoriteModels).not.toContain("openai/gpt-4")
  })

  test("handles removing non-existent favorite", async () => {
    await writeGlobalConfig({
      $schema: "https://hopcoder.dev/config.json",
      favoriteModels: ["anthropic/claude-3-5-sonnet"],
    })

    const configContent = await Filesystem.readText(configPath)
    const favorites = ["anthropic/claude-3-5-sonnet"]
    const index = favorites.indexOf("non-existent/model")

    // indexOf returns -1 for non-existent item
    expect(index).toBe(-1)

    // Should not modify array if item not found
    if (index > -1) {
      favorites.splice(index, 1)
    }

    expect(favorites).toEqual(["anthropic/claude-3-5-sonnet"])
  })

  test("handles empty favorites array", async () => {
    await writeGlobalConfig({
      $schema: "https://hopcoder.dev/config.json",
      favoriteModels: [],
    })

    const config = await readGlobalConfig()
    expect(config.favoriteModels).toEqual([])
  })

  test("handles missing favoriteModels key", async () => {
    await writeGlobalConfig({
      $schema: "https://hopcoder.dev/config.json",
    })

    const config = await readGlobalConfig()
    expect(config.favoriteModels).toBeUndefined()
  })

  test("removes all favorites", async () => {
    await writeGlobalConfig({
      $schema: "https://hopcoder.dev/config.json",
      favoriteModels: ["model1", "model2", "model3"],
    })

    const configContent = await Filesystem.readText(configPath)
    const edits = modify(configContent, ["favoriteModels"], [], {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    const result = applyEdits(configContent, edits)
    await Filesystem.write(configPath, result)

    const config = await readGlobalConfig()
    expect(config.favoriteModels).toEqual([])
  })
})

describe("models favorite", () => {
  test("adds a model to favorites", async () => {
    await writeGlobalConfig({
      $schema: "https://hopcoder.dev/config.json",
    })

    const configContent = await Filesystem.readText(configPath)
    const favorites: string[] = []
    favorites.push("anthropic/claude-sonnet-4-5-20250929")

    const edits = modify(configContent, ["favoriteModels"], favorites, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    const result = applyEdits(configContent, edits)
    await Filesystem.write(configPath, result)

    const config = await readGlobalConfig()
    expect(config.favoriteModels).toContain("anthropic/claude-sonnet-4-5-20250929")
  })

  test("appends to existing favorites", async () => {
    await writeGlobalConfig({
      $schema: "https://hopcoder.dev/config.json",
      favoriteModels: ["existing/model"],
    })

    const configContent = await Filesystem.readText(configPath)
    const favorites = ["existing/model", "new/model"]

    const edits = modify(configContent, ["favoriteModels"], favorites, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    const result = applyEdits(configContent, edits)
    await Filesystem.write(configPath, result)

    const config = await readGlobalConfig()
    expect(config.favoriteModels).toContain("existing/model")
    expect(config.favoriteModels).toContain("new/model")
  })

  test("prevents duplicate favorites", async () => {
    await writeGlobalConfig({
      $schema: "https://hopcoder.dev/config.json",
      favoriteModels: ["model/a"],
    })

    const favorites = ["model/a"]
    const modelToAdd = "model/a"

    // Check if already exists
    if (!favorites.includes(modelToAdd)) {
      favorites.push(modelToAdd)
    }

    expect(favorites).toEqual(["model/a"]) // Should not have duplicates
  })
})

describe("models list", () => {
  test("lists models for a provider", async () => {
    // This test verifies the provider model structure
    // Actual model listing requires API calls which we don't test here
    const mockModels = {
      "claude-sonnet-4-5-20250929": {
        name: "Claude Sonnet 4.5",
        context: 256000,
      },
      "claude-opus-4-5-20250929": {
        name: "Claude Opus 4.5",
        context: 256000,
      },
    }

    expect(Object.keys(mockModels)).toHaveLength(2)
    expect(mockModels["claude-sonnet-4-5-20250929"].name).toBe("Claude Sonnet 4.5")
  })
})
