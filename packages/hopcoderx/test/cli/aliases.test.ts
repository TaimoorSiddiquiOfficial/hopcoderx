import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { loadAliases } from "../../src/cli/aliases"
import { tmpdir } from "../fixture/fixture"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("loadAliases", () => {
  test("loads aliases from global config files without instance context", async () => {
    await using tmp = await tmpdir()
    const configDir = path.join(tmp.path, "config")
    tempDirs.push(configDir)
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(
      path.join(configDir, "hopcoderx.jsonc"),
      `{
        // comments are allowed in jsonc
        "aliases": {
          "s": "session",
          "dc": ["daemon", "start"]
        }
      }`,
      "utf8",
    )

    await expect(loadAliases(configDir)).resolves.toEqual({
      s: "session",
      dc: ["daemon", "start"],
    })
  })

  test("ignores invalid alias values", async () => {
    await using tmp = await tmpdir()
    const configDir = path.join(tmp.path, "config")
    tempDirs.push(configDir)
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(
      path.join(configDir, "hopcoderx.json"),
      JSON.stringify({
        aliases: {
          good: "status",
          alsoGood: ["models", "list"],
          bad: 42,
          alsoBad: ["ok", 1],
        },
      }),
      "utf8",
    )

    await expect(loadAliases(configDir)).resolves.toEqual({
      good: "status",
      alsoGood: ["models", "list"],
    })
  })

  test("returns an empty object when no config file exists", async () => {
    await using tmp = await tmpdir()
    const configDir = path.join(tmp.path, "config")
    tempDirs.push(configDir)
    await fs.mkdir(configDir, { recursive: true })

    await expect(loadAliases(configDir)).resolves.toEqual({})
  })
})
