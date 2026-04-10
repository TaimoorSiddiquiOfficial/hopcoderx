/**
 * Built-in MCP server catalog.
 *
 * These servers are pre-configured and require no manual setup for zero-config
 * variants. They are installed on-demand via npx/uvx.
 *
 * Launch modes:
 *   always     — started automatically when HopCoderX launches
 *   on-demand  — started when auto-detect signals a match in the current project
 *   manual     — user must explicitly enable; requires credentials / extra setup
 */

import { type Config } from "../config/config"

export namespace McpBuiltins {
  export type LaunchMode = "always" | "on-demand" | "manual"

  export interface AutoDetectRule {
    /** Strategy to test. */
    type: "git-remote" | "env-key" | "file-glob" | "package-dep" | "always"
    /** Pattern/value to match against (regex for git-remote, prefix for env-key, glob for file-glob, package name for package-dep). */
    pattern?: string
  }

  export interface BuiltinEntry {
    /** Unique key used as the config key, e.g. "builtin:github" */
    id: string
    /** Human-readable name */
    name: string
    /** Brief description */
    description: string
    /** Emoji icon */
    icon: string
    /** Category tag */
    category: string
    /** How this server is started */
    launchMode: LaunchMode
    /** Auto-detect rules — if ANY match, the server is suggested / auto-enabled */
    autoDetect: AutoDetectRule[]
    /** Whether this server requires env vars / credentials to function */
    requiresCredentials: boolean
    /** Env vars that must be set for this server (hint to user) */
    requiredEnvVars?: string[]
    /** Optional env vars that enhance functionality */
    optionalEnvVars?: string[]
    /** The full MCP config applied to hopcoderx config.mcp[id] */
    config: Config.Mcp
    /** Friendly setup guide shown in the TUI */
    setupGuide?: string
  }

