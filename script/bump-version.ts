#!/usr/bin/env bun

const version = process.argv[2]
if (!version) {
  console.error("Usage: bun run script/bump-version.ts <version>")
  process.exit(1)
}

const files = await Array.fromAsync(
  new Bun.Glob("**/package.json").scan({ absolute: true }),
).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))

console.log(`Bumping ${files.length} package.json files to version ${version}`)

for (const file of files) {
  const text = await Bun.file(file).text()
  const updated = text.replaceAll(/"version": "[^"]+"/g, `"version": "${version}"`)
  if (text !== updated) {
    await Bun.file(file).write(updated)
    console.log(`  updated: ${file}`)
  }
}

console.log("Done")
