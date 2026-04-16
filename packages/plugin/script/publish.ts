#!/usr/bin/env bun
import { Script } from "@hopcoderx/script"
import { $ } from "bun"
import path from "path"

const dir = path.resolve(import.meta.dir, "..")
process.chdir(dir)

await $`bun tsc`
const pkg = await import("../package.json").then((m) => m.default) as {
  name: string
  version: string
  exports: Record<string, string | { import?: string; types?: string }>
}
const original = JSON.parse(JSON.stringify(pkg))

try {
  for (const [key, value] of Object.entries(pkg.exports)) {
    const source =
      typeof value === "string"
        ? value
        : value.import?.replace("./dist/", "./src/").replace(/\.js$/, ".ts") ??
          value.types?.replace("./dist/", "./src/").replace(/\.d\.ts$/, ".ts")

    if (!source) continue

    const file = source.replace("./src/", "./dist/").replace(".ts", "")
    pkg.exports[key] = JSON.parse(
      JSON.stringify({
        import: file + ".js",
        types: file + ".d.ts",
      }),
    )
  }

  await Bun.write("package.json", JSON.stringify(pkg, null, 2))

  const published = await $`npm view ${`${pkg.name}@${pkg.version}`} version`
    .quiet()
    .nothrow()
  if (published.exitCode === 0) {
    console.log(`Skipping ${pkg.name}@${pkg.version} (already published)`)
    process.exit(0)
  }

  const result = await $`bun pm pack && npm publish *.tgz --tag ${Script.channel} --access public`
    .quiet()
    .nothrow()

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString()
    if (stderr.includes("npm error need auth")) {
      throw new Error(
        "npm rejected publishing @hopcoderx/plugin because the current environment is not authenticated with npm. Configure NPM_TOKEN or run npm adduser before publishing.",
      )
    }
    if (stderr.includes("npm error 404 Not Found - PUT https://registry.npmjs.org/@hopcoderx%2fplugin")) {
      throw new Error(
        "npm rejected publishing @hopcoderx/plugin. The package exists on npm, so this usually means the configured NPM_TOKEN lacks publish permission for @hopcoderx/plugin (for example a granular token missing package access).",
      )
    }
    throw new Error(stderr || `npm publish failed with exit code ${result.exitCode}`)
  }
} finally {
  await Bun.write("package.json", JSON.stringify(original, null, 2))
}
