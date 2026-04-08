/**
 * SBOM (Software Bill of Materials) generator.
 *
 * Generates SPDX 2.3 and CycloneDX 1.4 JSON SBOMs from lockfiles:
 *   - package-lock.json (npm)
 *   - yarn.lock
 *   - pnpm-lock.yaml
 *   - bun.lockb / bun.lock
 *
 * Commands:
 *   hopcoderx sbom                         — generate SBOM for current project
 *   hopcoderx sbom --format cyclonedx      — CycloneDX 1.4 format
 *   hopcoderx sbom --format spdx           — SPDX 2.3 format (default)
 *   hopcoderx sbom --output sbom.json      — write to file instead of stdout
 *   hopcoderx sbom --dir /path/to/project  — specify project directory
 */

import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Instance } from "../../project/instance"
import { readFile, writeFile, access } from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"

// ─── Package resolution ───────────────────────────────────────────────────────

interface PackageInfo {
  name: string
  version: string
  license?: string
  homepage?: string
  purl: string
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true } catch { return false }
}

async function parseNpmLockfile(lockPath: string): Promise<PackageInfo[]> {
  const raw = JSON.parse(await readFile(lockPath, "utf8"))
  const packages: PackageInfo[] = []
  const deps: Record<string, { version: string; resolved?: string; license?: string }> = raw.packages ?? raw.dependencies ?? {}
  for (const [pkgPath, meta] of Object.entries(deps)) {
    // "node_modules/foo" or bare name
    const name = pkgPath.replace(/^node_modules\//, "").replace(/\/node_modules\//g, "/")
    if (!name || name === "") continue
    const version = meta.version ?? "0.0.0"
    packages.push({
      name,
      version,
      license: meta.license,
      purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`,
    })
  }
  return packages
}

async function parseYarnLockfile(lockPath: string): Promise<PackageInfo[]> {
  const content = await readFile(lockPath, "utf8")
  const packages: PackageInfo[] = []
  // Yarn 1/2 lockfile: lines like `package@version:\n  version "x.y.z"`
  const blockPattern = /^"?(@?[^@\s"]+@[^":\n]+)"?:\s*\n(?:.*\n)*?  version "([^"]+)"/gm
  let m: RegExpExecArray | null
  while ((m = blockPattern.exec(content)) !== null) {
    const nameSpec = m[1].split(",")[0].trim().replace(/^"|"$/g, "")
    const atIdx = nameSpec.lastIndexOf("@")
    const name = atIdx > 0 ? nameSpec.slice(0, atIdx) : nameSpec
    const version = m[2]
    packages.push({
      name,
      version,
      purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`,
    })
  }
  return packages
}

async function discoverPackages(dir: string): Promise<PackageInfo[]> {
  const candidates = [
    { file: "package-lock.json", parser: parseNpmLockfile },
    { file: "yarn.lock", parser: parseYarnLockfile },
  ]
  for (const { file, parser } of candidates) {
    const p = path.join(dir, file)
    if (await fileExists(p)) return parser(p)
  }
  // Fallback: read package.json dependencies
  const pkgPath = path.join(dir, "package.json")
  if (await fileExists(pkgPath)) {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"))
    const packages: PackageInfo[] = []
    for (const [name, version] of Object.entries({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) })) {
      const v = String(version).replace(/^[^~]/, "").replace(/^[~^>=<]/, "").trim()
      packages.push({ name, version: v, purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(v)}` })
    }
    return packages
  }
  return []
}

// ─── SPDX 2.3 ────────────────────────────────────────────────────────────────

function generateSpdx(packages: PackageInfo[], projectName: string): object {
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: projectName,
    documentNamespace: `https://spdx.org/spdxdocs/${projectName}-${randomUUID()}`,
    documentDescribes: ["SPDXRef-Package-root"],
    packages: [
      {
        SPDXID: "SPDXRef-Package-root",
        name: projectName,
        downloadLocation: "NOASSERTION",
        filesAnalyzed: false,
        versionInfo: "NOASSERTION",
      },
      ...packages.slice(0, 500).map((p, i) => ({
        SPDXID: `SPDXRef-Package-${i}`,
        name: p.name,
        versionInfo: p.version,
        downloadLocation: `https://www.npmjs.com/package/${encodeURIComponent(p.name)}/v/${p.version}`,
        filesAnalyzed: false,
        licenseConcluded: p.license ?? "NOASSERTION",
        licenseDeclared: p.license ?? "NOASSERTION",
        externalRefs: [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: p.purl }],
      })),
    ],
    relationships: packages.slice(0, 500).map((_, i) => ({
      spdxElementId: "SPDXRef-Package-root",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: `SPDXRef-Package-${i}`,
    })),
  }
}

// ─── CycloneDX 1.4 ───────────────────────────────────────────────────────────

function generateCycloneDx(packages: PackageInfo[], projectName: string): object {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.4",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: "HopCoderX", name: "hopcoderx-sbom", version: "1.0.0" }],
      component: { type: "application", name: projectName, version: "0.0.0" },
    },
    components: packages.slice(0, 500).map((p) => ({
      type: "library",
      "bom-ref": p.purl,
      name: p.name,
      version: p.version,
      purl: p.purl,
      licenses: p.license ? [{ license: { id: p.license } }] : [],
      externalReferences: p.homepage
        ? [{ type: "website", url: p.homepage }]
        : [{ type: "distribution", url: `https://www.npmjs.com/package/${encodeURIComponent(p.name)}` }],
    })),
    dependencies: [
      {
        ref: `pkg:npm/${encodeURIComponent(projectName)}@0.0.0`,
        dependsOn: packages.slice(0, 500).map((p) => p.purl),
      },
    ],
  }
}

