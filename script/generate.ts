#!/usr/bin/env bun

import { $ } from "bun"

await $`bun ./packages/hopcoderx/script/models-snapshot.ts`

await $`bun ./packages/sdk/js/script/build.ts --refresh-generated-sdk`

await $`bun dev generate > ../sdk/openapi.json`.cwd("packages/hopcoderx")

await $`./script/format.ts`