  export const catalog: BuiltinEntry[] = [
    // ── CORE: always-on ──────────────────────────────────────────────────────
    {
      id: "builtin:filesystem",
      name: "Filesystem",
      description: "Read, write, search and navigate the local filesystem securely within allowed directories",
      icon: "📂",
      category: "core",
      launchMode: "always",
      autoDetect: [{ type: "always" }],
      requiresCredentials: false,
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
        enabled: true,
      },
    },
    {
      id: "builtin:memory",
      name: "Memory",
      description: "Persistent knowledge graph — remember facts, preferences, and project context across sessions",
      icon: "🧠",
      category: "core",
      launchMode: "always",
      autoDetect: [{ type: "always" }],
      requiresCredentials: false,
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
        enabled: true,
      },
    },
    {
      id: "builtin:sequential-thinking",
      name: "Sequential Thinking",
      description: "Dynamic reasoning through sequential, revisable thought steps — enables complex problem solving",
      icon: "🔮",
      category: "core",
      launchMode: "always",
      autoDetect: [{ type: "always" }],
      requiresCredentials: false,
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
        enabled: true,
      },
    },
    {
      id: "builtin:fetch",
      name: "Web Fetch",
      description: "Fetch web pages and convert them to markdown for research and reading documentation",
      icon: "🌐",
      category: "core",
      launchMode: "always",
      autoDetect: [{ type: "always" }],
      requiresCredentials: false,
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-fetch"],
        enabled: true,
      },
    },
    // ── DEVELOPMENT: on-demand ────────────────────────────────────────────────
    {
      id: "builtin:github",
      name: "GitHub",
      description: "Search repos, manage issues/PRs, read code, commit — full GitHub API via MCP",
      icon: "🐙",
      category: "vcs",
      launchMode: "on-demand",
      autoDetect: [
        { type: "git-remote", pattern: "github\\.com" },
        { type: "env-key", pattern: "GITHUB_TOKEN" },
        { type: "env-key", pattern: "GH_TOKEN" },
      ],
      requiresCredentials: true,
      requiredEnvVars: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-github"],
        environment: {
          GITHUB_PERSONAL_ACCESS_TOKEN: "${env:GITHUB_PERSONAL_ACCESS_TOKEN}",
        },
        enabled: false,
      },
      setupGuide: `1. Create a GitHub Personal Access Token at https://github.com/settings/tokens
2. Add to your shell: export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxxx
3. Enable this server in the MCP list (Ctrl+X M)`,
    },
    {
      id: "builtin:git",
      name: "Git",
      description: "Read commits, diffs, branches, file history, and blame data from any local git repository",
      icon: "🌿",
      category: "vcs",
      launchMode: "on-demand",
      autoDetect: [{ type: "file-glob", pattern: ".git" }],
      requiresCredentials: false,
      config: {
        type: "local",
        command: ["uvx", "mcp-server-git", "--repository", "."],
        enabled: false,
      },
      setupGuide: `Requires Python + uv: pip install uv
Auto-enabled when a .git directory is detected in the project root.`,
    },
    {
      id: "builtin:postgres",
      name: "PostgreSQL",
      description: "Query and inspect PostgreSQL databases — run read-only SQL, explore schemas",
      icon: "🐘",
      category: "database",
      launchMode: "on-demand",
      autoDetect: [
        { type: "env-key", pattern: "DATABASE_URL" },
        { type: "env-key", pattern: "POSTGRES_URL" },
        { type: "env-key", pattern: "PG_" },
      ],
      requiresCredentials: true,
      requiredEnvVars: ["DATABASE_URL"],
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-postgres", "${env:DATABASE_URL}"],
        enabled: false,
      },
      setupGuide: `Set DATABASE_URL=postgresql://user:pass@host/dbname in your environment.
The AI will only have read-only access to your database.`,
    },
    {
      id: "builtin:sqlite",
      name: "SQLite",
      description: "Query SQLite databases with full read/write support via AI-generated SQL",
      icon: "🗃️",
      category: "database",
      launchMode: "on-demand",
      autoDetect: [
        { type: "file-glob", pattern: "**/*.sqlite" },
        { type: "file-glob", pattern: "**/*.db" },
        { type: "file-glob", pattern: "db.sqlite3" },
      ],
      requiresCredentials: false,
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-sqlite", "--db-path", "./db.sqlite"],
        enabled: false,
      },
    },
    {
      id: "builtin:brave-search",
      name: "Brave Search",
      description: "Web and local search using Brave Search API — privacy-respecting internet search",
      icon: "🦁",
      category: "search",
      launchMode: "manual",
      autoDetect: [{ type: "env-key", pattern: "BRAVE_API_KEY" }],
      requiresCredentials: true,
      requiredEnvVars: ["BRAVE_API_KEY"],
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-brave-search"],
        environment: {
          BRAVE_API_KEY: "${env:BRAVE_API_KEY}",
        },
        enabled: false,
      },
      setupGuide: `1. Get a free Brave Search API key at https://brave.com/search/api/
2. Set BRAVE_API_KEY=your_key in your environment
3. Enable this server in the MCP list`,
    },
    {
      id: "builtin:puppeteer",
      name: "Puppeteer",
      description: "Browser automation — navigate pages, fill forms, take screenshots, extract content",
      icon: "🤖",
      category: "browser",
      launchMode: "on-demand",
      autoDetect: [
        { type: "package-dep", pattern: "puppeteer" },
        { type: "package-dep", pattern: "playwright" },
      ],
      requiresCredentials: false,
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-puppeteer"],
        enabled: false,
      },
    },
    {
      id: "builtin:slack",
      name: "Slack",
      description: "Read channels, send messages, manage workspaces — full Slack API integration",
      icon: "💬",
      category: "communication",
      launchMode: "manual",
      autoDetect: [
        { type: "env-key", pattern: "SLACK_BOT_TOKEN" },
        { type: "env-key", pattern: "SLACK_APP_TOKEN" },
      ],
      requiresCredentials: true,
      requiredEnvVars: ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"],
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-slack"],
        environment: {
          SLACK_BOT_TOKEN: "${env:SLACK_BOT_TOKEN}",
          SLACK_TEAM_ID: "${env:SLACK_TEAM_ID}",
        },
        enabled: false,
      },
      setupGuide: `1. Create a Slack App at https://api.slack.com/apps
2. Add Bot Token Scopes: channels:read, chat:write, users:read
3. Install the app to your workspace
4. Copy Bot User OAuth Token and Team ID
5. Set SLACK_BOT_TOKEN and SLACK_TEAM_ID in your environment`,
    },
    {
      id: "builtin:google-drive",
      name: "Google Drive",
      description: "Search and read Google Drive files — Docs, Sheets, Slides, and more",
      icon: "📁",
      category: "productivity",
      launchMode: "manual",
      autoDetect: [{ type: "env-key", pattern: "GDRIVE_" }],
      requiresCredentials: true,
      requiredEnvVars: ["GDRIVE_CREDENTIALS_FILE"],
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-gdrive"],
        enabled: false,
      },
      setupGuide: `1. Create a Google Cloud project and enable the Drive API
2. Download OAuth credentials JSON
3. Set GDRIVE_CREDENTIALS_FILE=/path/to/credentials.json`,
    },
    {
      id: "builtin:everything",
      name: "Everything (Demo)",
      description: "Demo server exposing all MCP capabilities — prompts, resources, tools — for testing",
      icon: "🧪",
      category: "development",
      launchMode: "manual",
      autoDetect: [],
      requiresCredentials: false,
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-everything"],
        enabled: false,
      },
    },
    {
      id: "builtin:time",
      name: "Time & Timezone",
      description: "Current time, timezone conversions, and world clock lookups",
      icon: "🕐",
      category: "core",
      launchMode: "always",
      autoDetect: [{ type: "always" }],
      requiresCredentials: false,
      config: {
        type: "local",
        command: ["npx", "-y", "mcp-server-time"],
        enabled: true,
      },
    },
    {
      id: "builtin:linear",
      name: "Linear",
      description: "Manage Linear issues, projects, teams, and cycles via the Linear API",
      icon: "📋",
      category: "productivity",
      launchMode: "manual",
      autoDetect: [{ type: "env-key", pattern: "LINEAR_API_KEY" }],
      requiresCredentials: true,
      requiredEnvVars: ["LINEAR_API_KEY"],
      config: {
        type: "local",
        command: ["npx", "-y", "@linear/mcp-server"],
        environment: {
          LINEAR_API_KEY: "${env:LINEAR_API_KEY}",
        },
        enabled: false,
      },
      setupGuide: `1. Go to Linear Settings > API > Personal API Keys
2. Create a new API key
3. Set LINEAR_API_KEY=lin_api_xxxx in your environment`,
    },
    {
      id: "builtin:aws-kb",
      name: "AWS Knowledge Base",
      description: "Query AWS Bedrock Knowledge Bases for RAG-based document retrieval",
      icon: "☁️",
      category: "cloud",
      launchMode: "manual",
      autoDetect: [
        { type: "env-key", pattern: "AWS_" },
        { type: "file-glob", pattern: ".aws/credentials" },
      ],
      requiresCredentials: true,
      requiredEnvVars: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
      config: {
        type: "local",
        command: ["uvx", "awslabs.amazon-bedrock-agent-mcp-server@latest"],
        environment: {
          AWS_ACCESS_KEY_ID: "${env:AWS_ACCESS_KEY_ID}",
          AWS_SECRET_ACCESS_KEY: "${env:AWS_SECRET_ACCESS_KEY}",
          AWS_REGION: "${env:AWS_REGION}",
        },
        enabled: false,
      },
    },
    {
      id: "builtin:figma",
      name: "Figma",
      description: "Read Figma designs — inspect components, styles, layouts, and export assets",
      icon: "🎨",
      category: "design",
      launchMode: "manual",
      autoDetect: [{ type: "env-key", pattern: "FIGMA_API_KEY" }],
      requiresCredentials: true,
      requiredEnvVars: ["FIGMA_API_KEY"],
      config: {
        type: "local",
        command: ["npx", "-y", "figma-developer-mcp", "--figma-api-key", "${env:FIGMA_API_KEY}"],
        enabled: false,
      },
      setupGuide: `1. Go to Figma Settings > Account > Personal Access Tokens
2. Generate a new token
3. Set FIGMA_API_KEY=figd_xxxx in your environment`,
    },
    {
      id: "builtin:notion",
      name: "Notion",
      description: "Search, read, create, and update Notion pages and databases",
      icon: "📝",
      category: "productivity",
      launchMode: "manual",
      autoDetect: [{ type: "env-key", pattern: "NOTION_API_KEY" }],
      requiresCredentials: true,
      requiredEnvVars: ["NOTION_API_KEY"],
      config: {
        type: "local",
        command: ["npx", "-y", "@notionhq/notion-mcp-server"],
        environment: {
          OPENAPI_MCP_HEADERS: '{"Authorization": "Bearer ${env:NOTION_API_KEY}", "Notion-Version": "2022-06-28"}',
        },
        enabled: false,
      },
      setupGuide: `1. Create a Notion integration at https://www.notion.so/my-integrations
2. Copy the Integration Secret
3. Set NOTION_API_KEY=secret_xxxx in your environment
4. Share your Notion pages/databases with the integration`,
    },
    // ── BROWSER: on-demand / auto-detected ────────────────────────────────────
    {
      id: "builtin:chrome-devtools",
      name: "Chrome DevTools",
      description: "Live browser debugging — inspect DOM, capture network, evaluate JS in the active Chrome tab",
      icon: "🔬",
      category: "browser",
      launchMode: "on-demand",
      autoDetect: [
        { type: "package-dep", pattern: "puppeteer" },
        { type: "package-dep", pattern: "playwright" },
        { type: "package-dep", pattern: "chrome-devtools-protocol" },
      ],
      requiresCredentials: false,
      config: {
        type: "local",
        command: ["npx", "-y", "chrome-devtools-mcp"],
        enabled: false,
      },
      setupGuide: `Launch Chrome with --remote-debugging-port=9222 (or enable in DevTools settings).
Auto-enabled when puppeteer/playwright deps are detected.`,
    },
    // ── DEVELOPMENT: on-demand ────────────────────────────────────────────────
    {
      id: "builtin:storybook",
      name: "Storybook",
      description: "Browse component stories, inspect args, and test UI components with AI assistance",
      icon: "📚",
      category: "development",
      launchMode: "on-demand",
      autoDetect: [
        { type: "package-dep", pattern: "@storybook/react" },
        { type: "package-dep", pattern: "@storybook/vue3" },
        { type: "package-dep", pattern: "@storybook/nextjs" },
        { type: "package-dep", pattern: "storybook" },
      ],
      requiresCredentials: false,
      config: {
        type: "local",
        command: ["npx", "-y", "@storybook/mcp"],
        enabled: false,
      },
      setupGuide: `Start Storybook first (npm run storybook).
Auto-enabled when Storybook is detected as a project dependency.`,
    },
    {
      id: "builtin:next-devtools",
      name: "Next.js DevTools",
      description: "Inspect Next.js routes, components, build output, and runtime diagnostics",
      icon: "▲",
      category: "development",
      launchMode: "on-demand",
      autoDetect: [
        { type: "package-dep", pattern: "next" },
        { type: "file-glob", pattern: "next.config.*" },
      ],
      requiresCredentials: false,
      config: {
        type: "local",
        command: ["npx", "-y", "next-devtools-mcp"],
        enabled: false,
      },
      setupGuide: `Start your Next.js dev server first.
Auto-enabled when next.js is detected in the project.`,
    },
    {
      id: "builtin:npm-mcp",
      name: "npm Registry",
      description: "Search npm packages, view READMEs, check versions, compare alternatives, audit dependencies",
      icon: "📦",
      category: "development",
      launchMode: "on-demand",
      autoDetect: [
        { type: "file-glob", pattern: "package.json" },
        { type: "file-glob", pattern: "package-lock.json" },
      ],
      requiresCredentials: false,
      config: {
        type: "local",
        command: ["npx", "-y", "@mikusnuz/npm-mcp"],
        enabled: false,
      },
      setupGuide: `No credentials needed. Auto-enabled when a package.json is detected.`,
    },
    {
      id: "builtin:mcp-inspector",
      name: "MCP Inspector",
      description: "Visual MCP debugger — browse server tools/resources/prompts and test them interactively",
      icon: "🔭",
      category: "development",
      launchMode: "manual",
      autoDetect: [],
      requiresCredentials: false,
      config: {
        type: "local",
        command: ["npx", "-y", "@mcp-use/inspector"],
        enabled: false,
      },
      setupGuide: `Developer tool — manually enable to debug and inspect running MCP servers.`,
    },
    // ── CLOUD: on-demand ──────────────────────────────────────────────────────
    {
      id: "builtin:azure",
      name: "Azure",
      description: "Manage Azure resources, subscriptions, storage accounts, databases, and services via AI",
      icon: "🔷",
      category: "cloud",
      launchMode: "manual",
      autoDetect: [
        { type: "env-key", pattern: "AZURE_CLIENT_ID" },
        { type: "env-key", pattern: "AZURE_" },
        { type: "file-glob", pattern: ".azure/**" },
        { type: "file-glob", pattern: "azure.yaml" },
      ],
      requiresCredentials: true,
      requiredEnvVars: ["AZURE_CLIENT_ID", "AZURE_TENANT_ID"],
      optionalEnvVars: ["AZURE_CLIENT_SECRET", "AZURE_SUBSCRIPTION_ID"],
      config: {
        type: "local",
        command: ["npx", "-y", "@azure/mcp@latest"],
        enabled: false,
      },
      setupGuide: `Run: az login  OR set AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_CLIENT_SECRET.
Auto-detected when .azure/ or azure.yaml is present.`,
    },
    {
      id: "builtin:firebase",
      name: "Firebase",
      description: "Manage Firestore, Auth, Storage, Hosting, and Cloud Functions via Firebase CLI MCP",
      icon: "🔥",
      category: "cloud",
      launchMode: "on-demand",
      autoDetect: [
        { type: "file-glob", pattern: "firebase.json" },
        { type: "file-glob", pattern: ".firebaserc" },
        { type: "package-dep", pattern: "firebase" },
        { type: "package-dep", pattern: "firebase-admin" },
      ],
      requiresCredentials: false,
      config: {
        type: "local",
        command: ["npx", "-y", "firebase-tools", "experimental:mcp"],
        enabled: false,
      },
      setupGuide: `Run: npx firebase-tools login to authenticate.
Auto-enabled when firebase.json or .firebaserc is detected in the project.`,
    },
    // ── COMMUNICATION: on-demand ──────────────────────────────────────────────
    {
      id: "builtin:gmail",
      name: "Gmail",
      description: "Read, search, send, and manage Gmail — auto OAuth sign-in on first run",
      icon: "📧",
      category: "communication",
      launchMode: "manual",
      autoDetect: [{ type: "env-key", pattern: "GMAIL_" }],
      requiresCredentials: false,
      config: {
        type: "local",
        command: ["npx", "-y", "@gongrzhe/server-gmail-autoauth-mcp"],
        enabled: false,
      },
      setupGuide: `On first enable, a browser window will open for Google OAuth sign-in.
No manual credential setup needed — auth token stored locally.`,
    },
    // ── PRODUCTIVITY: manual ──────────────────────────────────────────────────
    {
      id: "builtin:clickup",
      name: "ClickUp",
      description: "Manage ClickUp tasks, lists, spaces, docs, and goals across workspaces",
      icon: "✅",
      category: "productivity",
      launchMode: "manual",
      autoDetect: [{ type: "env-key", pattern: "CLICKUP_API_TOKEN" }],
      requiresCredentials: true,
      requiredEnvVars: ["CLICKUP_API_TOKEN"],
      config: {
        type: "local",
        command: ["npx", "-y", "@taazkareem/clickup-mcp-server"],
        environment: {
          CLICKUP_API_TOKEN: "${env:CLICKUP_API_TOKEN}",
        },
        enabled: false,
      },
      setupGuide: `1. Go to ClickUp Settings > Apps > API
2. Generate a Personal API Token
3. Set CLICKUP_API_TOKEN in your environment`,
    },
    {
      id: "builtin:railway",
      name: "Railway",
      description: "Deploy and manage Railway.app projects, services, variables, and logs via AI",
      icon: "🚂",
      category: "cloud",
      launchMode: "on-demand",
      autoDetect: [
        { type: "file-glob", pattern: "railway.toml" },
        { type: "file-glob", pattern: "railway.json" },
        { type: "env-key", pattern: "RAILWAY_API_TOKEN" },
      ],
      requiresCredentials: true,
      requiredEnvVars: ["RAILWAY_API_TOKEN"],
      config: {
        type: "local",
        command: ["npx", "-y", "@railway/mcp-server"],
        environment: {
          RAILWAY_API_TOKEN: "${env:RAILWAY_API_TOKEN}",
        },
        enabled: false,
      },
      setupGuide: `1. Go to railway.app → Account Settings → Tokens
2. Create a new API token
3. Set RAILWAY_API_TOKEN in your environment
Auto-detected when railway.toml or RAILWAY_API_TOKEN is present.`,
    },
  ]

  const _catalogById = new Map<string, BuiltinEntry>(catalog.map((e) => [e.id, e]))

  export function getById(id: string): BuiltinEntry | undefined {
    return _catalogById.get(id)
  }

  export function getByCategory(category: string): BuiltinEntry[] {
    return catalog.filter((e) => e.category === category)
  }

  export function getByLaunchMode(mode: LaunchMode): BuiltinEntry[] {
    return catalog.filter((e) => e.launchMode === mode)
  }

  export function getAlwaysOn(): BuiltinEntry[] {
    return getByLaunchMode("always")
  }

  export function getOnDemand(): BuiltinEntry[] {
    return getByLaunchMode("on-demand")
  }

  /** Returns the full Config.Mcp object to inject into mcp config for this builtin. */
  export function toMcpConfig(entry: BuiltinEntry, enable?: boolean): Config.Mcp {
    return {
      ...entry.config,
      enabled: enable ?? entry.config.enabled,
    }
  }
}