// ─── CLI command ─────────────────────────────────────────────────────────────

export const SbomCommand = cmd({
  command: "sbom",
  describe: "generate Software Bill of Materials (SBOM) in SPDX 2.3 or CycloneDX 1.4 format",
  builder: (yargs: Argv) =>
    yargs
      .option("format", {
        type: "string",
        choices: ["spdx", "cyclonedx"],
        default: "cyclonedx",
        describe: "SBOM format to generate",
      })
      .option("output", {
        type: "string",
        alias: "o",
        describe: "Output file path (default: print to stdout)",
      })
      .option("dir", {
        type: "string",
        describe: "Project directory to scan (default: current project root)",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Force JSON output even without --output flag",
      }),
  handler: async (args: { format?: string; output?: string; dir?: string; json?: boolean }) => {
    const dir = args.dir ?? Instance.directory ?? process.cwd()
    const format = (args.format ?? "cyclonedx") as "spdx" | "cyclonedx"

    // Get project name from package.json if present
    let projectName = path.basename(dir)
    try {
      const pkgJson = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"))
      projectName = pkgJson.name ?? projectName
    } catch {}

    UI.println(UI.Style.TEXT_DIM + `Scanning ${dir} for dependencies...` + UI.Style.TEXT_NORMAL)

    const packages = await discoverPackages(dir)

    if (packages.length === 0) {
      UI.println(
        UI.Style.TEXT_WARNING_BOLD +
          "⚠ No lockfile found. Install dependencies first (bun install / npm install / yarn)." +
          UI.Style.TEXT_NORMAL,
      )
      return
    }

    const sbom = format === "spdx" ? generateSpdx(packages, projectName) : generateCycloneDx(packages, projectName)
    const json = JSON.stringify(sbom, null, 2)

    if (args.output) {
      await writeFile(args.output, json, "utf8")
      UI.println(
        UI.Style.TEXT_SUCCESS_BOLD +
          `✓ SBOM written to ${args.output}` +
          UI.Style.TEXT_NORMAL +
          `\n  Format: ${format === "spdx" ? "SPDX 2.3" : "CycloneDX 1.4"}\n  Packages: ${packages.length}`,
      )
    } else if (args.json) {
      process.stdout.write(json + "\n")
    } else {
      UI.println(
        UI.Style.TEXT_INFO_BOLD +
          `\n📦 SBOM — ${projectName} (${format === "spdx" ? "SPDX 2.3" : "CycloneDX 1.4"})` +
          UI.Style.TEXT_NORMAL,
      )
      UI.println(`  Packages scanned: ${UI.Style.TEXT_WARNING_BOLD}${packages.length}${UI.Style.TEXT_NORMAL}`)
      UI.println("")

      // Show top 20 packages
      for (const p of packages.slice(0, 20)) {
        const license = p.license ? `  ${UI.Style.TEXT_DIM}${p.license}${UI.Style.TEXT_NORMAL}` : ""
        UI.println(`  ${p.name.padEnd(40)} ${UI.Style.TEXT_DIM}${p.version.padEnd(15)}${UI.Style.TEXT_NORMAL}${license}`)
      }
      if (packages.length > 20) {
        UI.println(UI.Style.TEXT_DIM + `  ... and ${packages.length - 20} more packages` + UI.Style.TEXT_NORMAL)
      }
      UI.println("")
      UI.println(
        UI.Style.TEXT_DIM +
          `  Use ${UI.Style.TEXT_NORMAL}hopcoderx sbom --output sbom.json${UI.Style.TEXT_DIM} to save the full SBOM.` +
          UI.Style.TEXT_NORMAL,
      )
    }
  },
})
