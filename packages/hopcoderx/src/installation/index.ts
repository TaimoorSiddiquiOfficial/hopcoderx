import { BusEvent } from "@/bus/bus-event"
import path from "path"
import { $ } from "bun"
import z from "zod"
import { NamedError } from "@hopcoderx/util/error"
import { Log } from "../util/log"
import { Flag } from "../flag/flag"
import os from "os"
import { existsSync, readFileSync, rmSync } from "fs"

declare global {
  const HOPCODERX_VERSION: string
  const HOPCODERX_CHANNEL: string
}

export namespace Installation {
  const log = Log.create({ service: "installation" })

  export type Method = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"
  export type ManagedMethod = Exclude<Method, "curl" | "unknown">

  export type ShimConflict = {
    manager: "bun"
    shimPath: string
    expectedTarget: string
    fix: string
    relatedPaths: string[]
  }

  export type DisplayMethod = Method | "local"
  export type RecoveryStep = {
    label: string
    command?: string
    automated: boolean
  }
  export type RecoveryPlan = {
    displayMethod: DisplayMethod
    launcherPath: string
    installedMethods: ManagedMethod[]
    shimConflicts: ShimConflict[]
    warnings: string[]
    steps: RecoveryStep[]
  }

  export function launcherPath() {
    return process.env.HOPCODERX_LAUNCHER_PATH || process.execPath
  }

  function normalizeRegistry(value?: string) {
    const registry = (value || "https://registry.npmjs.org").trim()
    return registry.endsWith("/") ? registry.slice(0, -1) : registry
  }

  function resolvePackageRegistry() {
    return normalizeRegistry(process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY)
  }

  export async function displayMethod(): Promise<DisplayMethod> {
    const launcher = launcherPath()
    const inferred = process.env.HOPCODERX_LAUNCHER_PATH ? inferMethodFromPath(launcher) : undefined
    if (inferred) return inferred
    if (isLocal()) return "local"
    return method()
  }

  export function inferMethodFromPath(candidate?: string): Method | undefined {
    if (!candidate) return

    const value = candidate.replaceAll("/", "\\").toLowerCase()
    const basename = path.basename(value)
    const looksLikeHopcoderxLauncher = basename.startsWith("hopcoderx")
    if (!looksLikeHopcoderxLauncher && !value.includes("\\.hopcoderx\\bin\\") && !value.includes("\\.local\\bin\\")) {
      return
    }

    if (value.includes("\\.hopcoderx\\bin\\") || value.includes("\\.local\\bin\\")) return "curl"
    if (value.includes("\\appdata\\roaming\\npm\\")) return "npm"
    if (value.includes("\\.bun\\bin\\")) return "bun"
    if (value.includes("\\pnpm\\")) return "pnpm"
    if (value.includes("\\yarn\\")) return "yarn"
    if (value.includes("\\scoop\\")) return "scoop"
    if (value.includes("\\chocolatey\\") || value.includes("\\choco\\")) return "choco"
    if (value.includes("/homebrew/".replaceAll("/", "\\")) || value.includes("\\linuxbrew\\") || value.includes("\\brew\\")) {
      return "brew"
    }
  }

