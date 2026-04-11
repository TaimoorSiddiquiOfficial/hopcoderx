import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { writeSchemaAssets } from "../../script/schema-assets"
import { Filesystem } from "../../src/util/filesystem"

const themeSchemaSource = path.join(process.cwd(), "src", "cli", "cmd", "tui", "context", "theme.schema.json")
const desktopThemeSchemaSource = path.join(process.cwd(), "..", "ui", "src", "theme", "desktop-theme.schema.json")
const publishedThemeTargets = [
  path.join(process.cwd(), "..", "web", "public", "theme.json"),
  path.join(process.cwd(), "..", "console", "app", "public", "theme.json"),
]
const publishedDesktopThemeTargets = [
  path.join(process.cwd(), "..", "web", "public", "desktop-theme.json"),
  path.join(process.cwd(), "..", "console", "app", "public", "desktop-theme.json"),
]

describe("schema assets", () => {
  test("writes config and theme schema assets", async () => {
    await using tmp = await tmpdir()
    await writeSchemaAssets(tmp.path)

    const config = await Filesystem.readJson<Record<string, unknown>>(path.join(tmp.path, "config.json"))
    const theme = await Filesystem.readJson<Record<string, unknown>>(path.join(tmp.path, "theme.json"))
    const desktopTheme = await Filesystem.readJson<Record<string, unknown>>(path.join(tmp.path, "desktop-theme.json"))

    expect(config.allowComments).toBe(true)
    expect(config.allowTrailingCommas).toBe(true)
    expect(theme.properties).toBeDefined()
    expect(desktopTheme.properties).toBeDefined()
  })

  test("published theme schema files match the shared source", async () => {
    const source = await Filesystem.readJson(themeSchemaSource)

    for (const target of publishedThemeTargets) {
      expect(await Filesystem.readJson(target)).toEqual(source)
    }
  })

  test("published desktop theme schema files match the shared source", async () => {
    const source = await Filesystem.readText(desktopThemeSchemaSource)

    for (const target of publishedDesktopThemeTargets) {
      expect(await Filesystem.readText(target)).toEqual(source)
    }
  })

  test("sample theme files use live schema URLs", async () => {
    const tuiTheme = await Filesystem.readJson<{ $schema?: string }>(path.join(process.cwd(), "..", "..", ".hopcoderx", "themes", "mytheme.json"))
    const desktopTheme = await Filesystem.readJson<{ $schema?: string }>(
      path.join(process.cwd(), "..", "ui", "src", "theme", "themes", "hopcoderx.json"),
    )

    expect(tuiTheme.$schema).toBe("https://hopcoder.dev/theme.json")
    expect(desktopTheme.$schema).toBe("https://hopcoder.dev/desktop-theme.json")
  })
})
