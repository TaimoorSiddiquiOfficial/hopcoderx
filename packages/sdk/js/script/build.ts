#!/usr/bin/env bun

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

// In CI, skip OpenAPI regeneration - generated files are already committed
if (!process.env.CI) {
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
}

await $`rm -rf dist`
await $`bun tsc`