  function extractBunShimTarget(shimPath: string) {
    try {
      const text = readFileSync(shimPath, "utf8")
      const match = text.match(/(\.\.[^"\r\n\0]*hopcoderx-ai[\\/]+bin[\\/]+hopcoderx)/)
      if (match?.[1]) {
        return path.resolve(path.dirname(shimPath), match[1])
      }
    } catch {}

    return path.resolve(path.dirname(shimPath), "..", "node_modules", "hopcoderx-ai", "bin", "hopcoderx")
  }

  export function shimConflicts(binDir = path.join(os.homedir(), ".bun", "bin")): ShimConflict[] {
    const bunxShim = path.join(binDir, "hopcoderx.bunx")
    if (!existsSync(bunxShim)) return []

    const expectedTarget = extractBunShimTarget(bunxShim)
    if (existsSync(expectedTarget)) return []

    return [
      {
        manager: "bun",
        shimPath: bunxShim,
        expectedTarget,
        fix: "Remove the stale Bun shims from ~/.bun/bin or reinstall HopCoderX with Bun to refresh them.",
        relatedPaths: [path.join(binDir, "hopcoderx"), path.join(binDir, "hopcoderx.exe"), bunxShim],
      },
    ]
  }

  export function repairShimConflicts(conflicts = shimConflicts()) {
    const removed = new Set<string>()
    for (const conflict of conflicts) {
      for (const candidate of conflict.relatedPaths) {
        if (!existsSync(candidate)) continue
        rmSync(candidate, { force: true })
        removed.add(candidate)
      }
    }
    return Array.from(removed)
  }

  function knownLauncherDirs() {
    const home = os.homedir()
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming")
    return Array.from(
      new Set(
        [
          path.join(appData, "npm"),
          path.join(home, ".bun", "bin"),
          path.join(home, ".hopcoderx", "bin"),
          path.join(home, ".local", "bin"),
        ].filter(Boolean),
      ),
    )
  }

  function launcherNames() {
    return process.platform === "win32"
      ? ["hopcoderx.exe", "hopcoderx.cmd", "hopcoderx.ps1", "hopcoderx.bat", "hopcoderx", "hopcoderx.bunx"]
      : ["hopcoderx"]
  }

  function launcherCandidates(pathValue = process.env.PATH || "", includeKnownDirs = true) {
    const pathDirs = pathValue
      .split(path.delimiter)
      .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
      .filter(Boolean)
    const dirs = Array.from(new Set([...pathDirs, ...(includeKnownDirs ? knownLauncherDirs() : [])]))
    const found = new Set<string>()

    for (const dir of dirs) {
      for (const name of launcherNames()) {
        const candidate = path.join(dir, name)
        if (existsSync(candidate)) found.add(candidate)
      }
    }

    return Array.from(found)
  }

  export async function installedMethods(
    execPath = process.execPath,
    pathValue = process.env.PATH || "",
    includeKnownDirs = true,
  ): Promise<ManagedMethod[]> {
    const found = new Set<ManagedMethod>()
    const active = inferMethodFromPath(execPath)
    if (active && active !== "curl" && active !== "unknown") found.add(active)

    for (const candidate of launcherCandidates(pathValue, includeKnownDirs)) {
      const inferred = inferMethodFromPath(candidate)
      if (inferred && inferred !== "curl" && inferred !== "unknown") {
        found.add(inferred)
      }
    }

    return Array.from(found)
  }

  export function installCommand(method: Method, target = "latest") {
    switch (method) {
      case "curl":
        return "curl -fsSL https://hopcoderx.dev/install | bash"
      case "npm":
        return `npm install -g hopcoderx-ai@${target}`
      case "yarn":
        return `yarn global add hopcoderx-ai@${target}`
      case "pnpm":
        return `pnpm install -g hopcoderx-ai@${target}`
      case "bun":
        return `bun install -g hopcoderx-ai@${target}`
      case "brew":
        return "brew reinstall hopcoderx"
      case "scoop":
        return "scoop uninstall hopcoderx && scoop install hopcoderx"
      case "choco":
        return "choco upgrade hopcoderx --yes"
      case "unknown":
        return
    }
  }

  export function uninstallCommand(method: ManagedMethod) {
    switch (method) {
      case "npm":
        return "npm uninstall -g hopcoderx-ai"
      case "yarn":
        return "yarn global remove hopcoderx-ai"
      case "pnpm":
        return "pnpm uninstall -g hopcoderx-ai"
      case "bun":
        return "bun remove -g hopcoderx-ai"
      case "brew":
        return "brew uninstall hopcoderx"
      case "scoop":
        return "scoop uninstall hopcoderx"
      case "choco":
        return "choco uninstall hopcoderx --yes"
    }
  }

  function escapePowerShell(value: string) {
    return value.replaceAll("`", "``").replaceAll('"', '`"')
  }

  export function recoveryWarnings(input: {
    displayMethod: DisplayMethod
    installedMethods: ManagedMethod[]
    shimConflicts: ShimConflict[]
  }) {
    const warnings: string[] = []
    if (input.shimConflicts.length > 0) {
      warnings.push(
        `Detected ${input.shimConflicts.length} stale Bun launcher ${input.shimConflicts.length === 1 ? "shim" : "shims"} that can shadow a working install.`,
      )
    }

    const installed = Array.from(new Set(input.installedMethods))
    if (input.displayMethod === "local") return warnings

    if (installed.length > 1) {
      warnings.push(`Multiple global HopCoderX installs were detected: ${installed.join(", ")}.`)
    }

    if (input.displayMethod === "unknown") {
      warnings.push(
        installed.length > 0
          ? `Unable to confirm the active package manager from the current launcher. Detected installs: ${installed.join(", ")}.`
          : "Unable to detect a managed HopCoderX install from the current launcher path.",
      )
      return warnings
    }

    if (input.displayMethod !== "curl") {
      const active = input.displayMethod as ManagedMethod
      if (installed.length > 0 && !installed.includes(active)) {
        warnings.push(`The active launcher looks like ${active}, but the detected global installs are ${installed.join(", ")}.`)
      }
    }

    return warnings
  }

  export async function recoveryPlan(): Promise<RecoveryPlan> {
    const display = await displayMethod()
    const installed = await installedMethods()
    const conflicts = shimConflicts()
    const warnings = recoveryWarnings({
      displayMethod: display,
      installedMethods: installed,
      shimConflicts: conflicts,
    })
    const steps: RecoveryStep[] = []

    if (conflicts.length > 0) {
      steps.push({
        label: "Remove stale Bun launcher shims",
        command: "hopcoderx repair --fix",
        automated: true,
      })
    }

    const preferredMethod =
      display !== "local" && display !== "unknown"
        ? display
        : installed[0]

    if (warnings.length > 0 && preferredMethod) {
      const reinstall = installCommand(preferredMethod)
      if (reinstall) {
        steps.push({
          label: `Reinstall HopCoderX with ${preferredMethod}`,
          command: reinstall,
          automated: false,
        })
      }
    }

    if (display !== "local" && display !== "unknown" && display !== "curl") {
      for (const method of installed) {
        if (method === display) continue
        steps.push({
          label: `Remove conflicting ${method} global install`,
          command: uninstallCommand(method),
          automated: false,
        })
      }
    }

    return {
      displayMethod: display,
      launcherPath: launcherPath(),
      installedMethods: installed,
      shimConflicts: conflicts,
      warnings,
      steps,
    }
  }

  export const Event = {
    Updated: BusEvent.define(
      "installation.updated",
      z.object({
        version: z.string(),
      }),
    ),
    UpdateAvailable: BusEvent.define(
      "installation.update-available",
      z.object({
        version: z.string(),
      }),
    ),
  }

  export const Info = z
    .object({
      version: z.string(),
      latest: z.string(),
    })
    .meta({
      ref: "InstallationInfo",
    })
  export type Info = z.infer<typeof Info>

  export async function info() {
    return {
      version: VERSION,
      latest: await latest(),
    }
  }

  export function isPreview() {
    return CHANNEL !== "latest"
  }

  export function isLocal() {
    return CHANNEL === "local"
  }

  export async function method() {
    const launchMethod = inferMethodFromPath(launcherPath())
    if (launchMethod) return launchMethod

    if (process.execPath.includes(path.join(".hopcoderx", "bin"))) return "curl"
    if (process.execPath.includes(path.join(".local", "bin"))) return "curl"
    const installed = await installedMethods()
    return installed[0] ?? "unknown"
  }

  export const UpgradeFailedError = NamedError.create(
    "UpgradeFailedError",
    z.object({
      stderr: z.string(),
    }),
  )

  async function getBrewFormula() {
    const tapFormula = await $`brew list --formula anomalyco/tap/hopcoderx`.throws(false).quiet().text()
    if (tapFormula.includes("hopcoderx")) return "anomalyco/tap/hopcoderx"
    const coreFormula = await $`brew list --formula hopcoderx`.throws(false).quiet().text()
    if (coreFormula.includes("hopcoderx")) return "hopcoderx"
    return "hopcoderx"
  }

  export async function upgrade(method: Method, target: string) {
    let cmd
    switch (method) {
      case "curl":
        cmd = $`curl -fsSL https://hopcoderx.dev/install | bash`.env({
          ...process.env,
          VERSION: target,
        })
        break
      case "npm":
      case "pnpm":
      case "bun": {
        // On Windows, npm/pnpm/bun cannot overwrite a running executable (EBUSY -4082).
        // Renaming the running .exe is allowed though — free the name so the installer
        // can write a fresh binary at the same path.
        if (process.platform === "win32") {
          const execPath = process.execPath
          const oldPath = execPath + ".old"
          await $`powershell -NoProfile -NonInteractive -Command "if (Test-Path '${execPath}') { try { Rename-Item -Path '${execPath}' -NewName '${path.basename(oldPath)}' -Force -ErrorAction Stop } catch {} }"`.throws(false).quiet()
        }
        if (method === "npm") cmd = $`npm install -g hopcoderx-ai@${target}`
        else if (method === "pnpm") cmd = $`pnpm install -g hopcoderx-ai@${target}`
        else cmd = $`bun install -g hopcoderx-ai@${target}`
        break
      }
      case "brew": {
        const formula = await getBrewFormula()
        if (formula.includes("/")) {
          cmd =
            $`brew tap anomalyco/tap && cd "$(brew --repo anomalyco/tap)" && git pull --ff-only && brew upgrade ${formula}`.env(
              {
                HOMEBREW_NO_AUTO_UPDATE: "1",
                ...process.env,
              },
            )
          break
        }
        cmd = $`brew upgrade ${formula}`.env({
          HOMEBREW_NO_AUTO_UPDATE: "1",
          ...process.env,
        })
        break
      }
      case "choco":
        cmd = $`echo Y | choco upgrade hopcoderx --version=${target}`
        break
      case "scoop":
        cmd = $`scoop install hopcoderx@${target}`
        break
      default:
        throw new Error(`Unknown method: ${method}`)
    }
    const result = await cmd.quiet().throws(false)
    if (result.exitCode !== 0) {
      const stderr = method === "choco" ? "not running from an elevated command shell" : result.stderr.toString("utf8")
      throw new UpgradeFailedError({
        stderr: stderr,
      })
    }
    log.info("upgraded", {
      method,
      target,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    })
    // Clean up the renamed .old backup on Windows (best-effort)
    if (process.platform === "win32") {
      const oldPath = process.execPath + ".old"
      await $`powershell -NoProfile -NonInteractive -Command "Remove-Item -Path '${oldPath}' -Force -ErrorAction SilentlyContinue"`.throws(false).quiet()
    }
    // Verify the newly installed binary actually works. Use `npm exec` so we
    // invoke the fresh wrapper (not the still-running old binary).
    const verify = await $`npm exec --yes -- hopcoderx --version`.quiet().nothrow()
    if (verify.exitCode !== 0) {
      const platformMap: Record<string, string> = { darwin: "darwin", linux: "linux", win32: "windows" }
      const platform = platformMap[process.platform] ?? process.platform
      const arch = process.arch
      const base = `hopcoderx-${platform}-${arch}`
      throw new UpgradeFailedError({
        stderr:
          `The main package installed but the platform binary is missing.\n` +
          `Fix: run  npm install -g ${base}  or  npm install -g ${base}-baseline`,
      })
    }
  }

  /**
   * Returns true if the given stderr string indicates a Windows EBUSY error
   * (the running executable could not be overwritten by the package manager).
   */
  export function isEbusyError(stderr: string): boolean {
    return process.platform === "win32" && (stderr.includes("EBUSY") || stderr.includes("resource busy or locked") || stderr.includes("-4082"))
  }

  /**
   * Writes and launches a detached PowerShell script that waits for the current
   * process to exit, then retries the npm upgrade.  Call this when `isEbusyError`
   * is true and the rename trick was not sufficient.
   */
  export async function scheduleWindowsUpgrade(
    target: string,
    method: "npm" | "pnpm" | "bun",
  ): Promise<{ scriptPath: string; logPath: string }> {
    const pid = process.pid
    const installCmd = installCommand(method, target)
    if (!installCmd) throw new Error(`Could not build install command for ${method}`)
    const oldBackup = process.execPath.replace(/\\/g, "\\\\") + ".old"
    const tmpDir = process.env["TEMP"] ?? process.env["TMP"] ?? "C:\\Temp"
    const suffix = `${Date.now()}-${pid}`
    const psFile = path.join(tmpDir, `hopcoderx-upgrade-${suffix}.ps1`)
    const logFile = path.join(tmpDir, `hopcoderx-upgrade-${suffix}.log`)
    const escapedInstallCmd = escapePowerShell(installCmd)
    const escapedBackup = escapePowerShell(oldBackup)
    const escapedLog = escapePowerShell(logFile)
    const script = [
      `# HopCoderX deferred upgrade — auto-generated`,
      `$ErrorActionPreference = "Stop"`,
      `$pid = ${pid}`,
      `$logFile = "${escapedLog}"`,
      `function Write-Log([string]$message) { Add-Content -Path $logFile -Value $message }`,
      `Write-Log "Waiting for HopCoderX (PID $pid) to exit..."`,
      `try { Wait-Process -Id $pid -Timeout 60 -ErrorAction SilentlyContinue } catch {}`,
      `Start-Sleep -Seconds 1`,
      `Write-Log "Running: ${escapedInstallCmd}"`,
      `$upgradeOutput = (Invoke-Expression "${escapedInstallCmd}" 2>&1 | Out-String)`,
      `if ($upgradeOutput) { Add-Content -Path $logFile -Value $upgradeOutput.TrimEnd() }`,
      `if ($LASTEXITCODE -ne 0) { Write-Log "Upgrade command failed with exit code $LASTEXITCODE"; exit $LASTEXITCODE }`,
      `Write-Log "Verifying launcher with: hopcoderx --version"`,
      `$versionOutput = (& hopcoderx --version 2>&1 | Out-String)`,
      `if ($versionOutput) { Add-Content -Path $logFile -Value $versionOutput.TrimEnd() }`,
      `if ($LASTEXITCODE -ne 0) { Write-Log "Verification failed with exit code $LASTEXITCODE"; exit $LASTEXITCODE }`,
      `# Clean up backup`,
      `if (Test-Path "${escapedBackup}") { Remove-Item -Force "${escapedBackup}" -ErrorAction SilentlyContinue }`,
      `Write-Log "HopCoderX upgraded to ${target}. You can now relaunch it."`,
    ].join("\r\n")

    await Bun.write(psFile, script)

    // Launch detached — survives after the current process exits
    Bun.spawn(
      ["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", psFile],
      { detached: true, stdio: ["ignore", "ignore", "ignore"] },
    ).unref()
    return { scriptPath: psFile, logPath: logFile }
  }

  export const VERSION = typeof HOPCODERX_VERSION === "string" ? HOPCODERX_VERSION : "local"
  export const CHANNEL = typeof HOPCODERX_CHANNEL === "string" ? HOPCODERX_CHANNEL : "local"
  export const USER_AGENT = `HopCoderX/${CHANNEL}/${VERSION}/${Flag.HOPCODERX_CLIENT}`

  export async function latest(installMethod?: Method) {
    const detectedMethod = installMethod || (await method())

    if (detectedMethod === "brew") {
      const formula = await getBrewFormula()
      if (formula.includes("/")) {
        const infoJson = await $`brew info --json=v2 ${formula}`.quiet().text()
        const info = JSON.parse(infoJson)
        const version = info.formulae?.[0]?.versions?.stable
        if (!version) throw new Error(`Could not detect version for tap formula: ${formula}`)
        return version
      }
      return fetch("https://formulae.brew.sh/api/formula/hopcoderx.json")
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.versions.stable)
    }

    if (detectedMethod === "npm" || detectedMethod === "bun" || detectedMethod === "pnpm") {
      const registry = resolvePackageRegistry()
      const channel = CHANNEL
      return fetch(`${registry}/hopcoderx-ai/${channel}`)
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.version)
    }

    if (detectedMethod === "choco") {
      return fetch(
        "https://community.chocolatey.org/api/v2/Packages?$filter=Id%20eq%20%27hopcoderx%27%20and%20IsLatestVersion&$select=Version",
        { headers: { Accept: "application/json;odata=verbose" } },
      )
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.d.results[0].Version)
    }

    if (detectedMethod === "scoop") {
      return fetch("https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/hopcoderx.json", {
        headers: { Accept: "application/json" },
      })
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.version)
    }

    return fetch("https://api.github.com/repos/TaimoorSiddiquiOfficial/hopcoderx/releases/latest")
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data: any) => data.tag_name.replace(/^v/, ""))
  }
}
