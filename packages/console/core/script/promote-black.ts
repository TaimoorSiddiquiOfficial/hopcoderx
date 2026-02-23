#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import { BlackData } from "../src/black"

const stage = process.argv[2]
if (!stage) throw new Error("Stage is required")

const root = path.resolve(process.cwd(), "..", "..", "..")

// read the secret
const ret = await $`bun sst secret list`.cwd(root).text()
const lines = ret.split("\n")
const value = lines.find((line) => line.startsWith("BDR_BLACK_LIMITS"))?.split("=")[1]
if (!value) throw new Error("BDR_BLACK_LIMITS not found")

// validate value
BlackData.validate(JSON.parse(value))

// update the secret
await $`bun sst secret set BDR_BLACK_LIMITS ${value} --stage ${stage}`
