import { $, semver } from "bun"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  HOPCODERX_CHANNEL: process.env["HOPCODERX_CHANNEL"],
  HOPCODERX_BUMP: process.env["HOPCODERX_BUMP"],
  HOPCODERX_VERSION: process.env["HOPCODERX_VERSION"],
  HOPCODERX_RELEASE: process.env["HOPCODERX_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.HOPCODERX_CHANNEL) return env.HOPCODERX_CHANNEL
  if (env.HOPCODERX_BUMP) return "latest"
  if (env.HOPCODERX_VERSION && !env.HOPCODERX_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.HOPCODERX_VERSION) return env.HOPCODERX_VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  const version = await fetch("https://registry.npmjs.org/hopcoderx-ai/latest")
    .then((res) => {
      if (!res.ok) return null
      return res.json()
    })
    .then((data: any) => data?.version)
    .catch(() => null)
  if (!version) return "1.0.0"
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.HOPCODERX_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

const team = [
  "actions-user",
  "hopcoderx",
  "rekram1-node",
  "thdxr",
  "kommander",
  "jayair",
  "fwang",
  "MrMushrooooom",
  "adamdotdevin",
  "iamdavidhill",
  "Brendonovich",
  "nexxeln",
  "Hona",
  "jlongster",
  "hopcoderx-agent[bot]",
  "R44VC0RP",
]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.HOPCODERX_RELEASE
  },
  get team() {
    return team
  },
}
console.log(`HopCoderX script`, JSON.stringify(Script, null, 2))
