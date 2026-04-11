import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Installation } from "../../src/installation"
import { tmpdir } from "../fixture/fixture"

describe("Installation.inferMethodFromPath", () => {
  test("detects npm global wrappers", () => {
    expect(Installation.inferMethodFromPath("C:\\Users\\Taimoor\\AppData\\Roaming\\npm\\hopcoderx.ps1")).toBe("npm")
  })

  test("detects bun global shims", () => {
    expect(Installation.inferMethodFromPath("C:\\Users\\Taimoor\\.bun\\bin\\hopcoderx.exe")).toBe("bun")
  })

  test("detects curl installs", () => {
    expect(Installation.inferMethodFromPath("/home/user/.hopcoderx/bin/hopcoderx")).toBe("curl")
  })
})

describe("Installation.shimConflicts", () => {
  test("detects stale bun shims that point to a missing module", async () => {
    await using tmp = await tmpdir()
    const binDir = path.join(tmp.path, ".bun", "bin")
    await fs.mkdir(binDir, { recursive: true })
    await fs.writeFile(path.join(binDir, "hopcoderx.bunx"), "..\\node_modules\\hopcoderx-ai\\bin\\hopcoderx")

    const conflicts = Installation.shimConflicts(binDir)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.manager).toBe("bun")
    expect(conflicts[0]?.shimPath).toBe(path.join(binDir, "hopcoderx.bunx"))
  })

  test("ignores bun shims when the target exists", async () => {
    await using tmp = await tmpdir()
    const binDir = path.join(tmp.path, ".bun", "bin")
    const targetDir = path.join(tmp.path, ".bun", "node_modules", "hopcoderx-ai", "bin")
    await fs.mkdir(binDir, { recursive: true })
    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(path.join(binDir, "hopcoderx.bunx"), "..\\node_modules\\hopcoderx-ai\\bin\\hopcoderx")
    await fs.writeFile(path.join(targetDir, "hopcoderx"), "#!/usr/bin/env node")

    expect(Installation.shimConflicts(binDir)).toHaveLength(0)
  })

  test("repairShimConflicts removes stale shim files", async () => {
    await using tmp = await tmpdir()
    const binDir = path.join(tmp.path, ".bun", "bin")
    await fs.mkdir(binDir, { recursive: true })
    await fs.writeFile(path.join(binDir, "hopcoderx.bunx"), "..\\node_modules\\hopcoderx-ai\\bin\\hopcoderx")
    await fs.writeFile(path.join(binDir, "hopcoderx.exe"), "broken")

    const conflicts = Installation.shimConflicts(binDir)
    const removed = Installation.repairShimConflicts(conflicts)

    expect(removed).toContain(path.join(binDir, "hopcoderx.bunx"))
    expect(removed).toContain(path.join(binDir, "hopcoderx.exe"))
    expect(Installation.shimConflicts(binDir)).toHaveLength(0)
  })
})

describe("Installation.recoveryWarnings", () => {
  test("warns when multiple managed installs are detected for a non-local launcher", () => {
    const warnings = Installation.recoveryWarnings({
      displayMethod: "npm",
      installedMethods: ["npm", "bun"],
      shimConflicts: [],
    })

    expect(warnings.some((warning) => warning.includes("Multiple global HopCoderX installs"))).toBe(true)
  })

  test("warns when the active launcher cannot be matched to an installed package manager", () => {
    const warnings = Installation.recoveryWarnings({
      displayMethod: "npm",
      installedMethods: ["bun"],
      shimConflicts: [],
    })

    expect(warnings.some((warning) => warning.includes("active launcher looks like npm"))).toBe(true)
  })

  test("does not warn about mixed installs while running in local development mode", () => {
    const warnings = Installation.recoveryWarnings({
      displayMethod: "local",
      installedMethods: ["npm", "bun"],
      shimConflicts: [],
    })

    expect(warnings).toHaveLength(0)
  })
})

describe("Installation.installedMethods", () => {
  test("detects multiple managed launchers from PATH", async () => {
    await using tmp = await tmpdir()
    const npmDir = path.join(tmp.path, "AppData", "Roaming", "npm")
    const bunDir = path.join(tmp.path, ".bun", "bin")
    await fs.mkdir(npmDir, { recursive: true })
    await fs.mkdir(bunDir, { recursive: true })
    await fs.writeFile(path.join(npmDir, "hopcoderx.ps1"), "shim")
    await fs.writeFile(path.join(bunDir, "hopcoderx.exe"), "shim")

    const methods = await Installation.installedMethods(undefined, [npmDir, bunDir].join(path.delimiter), false)

    expect(methods).toContain("npm")
    expect(methods).toContain("bun")
  })

  test("includes the active launcher path even when PATH is empty", async () => {
    await using tmp = await tmpdir()
    const npmDir = path.join(tmp.path, "AppData", "Roaming", "npm")
    await fs.mkdir(npmDir, { recursive: true })
    const execPath = path.join(npmDir, "hopcoderx.cmd")
    await fs.writeFile(execPath, "shim")

    const methods = await Installation.installedMethods(execPath, "", false)

    expect(methods).toEqual(["npm"])
  })

  test("ignores curl-style launchers when collecting managed installs", async () => {
    await using tmp = await tmpdir()
    const curlDir = path.join(tmp.path, ".hopcoderx", "bin")
    await fs.mkdir(curlDir, { recursive: true })
    await fs.writeFile(path.join(curlDir, "hopcoderx"), "shim")

    const methods = await Installation.installedMethods(undefined, curlDir, false)

    expect(methods).toHaveLength(0)
  })
})
