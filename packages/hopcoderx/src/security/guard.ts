/**
 * Security Guard for HopCoderX
 *
 * Protects sensitive files and operations from accidental exposure or modification.
 * Inspired by envsitter-guard and claude-code-safety-net.
 *
 * Features:
 * - Block access to sensitive files (.env, *.pem, *.key, credentials)
 * - Warn/block dangerous git operations
 * - Policy-based tool call validation
 *
 * Usage:
 *   import { SecurityGuard } from "@/security/guard"
 *   if (SecurityGuard.isProtected(filePath)) {
 *     throw new Error("Access to protected file denied")
 *   }
 */

import { Log } from "../util/log"
import { Config } from "../config/config"

const log = Log.create({ service: "security-guard" })

/**
 * Protected file patterns - these files are blocked from read/write operations
 */
export const DEFAULT_PROTECTED_PATTERNS = [
  "**/.env*",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/credentials.*",
  "**/credentials.json",
  "**/credentials.yaml",
  "**/.ssh/**",
  "**/.ssh/*",
  "**/id_rsa*",
  "**/id_ed25519*",
  "**/.aws/credentials",
  "**/.aws/config",
  "**/.gcp/*.json",
  "**/service-account*.json",
  "**/.npmrc",
  "**/.pypirc",
  "**/.netrc",
  "**/.docker/config.json",
  "**/kubeconfig",
  "**/.kube/config",
  "**/.git/config",
  "**/.gitconfig",
  "**/.git-credentials",
  "**/.netlify",
  "**/.vercel",
  "**/config/secrets.*",
  "**/secret.*",
  "**/*.secret.*",
]

/**
 * Git safety rules - dangerous operations that require confirmation
 */
export interface GitSafetyRule {
  pattern: string
  action: "allow" | "warn" | "require_confirmation" | "block"
  message: string
}

export const GIT_SAFETY_RULES: GitSafetyRule[] = [
  {
    pattern: "git push --force",
    action: "block" as const,
    message: "Force push is blocked. Use 'git push --force-with-lease' instead or disable this rule in config.",
  },
  {
    pattern: "git push --force-with-lease",
    action: "warn" as const,
    message: "Force push with lease can overwrite remote changes. Proceed with caution.",
  },
  {
    pattern: "git reset --hard",
    action: "require_confirmation" as const,
    message: "Hard reset will discard all uncommitted changes. This action cannot be undone.",
  },
  {
    pattern: "git clean -fd",
    action: "require_confirmation" as const,
    message: "Clean will remove all untracked files and directories. This action cannot be undone.",
  },
  {
    pattern: "git checkout --",
    action: "warn" as const,
    message: "Checkout will discard unstaged changes in the specified files.",
  },
  {
    pattern: "git revert --no-commit",
    action: "warn" as const,
    message: "Revert without commit will apply changes without committing. Review before committing.",
  },
  {
    pattern: "rm -rf",
    action: "require_confirmation" as const,
    message: "Recursive delete is dangerous. This will permanently delete files.",
  },
  {
    pattern: "sudo rm",
    action: "block" as const,
    message: "Sudo delete is blocked for security reasons.",
  },
  {
    pattern: "chmod 777",
    action: "warn" as const,
    message: "Setting world-writable permissions (777) is a security risk.",
  },
  {
    pattern: "curl .* | .*sh",
    action: "warn" as const,
    message: "Piping curl to shell can execute untrusted code. Review the script first.",
  },
  {
    pattern: "wget .* -O - .* | .*sh",
    action: "warn" as const,
    message: "Piping wget to shell can execute untrusted code. Review the script first.",
  },
]

export interface ProtectionResult {
  /** Whether the path is protected */
  isProtected: boolean
  /** Pattern that matched */
  matchedPattern?: string
  /** Reason for protection */
  reason: string
}

export interface GitSafetyResult {
  /** Whether the operation is safe */
  isSafe: boolean
  /** Action required */
  action: "allow" | "warn" | "require_confirmation" | "block"
  /** Warning/error message */
  message: string
  /** Rule that matched */
  matchedRule?: GitSafetyRule
}

export interface ToolValidationResult {
  /** Whether the tool call is valid */
  isValid: boolean
  /** Action required */
  action: "allow" | "warn" | "require_confirmation" | "block"
  /** Reason */
  reason: string
}

export namespace SecurityGuard {
  let protectedPatterns: string[] = []
  let gitSafetyRules: GitSafetyRule[] = []
  let initialized = false

