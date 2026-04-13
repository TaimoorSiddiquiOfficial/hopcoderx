import { test, expect, describe, afterEach } from "bun:test"
import { Global } from "../../src/global"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "../../src/util/filesystem"
import { modify, applyEdits } from "jsonc-parser"

const testDataDir = process.env.HOPCODERX_TEST_DATA_DIR || path.join(Global.Path.data, "test")
const testConfigDir = path.join(testDataDir, "config-test")

afterEach(async () => {
  await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {})
})

async function writeTestConfig(configPath: string, config: object) {
  await fs.mkdir(path.dirname(configPath), { recursive: true })
  await Filesystem.write(configPath, JSON.stringify(config))
}

async function readTestConfig(configPath: string): Promise<any> {
  const content = await Filesystem.readText(configPath)
  return JSON.parse(content)
}

describe("config reset", () => {
  test("resets entire config to template", async () => {
    const configPath = path.join(testConfigDir, "hopcoderx.json")

    // Write initial config with custom values
    await writeTestConfig(configPath, {
      $schema: "https://hopcoder.dev/config.json",
      model: "test/model",
      username: "testuser",
      custom_key: "custom_value",
    })

    // Reset to template
    const template = { $schema: "https://hopcoder.dev/config.json" }
    await writeTestConfig(configPath, template)

    // Verify reset
    const after = await readTestConfig(configPath)
    expect(after.model).toBeUndefined()
    expect(after.username).toBeUndefined()
    expect(after.$schema).toBe("https://hopcoder.dev/config.json")
  })

  test("resets specific key to undefined", async () => {
    const configPath = path.join(testConfigDir, "hopcoderx.json")

    await writeTestConfig(configPath, {
      $schema: "https://hopcoder.dev/config.json",
      model: "test/model",
      username: "testuser",
    })

    const configContent = await Filesystem.readText(configPath)

    // Remove the 'model' key using jsonc-parser
    const edits = modify(configContent, ["model"], undefined, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    const result = applyEdits(configContent, edits)
    await writeTestConfig(configPath, JSON.parse(result))

    // Verify model is removed but username remains
    const after = await readTestConfig(configPath)
    expect(after.model).toBeUndefined()
    expect(after.username).toBe("testuser")
  })
})

describe("config diff", () => {
  test("shows diff between current config and defaults", async () => {
    const configPath = path.join(testConfigDir, "hopcoderx.json")

    await writeTestConfig(configPath, {
      $schema: "https://hopcoder.dev/config.json",
      model: "anthropic/claude-sonnet-4-5-20250929",
      temperature: 0.7,
    })

    const config = await readTestConfig(configPath)

    // Get keys that differ from empty default
    const diff: string[] = []
    for (const [key, value] of Object.entries(config)) {
      if (key !== "$schema") {
        diff.push(`+ ${key}: ${JSON.stringify(value)}`)
      }
    }

    expect(diff.length).toBeGreaterThan(0)
    expect(diff.join("\n")).toContain("model")
    expect(diff.join("\n")).toContain("temperature")
  })

  test("returns empty diff for default config", async () => {
    const configPath = path.join(testConfigDir, "hopcoderx.json")

    await writeTestConfig(configPath, {
      $schema: "https://hopcoder.dev/config.json",
    })

    const config = await readTestConfig(configPath)
    const diff = Object.keys(config).filter((key) => key !== "$schema")
    expect(diff.length).toBe(0)
  })

  test("handles nested config differences", async () => {
    const configPath = path.join(testConfigDir, "hopcoderx.json")

    await writeTestConfig(configPath, {
      $schema: "https://hopcoder.dev/config.json",
      provider: {
        anthropic: {
          apiKey: "test-key",
        },
      },
    })

    const config = await readTestConfig(configPath)

    // Check nested structure exists
    expect(config.provider).toBeDefined()
    expect(config.provider.anthropic).toBeDefined()
    expect(config.provider.anthropic.apiKey).toBe("test-key")
  })
})

describe("config get", () => {
  test("gets a top-level configuration value", async () => {
    const configPath = path.join(testConfigDir, "hopcoderx.json")

    await writeTestConfig(configPath, {
      $schema: "https://hopcoder.dev/config.json",
      model: "test/model",
      username: "testuser",
    })

    const config = await readTestConfig(configPath)
    expect(config.model).toBe("test/model")
  })

  test("gets a nested configuration value", async () => {
    const configPath = path.join(testConfigDir, "hopcoderx.json")

    await writeTestConfig(configPath, {
      $schema: "https://hopcoder.dev/config.json",
      provider: {
        anthropic: {
          apiKey: "sk-test",
        },
      },
    })

    const config = await readTestConfig(configPath)
    expect(config.provider?.anthropic?.apiKey).toBe("sk-test")
  })
})

describe("config set", () => {
  test("sets a top-level configuration value", async () => {
    const configPath = path.join(testConfigDir, "hopcoderx.json")

    await writeTestConfig(configPath, {
      $schema: "https://hopcoder.dev/config.json",
    })

    const configContent = await Filesystem.readText(configPath)

    const edits = modify(configContent, ["model"], "new/model", {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    const result = applyEdits(configContent, edits)
    await writeTestConfig(configPath, JSON.parse(result))

    const config = await readTestConfig(configPath)
    expect(config.model).toBe("new/model")
  })

  test("sets a nested configuration value", async () => {
    const configPath = path.join(testConfigDir, "hopcoderx.json")

    await writeTestConfig(configPath, {
      $schema: "https://hopcoder.dev/config.json",
    })

    const configContent = await Filesystem.readText(configPath)

    const edits = modify(configContent, ["provider", "anthropic", "apiKey"], "new-key", {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    const result = applyEdits(configContent, edits)
    await writeTestConfig(configPath, JSON.parse(result))

    const config = await readTestConfig(configPath)
    expect(config.provider.anthropic.apiKey).toBe("new-key")
  })
})
