#!/usr/bin/env bun

const dir = path.resolve(import.meta.dir, "..")
process.chdir(dir)

import { $ } from "bun"
import fs from "fs"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

const refreshGeneratedSdk =
  process.argv.includes("--refresh-generated-sdk") || process.env.HOPCODERX_REFRESH_GENERATED_SDK === "1"
const generatedSdkPath = path.join(dir, "src/v2/gen/types.gen.ts")

if (refreshGeneratedSdk || !fs.existsSync(generatedSdkPath)) {
  await $`bun dev generate > ${dir}/openapi.json`.cwd(path.resolve(dir, "../../hopcoderx"))

  await createClient({
    input: "./openapi.json",
    output: {
      path: "./src/v2/gen",
      tsConfigPath: path.join(dir, "tsconfig.json"),
      clean: true,
    },
    plugins: [
      {
        name: "@hey-api/typescript",
        exportFromIndex: false,
      },
      {
        name: "@hey-api/sdk",
        instance: "HopCoderXClient",
        exportFromIndex: false,
        auth: false,
        paramsStructure: "flat",
      },
      {
        name: "@hey-api/client-fetch",
        exportFromIndex: false,
        baseUrl: "http://localhost:4096",
      },
    ],
  })

  await $`bun prettier --write src/gen`
  await $`bun prettier --write src/v2`
  await $`rm -f openapi.json`
} else {
  console.log("Using committed SDK generated sources")
}

await $`rm -rf dist`
// Delete stale build info so tsc doesn't skip emit when dist is missing
await $`rm -f tsconfig.tsbuildinfo`
await $`bun tsc`