  /**
   * Initialize security guard with config
   */
  export async function init(): Promise<void> {
    if (initialized) return

    const config = await Config.get()

    protectedPatterns = config.security?.protectedPatterns ?? DEFAULT_PROTECTED_PATTERNS
    gitSafetyRules = config.security?.gitSafetyRules ?? GIT_SAFETY_RULES

    // Override with config if explicitly set
    if (config.security?.enabled === false) {
      log.warn("security guard disabled in config")
      protectedPatterns = []
      gitSafetyRules = []
    }

    initialized = true
    log.info("security guard initialized", {
      protectedPatternsCount: protectedPatterns.length,
      gitSafetyRulesCount: gitSafetyRules.length,
    })
  }

  /**
   * Check if a file path is protected
   */
  export function isProtected(filePath: string): ProtectionResult {
    if (!initialized) {
      log.warn("security guard not initialized, skipping protection check")
      return { isProtected: false, reason: "not initialized" }
    }

    const normalizedPath = filePath.replace(/\\/g, "/")

    for (const pattern of protectedPatterns) {
      if (matchesPattern(normalizedPath, pattern)) {
        log.info("protected file access attempt", {
          path: filePath,
          pattern,
        })
        return {
          isProtected: true,
          matchedPattern: pattern,
          reason: `File matches protected pattern: ${pattern}`,
        }
      }
    }

    return { isProtected: false, reason: "file not protected" }
  }

  /**
   * Check if a git operation is safe
   */
  export function checkGitOperation(command: string): GitSafetyResult {
    if (!initialized) {
      return { isSafe: true, action: "allow", message: "security guard not initialized" }
    }

    const normalizedCommand = command.toLowerCase().trim()

    for (const rule of gitSafetyRules) {
      if (normalizedCommand.includes(rule.pattern.toLowerCase())) {
        log.info("git safety rule matched", {
          command,
          rule: rule.pattern,
          action: rule.action,
        })

        return {
          isSafe: rule.action === "allow" || rule.action === "warn",
          action: rule.action,
          message: rule.message,
          matchedRule: rule,
        }
      }
    }

    return {
      isSafe: true,
      action: "allow",
      message: "operation safe",
    }
  }

  /**
   * Validate a tool call
   */
  export function validateToolCall(toolName: string, args: Record<string, unknown>): ToolValidationResult {
    if (!initialized) {
      return { isValid: true, action: "allow", reason: "security guard not initialized" }
    }

    // Check file operations for protected paths
    if (toolName === "read" || toolName === "edit" || toolName === "write") {
      const path = args.path as string | undefined
      if (path) {
        const protection = isProtected(path)
        if (protection.isProtected) {
          return {
            isValid: false,
            action: "block",
            reason: protection.reason,
          }
        }
      }
    }

    // Check bash commands for git safety
    if (toolName === "bash") {
      const command = args.command as string | undefined
      if (command) {
        const safety = checkGitOperation(command)
        if (safety.action === "block") {
          return {
            isValid: false,
            action: "block",
            reason: safety.message,
          }
        }
        if (safety.action === "require_confirmation") {
          return {
            isValid: true,
            action: "require_confirmation",
            reason: safety.message,
          }
        }
        if (safety.action === "warn") {
          return {
            isValid: true,
            action: "warn",
            reason: safety.message,
          }
        }
      }
    }

    return {
      isValid: true,
      action: "allow",
      reason: "tool call valid",
    }
  }

  /**
   * Get list of protected patterns
   */
  export function getProtectedPatterns(): string[] {
    return [...protectedPatterns]
  }

  /**
   * Get list of git safety rules
   */
  export function getGitSafetyRules(): GitSafetyRule[] {
    return [...gitSafetyRules]
  }

  /**
   * Add a protected pattern
   */
  export function addProtectedPattern(pattern: string): void {
    if (!protectedPatterns.includes(pattern)) {
      protectedPatterns.push(pattern)
      log.info("added protected pattern", { pattern })
    }
  }

  /**
   * Remove a protected pattern
   */
  export function removeProtectedPattern(pattern: string): boolean {
    const index = protectedPatterns.indexOf(pattern)
    if (index !== -1) {
      protectedPatterns.splice(index, 1)
      log.info("removed protected pattern", { pattern })
      return true
    }
    return false
  }
}

/**
 * Simple glob pattern matching
 * Supports: *, **, ?
 */
function matchesPattern(path: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special regex chars
    .replace(/\*\*/g, "§§") // Temp placeholder for **
    .replace(/\*/g, "[^/]*") // * matches anything except /
    .replace(/§§/g, ".*") // ** matches anything including /
    .replace(/\?/g, ".") // ? matches single char

  const regex = new RegExp(`^${regexPattern}$`, "i")
  return regex.test(path)
}
