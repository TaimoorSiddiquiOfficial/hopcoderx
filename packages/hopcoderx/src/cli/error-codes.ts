/**
 * HopCoderX CLI Error Codes
 * 
 * Standardized error codes for all CLI errors.
 * Format: HCX-XXX where XXX is a 3-digit number
 * 
 * Ranges:
 * 001-099: Configuration errors
 * 100-199: Provider/Auth errors
 * 200-299: MCP errors
 * 300-399: Session/Agent errors
 * 400-499: Tool errors
 * 500-599: Filesystem errors
 * 600-699: Network errors
 * 700-799: CLI/UI errors
 * 900-999: Unknown/Unhandled errors
 */

export const ErrorCode = {
  // Configuration Errors (001-099)
  CONFIG_INVALID_JSON: "HCX-001",
  CONFIG_INVALID_SCHEMA: "HCX-002",
  CONFIG_DIRECTORY_TYPO: "HCX-003",
  CONFIG_MISSING_FIELD: "HCX-004",
  CONFIG_INVALID_VALUE: "HCX-005",
  CONFIG_FRONTMATTER_ERROR: "HCX-006",
  CONFIG_FILE_NOT_FOUND: "HCX-007",
  CONFIG_PERMISSION_DENIED: "HCX-008",
  
  // Provider/Auth Errors (100-199)
  PROVIDER_NOT_FOUND: "HCX-100",
  PROVIDER_INIT_FAILED: "HCX-101",
  PROVIDER_AUTH_FAILED: "HCX-102",
  PROVIDER_RATE_LIMITED: "HCX-103",
  PROVIDER_MODEL_NOT_FOUND: "HCX-104",
  PROVIDER_TIMEOUT: "HCX-105",
  PROVIDER_QUOTA_EXCEEDED: "HCX-106",
  PROVIDER_API_KEY_MISSING: "HCX-107",
  
  // MCP Errors (200-299)
  MCP_SERVER_NOT_FOUND: "HCX-200",
  MCP_CONNECTION_FAILED: "HCX-201",
  MCP_AUTH_REQUIRED: "HCX-202",
  MCP_CLIENT_REGISTRATION_FAILED: "HCX-203",
  MCP_SERVER_CRASHED: "HCX-204",
  MCP_INVALID_CONFIG: "HCX-205",
  MCP_MISSING_ENV_VAR: "HCX-206",
  MCP_TIMEOUT: "HCX-207",
  
  // Session/Agent Errors (300-399)
  SESSION_NOT_FOUND: "HCX-300",
  SESSION_CREATE_FAILED: "HCX-301",
  SESSION_FORK_FAILED: "HCX-302",
  AGENT_NOT_FOUND: "HCX-303",
  AGENT_INIT_FAILED: "HCX-304",
  AGENT_MAX_STEPS_EXCEEDED: "HCX-305",
  AGENT_TIMEOUT: "HCX-306",
  AGENT_CANCELLED: "HCX-307",
  
  // Tool Errors (400-499)
  TOOL_NOT_FOUND: "HCX-400",
  TOOL_EXECUTION_FAILED: "HCX-401",
  TOOL_INVALID_INPUT: "HCX-402",
  TOOL_PERMISSION_DENIED: "HCX-403",
  TOOL_TIMEOUT: "HCX-404",
  TOOL_OUTPUT_EXCEEDED_LIMIT: "HCX-405",
  
  // Filesystem Errors (500-599)
  FS_FILE_NOT_FOUND: "HCX-500",
  FS_DIRECTORY_NOT_FOUND: "HCX-501",
  FS_PERMISSION_DENIED: "HCX-502",
  FS_WRITE_FAILED: "HCX-503",
  FS_READ_FAILED: "HCX-504",
  FS_DISK_FULL: "HCX-505",
  FS_INVALID_PATH: "HCX-506",
  FS_SYMLINK_CYCLE: "HCX-507",
  
  // Network Errors (600-699)
  NETWORK_TIMEOUT: "HCX-600",
  NETWORK_CONNECTION_REFUSED: "HCX-601",
  NETWORK_DNS_FAILED: "HCX-602",
  NETWORK_SSL_ERROR: "HCX-603",
  NETWORK_UNREACHABLE: "HCX-604",
  NETWORK_PROXY_ERROR: "HCX-605",
  
  // CLI/UI Errors (700-799)
  CLI_INVALID_COMMAND: "HCX-700",
  CLI_INVALID_ARGUMENT: "HCX-701",
  CLI_MISSING_ARGUMENT: "HCX-702",
  CLI_USER_CANCELLED: "HCX-703",
  CLI_INTERACTIVE_FAILED: "HCX-704",
  CLI_OUTPUT_FORMAT_FAILED: "HCX-705",
  CLI_HELP_NOT_FOUND: "HCX-706",
  
  // Installation Errors (800-899)
  INSTALL_FAILED: "HCX-800",
  INSTALL_UPGRADE_FAILED: "HCX-801",
  INSTALL_UNINSTALL_FAILED: "HCX-802",
  INSTALL_SHIM_CONFLICT: "HCX-803",
  INSTALL_BINARY_NOT_FOUND: "HCX-804",
  INSTALL_DEPENDENCY_MISSING: "HCX-805",
  
  // Unknown/Unhandled Errors (900-999)
  UNKNOWN_ERROR: "HCX-900",
  UNEXPECTED_ERROR: "HCX-901",
  INTERNAL_ERROR: "HCX-902",
} as const

export type ErrorCodeValue = typeof ErrorCode[keyof typeof ErrorCode]

export interface ErrorContext {
  code: ErrorCodeValue
  message: string
  details?: Record<string, unknown>
  suggestions?: string[]
  docsUrl?: string
  fixCommand?: string
}

export function createErrorContext(
  code: ErrorCodeValue,
  message: string,
  options?: {
    details?: Record<string, unknown>
    suggestions?: string[]
    docsUrl?: string
    fixCommand?: string
  }
): ErrorContext {
  return {
    code,
    message,
    ...options,
  }
}

export function formatErrorCode(code: ErrorCodeValue): string {
  return `\x1b[2m[${code}]\x1b[0m`
}

export function getErrorRange(code: ErrorCodeValue): string {
  const num = parseInt(code.split("-")[1])
  
  if (num >= 0 && num < 100) return "Configuration"
  if (num >= 100 && num < 200) return "Provider/Auth"
  if (num >= 200 && num < 300) return "MCP"
  if (num >= 300 && num < 400) return "Session/Agent"
  if (num >= 400 && num < 500) return "Tool"
  if (num >= 500 && num < 600) return "Filesystem"
  if (num >= 600 && num < 700) return "Network"
  if (num >= 700 && num < 800) return "CLI/UI"
  if (num >= 800 && num < 900) return "Installation"
  return "Unknown"
}
