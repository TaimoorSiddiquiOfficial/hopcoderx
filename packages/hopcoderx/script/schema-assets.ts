#!/usr/bin/env bun

import path from "path"
import { Filesystem } from "../src/util/filesystem"
import { writeConfigSchema } from "./schema"

const themeSchemaSource = new URL("../src/cli/cmd/tui/context/theme.schema.json", import.meta.url)
const desktopThemeSchemaSource = new URL("../../ui/src/theme/desktop-theme.schema.json", import.meta.url)

export async function writeSchemaAssets(outputDir: string) {
  const outDir = path.resolve(outputDir)
  await writeConfigSchema(path.join(outDir, "config.json"))
  await Filesystem.write(path.join(outDir, "theme.json"), await Bun.file(themeSchemaSource).text())
  await Filesystem.write(path.join(outDir, "desktop-theme.json"), await Bun.file(desktopThemeSchemaSource).text())
}

if (import.meta.main) {
  const outputDir = process.argv[2]
  if (!outputDir) {
    throw new Error("Usage: bun ./script/schema-assets.ts <output-dir>")
  }
  await writeSchemaAssets(outputDir)
}
