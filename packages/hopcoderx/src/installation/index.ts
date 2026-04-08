import { BusEvent } from "@/bus/bus-event"
import path from "path"
import { $ } from "bun"
import z from "zod"
import { NamedError } from "@hopcoderx/util/error"
import { Log } from "../util/log"
import { iife } from "@/util/iife"
import { Flag } from "../flag/flag"

declare global {
  const HOPCODERX_VERSION: string
  const HOPCODERX_CHANNEL: string
}

export namespace Installation {
  const log = Log.create({ service: "installation" })

  export type Method = Awaited<ReturnType<typeof method>>

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
    if (process.execPath.includes(path.join(".hopcoderx", "bin"))) return "curl"
    if (process.execPath.includes(path.join(".local", "bin"))) return "curl"
    const exec = process.execPath.toLowerCase()

    const checks = [
      {
        name: "npm" as const,
        command: () => $`npm list -g --depth=0`.throws(false).quiet().text(),
      },
      {
        name: "yarn" as const,
        command: () => $`yarn global list`.throws(false).quiet().text(),
      },
      {
        name: "pnpm" as const,
        command: () => $`pnpm list -g --depth=0`.throws(false).quiet().text(),
      },
      {
        name: "bun" as const,
        command: () => $`bun pm ls -g`.throws(false).quiet().text(),
      },
      {
        name: "brew" as const,
        command: () => $`brew list --formula hopcoderx`.throws(false).quiet().text(),
      },
      {
        name: "scoop" as const,
        command: () => $`scoop list hopcoderx`.throws(false).quiet().text(),
      },
      {
        name: "choco" as const,
        command: () => $`choco list --limit-output hopcoderx`.throws(false).quiet().text(),
      },
    ]

    checks.sort((a, b) => {
      const aMatches = exec.includes(a.name)
      const bMatches = exec.includes(b.name)
      if (aMatches && !bMatches) return -1
      if (!aMatches && bMatches) return 1
      return 0
    })

    for (const check of checks) {
      const output = await check.command()
      const installedName =
        check.name === "brew" || check.name === "choco" || check.name === "scoop" ? "hopcoderx" : "hopcoderx-ai"
      if (output.includes(installedName)) {
        return check.name
      }
    }

    return "unknown"
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
    await $`${process.execPath} --version`.nothrow().quiet().text()
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
  export async function scheduleWindowsUpgrade(target: string, method: "npm" | "pnpm" | "bun"): Promise<void> {
    const pid = process.pid
    const installCmd = method === "npm"
      ? `npm install -g hopcoderx-ai@${target}`
      : method === "pnpm"
      ? `pnpm install -g hopcoderx-ai@${target}`
      : `bun install -g hopcoderx-ai@${target}`
    const oldBackup = process.execPath.replace(/\\/g, "\\\\") + ".old"
    const script = [
      `# HopCoderX deferred upgrade — auto-generated`,
      `$pid = ${pid}`,
      `Write-Host "Waiting for HopCoderX (PID $pid) to exit..."`,
      `try { Wait-Process -Id $pid -Timeout 60 -ErrorAction SilentlyContinue } catch {}`,
      `Start-Sleep -Seconds 1`,
      `Write-Host "Running: ${installCmd}"`,
      `Invoke-Expression "${installCmd}"`,
      `# Clean up backup`,
      `if (Test-Path "${oldBackup}") { Remove-Item -Force "${oldBackup}" -ErrorAction SilentlyContinue }`,
      `Write-Host "HopCoderX upgraded to ${target}. You can now relaunch it."`,
    ].join("\r\n")

    const tmpDir = process.env["TEMP"] ?? process.env["TMP"] ?? "C:\\Temp"
    const psFile = path.join(tmpDir, "hopcoderx-upgrade.ps1")
    await Bun.write(psFile, script)

    // Launch detached — survives after the current process exits
    Bun.spawn(
      ["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", psFile],
      { detached: true, stdio: ["ignore", "ignore", "ignore"] },
    ).unref()
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
      const registry = await iife(async () => {
        const r = (await $`npm config get registry`.quiet().nothrow().text()).trim()
        const reg = r || "https://registry.npmjs.org"
        return reg.endsWith("/") ? reg.slice(0, -1) : reg
      })
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
