#!/usr/bin/env node

import fs from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function detectPlatformAndArch() {
  // Map platform names
  let platform
  switch (os.platform()) {
    case "darwin":
      platform = "darwin"
      break
    case "linux":
      platform = "linux"
      break
    case "win32":
      platform = "windows"
      break
    default:
      platform = os.platform()
      break
  }

  // Map architecture names
  let arch
  switch (os.arch()) {
    case "x64":
      arch = "x64"
      break
    case "arm64":
      arch = "arm64"
      break
    case "arm":
      arch = "arm"
      break
    default:
      arch = os.arch()
      break
  }

  return { platform, arch }
}

function detectInstaller() {
  const ua = process.env.npm_config_user_agent || ""
  if (ua.startsWith("bun/")) return "bun"
  if (ua.startsWith("pnpm/")) return "pnpm"
  if (ua.startsWith("yarn/")) return "yarn"
  if (ua.startsWith("npm/")) return "npm"
  return "unknown"
}

function extractBunShimTarget(shimPath) {
  try {
    const text = fs.readFileSync(shimPath, "utf8")
    const match = text.match(/(\.\.[^"\r\n\0]*hopcoderx-ai[\\/]+bin[\\/]+hopcoderx)/)
    if (match?.[1]) {
      return path.resolve(path.dirname(shimPath), match[1])
    }
  } catch {}

  return path.resolve(path.dirname(shimPath), "..", "node_modules", "hopcoderx-ai", "bin", "hopcoderx")
}

function findBrokenBunShim(binDir = path.join(os.homedir(), ".bun", "bin")) {
  const bunxShim = path.join(binDir, "hopcoderx.bunx")
  if (!fs.existsSync(bunxShim)) return null

  const expectedTarget = extractBunShimTarget(bunxShim)
  if (fs.existsSync(expectedTarget)) return null

  return {
    bunxShim,
    expectedTarget,
    related: [path.join(binDir, "hopcoderx"), path.join(binDir, "hopcoderx.exe"), bunxShim],
  }
}

function cleanupBrokenBunShim(installer) {
  if (installer === "bun") return

  const broken = findBrokenBunShim()
  if (!broken) return

  const removed = []
  for (const candidate of broken.related) {
    if (!fs.existsSync(candidate)) continue
    fs.unlinkSync(candidate)
    removed.push(candidate)
  }

  if (removed.length === 0) return

  console.warn("Removed stale Bun HopCoderX shim(s):")
  for (const candidate of removed) {
    console.warn(`  ${candidate}`)
  }
  console.warn(`These shims pointed to a missing module target: ${broken.expectedTarget}`)
}

function findBinary() {
  const { platform, arch } = detectPlatformAndArch()
  const packageName = `hopcoderx-${platform}-${arch}`
  const binaryName = platform === "windows" ? "hopcoderx.exe" : "hopcoderx"

  try {
    // Use require.resolve to find the package
    const packageJsonPath = require.resolve(`${packageName}/package.json`)
    const packageDir = path.dirname(packageJsonPath)
    const binaryPath = path.join(packageDir, "bin", binaryName)

    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Binary not found at ${binaryPath}`)
    }

    return { binaryPath, binaryName }
  } catch (error) {
    throw new Error(`Could not find package ${packageName}: ${error.message}`)
  }
}

function prepareBinDirectory(binaryName) {
  const binDir = path.join(__dirname, "bin")
  const targetPath = path.join(binDir, binaryName)

  // Ensure bin directory exists
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true })
  }

  // Remove existing binary/symlink if it exists
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath)
  }

  return { binDir, targetPath }
}

function symlinkBinary(sourcePath, binaryName) {
  const { targetPath } = prepareBinDirectory(binaryName)

  fs.symlinkSync(sourcePath, targetPath)
  console.log(`hopcoderx binary symlinked: ${targetPath} -> ${sourcePath}`)

  // Verify the file exists after operation
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Failed to symlink binary to ${targetPath}`)
  }
}

async function main() {
  try {
    const installer = detectInstaller()
    const { platform, arch } = detectPlatformAndArch()
    const { binaryPath } = findBinary()
    const target = path.join(__dirname, "bin", ".hopcoderx")
    if (fs.existsSync(target)) fs.unlinkSync(target)
    if (platform === "windows") {
      // Windows: can't symlink without admin — copy instead
      fs.copyFileSync(binaryPath, target)
      console.log(`hopcoderx binary cached at ${target}`)
    } else {
      try {
        fs.linkSync(binaryPath, target)
      } catch {
        fs.copyFileSync(binaryPath, target)
      }
      fs.chmodSync(target, 0o755)
    }
    cleanupBrokenBunShim(installer)
  } catch (error) {
    console.error("Failed to setup hopcoderx binary:", error.message)
    const { platform, arch } = detectPlatformAndArch()
    const base = `hopcoderx-${platform}-${arch}`
    console.error(`Fix: run  npm install -g ${base}  or  npm install -g ${base}-baseline`)
    process.exit(1)
  }
}

try {
  main()
} catch (error) {
  console.error("Postinstall script error:", error.message)
  process.exit(0)
}
