function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

export namespace Flag {
  export const HOPCODERX_AUTO_SHARE = truthy("HOPCODERX_AUTO_SHARE")
  export const HOPCODERX_GIT_BASH_PATH = process.env["HOPCODERX_GIT_BASH_PATH"]
  export const HOPCODERX_CONFIG = process.env["HOPCODERX_CONFIG"]
  export declare const HOPCODERX_CONFIG_DIR: string | undefined
  export const HOPCODERX_CONFIG_CONTENT = process.env["HOPCODERX_CONFIG_CONTENT"]
  export const HOPCODERX_DISABLE_AUTOUPDATE = truthy("HOPCODERX_DISABLE_AUTOUPDATE")
  export const HOPCODERX_DISABLE_PRUNE = truthy("HOPCODERX_DISABLE_PRUNE")
  export const HOPCODERX_DISABLE_TERMINAL_TITLE = truthy("HOPCODERX_DISABLE_TERMINAL_TITLE")
  export const HOPCODERX_PERMISSION = process.env["HOPCODERX_PERMISSION"]
  export const HOPCODERX_DISABLE_DEFAULT_PLUGINS = truthy("HOPCODERX_DISABLE_DEFAULT_PLUGINS")
  export const HOPCODERX_DISABLE_LSP_DOWNLOAD = truthy("HOPCODERX_DISABLE_LSP_DOWNLOAD")
  export const HOPCODERX_ENABLE_EXPERIMENTAL_MODELS = truthy("HOPCODERX_ENABLE_EXPERIMENTAL_MODELS")
  export const HOPCODERX_DISABLE_AUTOCOMPACT = truthy("HOPCODERX_DISABLE_AUTOCOMPACT")
  export const HOPCODERX_DISABLE_MODELS_FETCH = truthy("HOPCODERX_DISABLE_MODELS_FETCH")
  export const HOPCODERX_DISABLE_CLAUDE_CODE = truthy("HOPCODERX_DISABLE_CLAUDE_CODE")
  export const HOPCODERX_DISABLE_CLAUDE_CODE_PROMPT =
    HOPCODERX_DISABLE_CLAUDE_CODE || truthy("HOPCODERX_DISABLE_CLAUDE_CODE_PROMPT")
  export const HOPCODERX_DISABLE_CLAUDE_CODE_SKILLS =
    HOPCODERX_DISABLE_CLAUDE_CODE || truthy("HOPCODERX_DISABLE_CLAUDE_CODE_SKILLS")
  export const HOPCODERX_DISABLE_EXTERNAL_SKILLS =
    HOPCODERX_DISABLE_CLAUDE_CODE_SKILLS || truthy("HOPCODERX_DISABLE_EXTERNAL_SKILLS")
  export declare const HOPCODERX_DISABLE_PROJECT_CONFIG: boolean
  export const HOPCODERX_FAKE_VCS = process.env["HOPCODERX_FAKE_VCS"]
  export declare const HOPCODERX_CLIENT: string
  export const HOPCODERX_SERVER_PASSWORD = process.env["HOPCODERX_SERVER_PASSWORD"]
  export const HOPCODERX_SERVER_USERNAME = process.env["HOPCODERX_SERVER_USERNAME"]
  export const HOPCODERX_ENABLE_QUESTION_TOOL = truthy("HOPCODERX_ENABLE_QUESTION_TOOL")

  // Experimental
  export const HOPCODERX_EXPERIMENTAL = truthy("HOPCODERX_EXPERIMENTAL")
  export const HOPCODERX_EXPERIMENTAL_FILEWATCHER = truthy("HOPCODERX_EXPERIMENTAL_FILEWATCHER")
  export const HOPCODERX_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("HOPCODERX_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const HOPCODERX_EXPERIMENTAL_ICON_DISCOVERY =
    HOPCODERX_EXPERIMENTAL || truthy("HOPCODERX_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["HOPCODERX_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const HOPCODERX_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("HOPCODERX_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const HOPCODERX_ENABLE_EXA =
    truthy("HOPCODERX_ENABLE_EXA") || HOPCODERX_EXPERIMENTAL || truthy("HOPCODERX_EXPERIMENTAL_EXA")
  export const HOPCODERX_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("HOPCODERX_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const HOPCODERX_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("HOPCODERX_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const HOPCODERX_EXPERIMENTAL_OXFMT = HOPCODERX_EXPERIMENTAL || truthy("HOPCODERX_EXPERIMENTAL_OXFMT")
  export const HOPCODERX_EXPERIMENTAL_LSP_TY = truthy("HOPCODERX_EXPERIMENTAL_LSP_TY")
  export const HOPCODERX_EXPERIMENTAL_LSP_TOOL = HOPCODERX_EXPERIMENTAL || truthy("HOPCODERX_EXPERIMENTAL_LSP_TOOL")
  export const HOPCODERX_DISABLE_FILETIME_CHECK = truthy("HOPCODERX_DISABLE_FILETIME_CHECK")
  export const HOPCODERX_EXPERIMENTAL_PLAN_MODE = HOPCODERX_EXPERIMENTAL || truthy("HOPCODERX_EXPERIMENTAL_PLAN_MODE")
  export const HOPCODERX_EXPERIMENTAL_MARKDOWN = truthy("HOPCODERX_EXPERIMENTAL_MARKDOWN")
  export const HOPCODERX_MODELS_URL = process.env["HOPCODERX_MODELS_URL"]
  export const HOPCODERX_MODELS_PATH = process.env["HOPCODERX_MODELS_PATH"]

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for HOPCODERX_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "HOPCODERX_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("HOPCODERX_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for HOPCODERX_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "HOPCODERX_CONFIG_DIR", {
  get() {
    return process.env["HOPCODERX_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for HOPCODERX_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "HOPCODERX_CLIENT", {
  get() {
    return process.env["HOPCODERX_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
