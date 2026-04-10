import { z } from "zod"
import { Config } from "../config/config"

export namespace McpRegistry {
  export const Category = z.enum([
    "adobe",
    "cloud",
    "automation",
    "design",
    "development",
    "productivity",
    "vcs",
    "database",
    "search",
    "communication",
    "browser",
    "ai",
    "game-engine",
  ])
  export type Category = z.infer<typeof Category>

  export const Platform = z.enum(["windows", "macos", "linux", "cross-platform"])
  export type Platform = z.infer<typeof Platform>

  export const Requirement = z.object({
    type: z.enum(["nodejs", "python", "binary", "app", "api-key"]),
    version: z.string().optional(),
    description: z.string(),
    installCommand: z.string().optional(),
    verifyCommand: z.string().optional(),
  })
  export type Requirement = z.infer<typeof Requirement>

  export const RegistryEntry = z.object({
    name: z.string(),
    description: z.string(),
    category: Category,
    platform: z.array(Platform),
    repository: z.string().url(),
    author: z.string(),
    stars: z.number().optional(),
    requirements: z.array(Requirement),
    config: z.lazy(() => Config.Mcp),
    setupInstructions: z.string().optional(),
    tags: z.array(z.string()),
    featured: z.boolean().optional(),
  })
  export type RegistryEntry = z.infer<typeof RegistryEntry>

  export const categories: Record<Category, { label: string; icon: string; description: string }> = {
    adobe: {
      label: "Adobe Creative Suite",
      icon: "🎨",
      description: "Control Adobe applications via MCP",
    },
    cloud: {
      label: "Cloud Services",
      icon: "☁️",
      description: "Deploy and manage cloud resources",
    },
    automation: {
      label: "Automation",
      icon: "⚙️",
      description: "Workflow automation and orchestration",
    },
    design: {
      label: "Design Tools",
      icon: "✏️",
      description: "Design and prototyping tools",
    },
    development: {
      label: "Development",
      icon: "💻",
      description: "Developer tools and utilities",
    },
    productivity: {
      label: "Productivity",
      icon: "📈",
      description: "Productivity and task management",
    },
    vcs: {
      label: "Version Control",
      icon: "🐙",
      description: "GitHub, GitLab, Bitbucket integrations",
    },
    database: {
      label: "Databases",
      icon: "🗄️",
      description: "SQL, NoSQL, and vector databases",
    },
    search: {
      label: "Search",
      icon: "🔍",
      description: "Web search and knowledge retrieval",
    },
    communication: {
      label: "Communication",
      icon: "💬",
      description: "Chat, email, and collaboration tools",
    },
    browser: {
      label: "Browser Automation",
      icon: "🌐",
      description: "Web scraping and browser control",
    },
    ai: {
      label: "AI & LLMs",
      icon: "🤖",
      description: "AI model integrations and LLM tools",
    },
    "game-engine": {
      label: "Game Engines",
      icon: "🎮",
      description: "Unreal Engine, Unity, and game development tools",
    },
  }

  export const registry: RegistryEntry[] = [
    // Adobe Creative Suite
    {
      name: "after-effects",
      description: "Control Adobe After Effects - create compositions, layers, animations via ExtendScript",
      category: "adobe",
      platform: ["windows", "macos"],
      repository: "https://github.com/Dakkshin/after-effects-mcp",
      author: "Dakkshin",
      stars: 276,
      requirements: [
        {
          type: "nodejs",
          version: ">=14.0.0",
          description: "Node.js 14 or higher",
          verifyCommand: "node --version",
        },
        {
          type: "app",
          description: "Adobe After Effects 2022 or later",
        },
      ],
      config: {
        type: "local",
        command: ["node", "after-effects-mcp/build/index.js"],
        enabled: false,
      },
      setupInstructions: `
1. Clone the repository: git clone https://github.com/Dakkshin/after-effects-mcp.git
2. Install dependencies: npm install
3. Build the project: npm run build
4. Install the AE panel: npm run install-bridge
5. Update the command path in config to point to your installation
      `,
      tags: ["adobe", "after-effects", "video", "animation", "motion-graphics"],
      featured: true,
    },
    {
      name: "photoshop",
      description: "Control Adobe Photoshop - image editing, layer manipulation, document creation via Python API",
      category: "adobe",
      platform: ["windows"],
      repository: "https://github.com/loonghao/photoshop-python-api-mcp-server",
      author: "loonghao",
      stars: 194,
      requirements: [
        {
          type: "python",
          version: ">=3.10",
          description: "Python 3.10 or higher",
          verifyCommand: "python --version",
        },
        {
          type: "app",
          description: "Adobe Photoshop CC 2017-2024 (Windows only)",
        },
      ],
      config: {
        type: "local",
        command: ["uvx", "--python", "3.10", "photoshop-mcp-server"],
        environment: {
          PS_VERSION: "2024",
        },
        enabled: false,
      },
      setupInstructions: `
1. Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh
2. Install the MCP server: uvx --python 3.10 photoshop-mcp-server
3. Set PS_VERSION environment variable to your Photoshop version (e.g., "2024")
4. Ensure Adobe Photoshop is running before using MCP tools
      `,
      tags: ["adobe", "photoshop", "image-editing", "graphics", "windows-only"],
      featured: true,
    },
    {
      name: "illustrator",
      description: "Execute scripts in Adobe Illustrator - vector graphics automation via AppleScript",
      category: "adobe",
      platform: ["macos"],
      repository: "https://github.com/spencerhhubert/illustrator-mcp-server",
      author: "spencerhhubert",
      stars: 48,
      requirements: [
        {
          type: "python",
          description: "Python 3.x with uv",
          verifyCommand: "uv --version",
        },
        {
          type: "app",
          description: "Adobe Illustrator (macOS only)",
        },
      ],
      config: {
        type: "local",
        command: ["uv", "--directory", "illustrator-mcp-server", "run", "illustrator"],
        enabled: false,
      },
      setupInstructions: `
1. Clone the repository to a known location
2. Install uv if not already installed
3. Run with: uv --directory /path/to/illustrator-mcp-server run illustrator
4. Requires macOS and Adobe Illustrator to be running
      `,
      tags: ["adobe", "illustrator", "vector", "graphics", "macos-only"],
      featured: false,
    },
    {
      name: "indesign",
      description: "Adobe InDesign automation with 35+ tools - document creation, layout, export, data merge",
      category: "adobe",
      platform: ["macos"],
      repository: "https://github.com/lucdesign/indesign-mcp-server",
      author: "lucdesign",
      stars: 13,
      requirements: [
        {
          type: "nodejs",
          version: ">=18.0.0",
          description: "Node.js 18 or higher",
          verifyCommand: "node --version",
        },
        {
          type: "app",
          description: "Adobe InDesign 2025",
        },
      ],
      config: {
        type: "local",
        command: ["node", "indesign-mcp-server/index.js"],
        enabled: false,
      },
      setupInstructions: `
1. Clone the repository: git clone https://github.com/lucdesign/indesign-mcp-server.git
2. Install dependencies: npm install
3. Update config path to point to your installation
4. Ensure Adobe InDesign is running before using MCP tools
      `,
      tags: ["adobe", "indesign", "publishing", "layout", "macos-only", "print"],
      featured: false,
    },
    {
      name: "adobe-xd",
      description: "Adobe XD file analysis and React component generation - extract designs, colors, generate code",
      category: "adobe",
      platform: ["windows", "macos"],
      repository: "https://github.com/dekdee/adobe-xd-mcp",
      author: "dekdee",
      stars: 11,
      requirements: [
        {
          type: "nodejs",
          version: ">=16.0.0",
          description: "Node.js 16 or higher",
          verifyCommand: "node --version",
        },
      ],
      config: {
        type: "local",
        command: ["node", "adobe-xd-mcp/dist/index.js"],
        enabled: false,
      },
      setupInstructions: `
1. Clone the repository: git clone https://github.com/dekdee/adobe-xd-mcp.git
2. Install dependencies: npm install
3. Build the project: npm run build
4. Update config path to point to dist/index.js
      `,
      tags: ["adobe", "xd", "design", "react", "prototype"],
      featured: false,
    },
    // Cloud & Development
    {
      name: "railway",
      description: "Deploy and manage Railway projects - deployments, logs, environment variables, databases",
      category: "cloud",
      platform: ["cross-platform"],
      repository: "https://github.com/railwayapp/railway-mcp",
      author: "Railway",
      stars: 500,
      requirements: [
        {
          type: "nodejs",
          description: "Node.js with npx",
        },
        {
          type: "api-key",
          description: "Railway API token (set RAILWAY_TOKEN)",
        },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@railway/mcp-server"],
        enabled: false,
      },
      setupInstructions: `
1. Get your Railway API token from Railway Dashboard > Settings
2. Set environment variable: RAILWAY_TOKEN=your_token
3. The MCP server will use the token automatically
      `,
      tags: ["railway", "cloud", "deployment", "hosting", "devops"],
      featured: true,
    },
    {
      name: "n8n",
      description: "Build n8n workflows with AI assistance - automation, integrations, workflow management",
      category: "automation",
      platform: ["cross-platform"],
      repository: "https://github.com/n8n-io/n8n-mcp",
      author: "n8n",
      stars: 1000,
      requirements: [
        {
          type: "nodejs",
          description: "Node.js with npx",
        },
        {
          type: "api-key",
          description: "n8n API credentials",
        },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "n8n-mcp"],
        enabled: false,
      },
      setupInstructions: `
1. Ensure n8n is running (locally or cloud)
2. Configure API credentials
3. The MCP server will connect to your n8n instance
      `,
      tags: ["n8n", "automation", "workflow", "integration", "no-code"],
      featured: true,
    },
    {
      name: "shopify",
      description: "Shopify store management - products, orders, customers, inventory via GraphQL Admin API",
      category: "cloud",
      platform: ["cross-platform"],
      repository: "https://github.com/GeLi2001/shopify-mcp",
      author: "GeLi2001",
      stars: 150,
      requirements: [
        {
          type: "nodejs",
          description: "Node.js with npx",
        },
        {
          type: "api-key",
          description: "Shopify Store domain and Access Token",
        },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@shopify/mcp-server"],
        environment: {
          SHOPIFY_STORE_DOMAIN: "your-store.myshopify.com",
          SHOPIFY_ACCESS_TOKEN: "your-access-token",
        },
        enabled: false,
      },
      setupInstructions: `
1. Create a Custom App in your Shopify Admin
2. Configure API scopes (products, orders, customers, etc.)
3. Generate Admin API access token
4. Set environment variables:
   - SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
   - SHOPIFY_ACCESS_TOKEN=your-token
5. Or provide clientId/clientSecret for OAuth (Dev Dashboard apps Jan 2026+)
      `,
      tags: ["shopify", "ecommerce", "store", "api", "graphql"],
      featured: false,
    },
    // Windows Automation
    {
      name: "windows-mcp",
      description: "Windows OS automation - file navigation, app control, UI interaction, screenshots, mouse/keyboard automation",
      category: "automation",
      platform: ["windows"],
      repository: "https://github.com/CursorTouch/Windows-MCP",
      author: "CursorTouch",
      stars: 5100,
      requirements: [
        {
          type: "python",
          version: ">=3.13",
          description: "Python 3.13 or higher",
          verifyCommand: "python --version",
        },
        {
          type: "binary",
          description: "UV package manager from Astral",
          installCommand: "pip install uv",
          verifyCommand: "uv --version",
        },
        {
          type: "app",
          description: "Windows 7, 8, 8.1, 10, or 11",
        },
      ],
      config: {
        type: "local",
        command: ["uvx", "windows-mcp"],
        enabled: false,
      },
      setupInstructions: `
1. Install Python 3.13+ and uv: pip install uv
2. Install Windows-MCP: uvx windows-mcp
3. First run may take 1-2 minutes to install dependencies
4. Set environment variables (optional):
   - WINDOWS_MCP_SCREENSHOT_SCALE: Scale factor for screenshots (0.1-1.0)
   - WINDOWS_MCP_SCREENSHOT_BACKEND: Backend for screenshots (auto/dxcam/mss/pillow)
   - ANONYMIZED_TELEMETRY: Set to "false" to disable telemetry
   - WINDOWS_MCP_DEBUG: Set to "true" for debug logging

For MSIX Claude Desktop (Windows Store), use full path to uv.exe:
  "command": ["C:\\\\Users\\\\<user>\\\\.local\\\\bin\\\\uvx.exe", "windows-mcp"]

Tools available:
- Click, Type, Scroll, Move: Mouse and keyboard control
- Screenshot: Fast desktop capture with cursor and window info
- Snapshot: Full UI tree extraction with interactive elements
- App: Launch and manage applications
- Shell: Execute PowerShell commands
- Clipboard: Read/write clipboard content
- Process: List and terminate processes
- Notification: Send Windows toast notifications
- Registry: Read/write Windows Registry
      `,
      tags: ["windows", "automation", "ui", "desktop", "screenshot", "mouse", "keyboard", "powershell"],
      featured: true,
    },
    // AI/LLM Integration
    {
      name: "gemini-cli",
      description: "Integrate Google Gemini CLI for large file analysis - leverages Gemini's massive token window for codebase understanding",
      category: "automation",
      platform: ["cross-platform"],
      repository: "https://github.com/jamubc/gemini-mcp-tool",
      author: "jamubc",
      stars: 2100,
      requirements: [
        {
          type: "nodejs",
          version: ">=16.0.0",
          description: "Node.js 16 or higher",
          verifyCommand: "node --version",
        },
        {
          type: "binary",
          description: "Google Gemini CLI installed and configured",
          installCommand: "npm install -g @google/gemini-cli",
          verifyCommand: "gemini --version",
        },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "gemini-mcp-tool"],
        enabled: false,
      },
      setupInstructions: `
1. Install Gemini CLI: npm install -g @google/gemini-cli
2. Configure Gemini CLI with your API key: gemini auth login
3. Install MCP server: npx -y gemini-mcp-tool

Usage:
- Use @ syntax to reference files: "ask gemini to analyze @src/main.js"
- General questions: "use gemini to search for latest news"
- Sandbox mode: "use gemini sandbox to test @script.py"

Tools available:
- ask-gemini: Ask Gemini for analysis or general questions
- sandbox-test: Safely execute code in Gemini's sandbox
- ping: Test connection
- help: Show Gemini CLI help

Slash commands (in Claude Code):
- /analyze: Analyze files using Gemini
- /sandbox: Test code in sandbox environment
- /help: Show help
- /ping: Test connection
      `,
      tags: ["gemini", "google", "ai", "llm", "analysis", "codebase", "large-files"],
      featured: true,
    },
    // ── Version Control ────────────────────────────────────────────────────────
    {
      name: "github",
      description: "Full GitHub API — search repos, manage issues/PRs, read code, create commits, review PRs",
      category: "vcs",
      platform: ["cross-platform"],
      repository: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
      author: "Anthropic",
      requirements: [
        { type: "nodejs", description: "Node.js with npx", verifyCommand: "node --version" },
        { type: "api-key", description: "GitHub Personal Access Token (GITHUB_PERSONAL_ACCESS_TOKEN)" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-github"],
        environment: { GITHUB_PERSONAL_ACCESS_TOKEN: "" },
        enabled: false,
      },
      setupInstructions: `1. Create a PAT at https://github.com/settings/tokens (scopes: repo, read:org)
2. Set GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxxx in your environment`,
      tags: ["github", "git", "vcs", "issues", "pull-requests", "code-review"],
      featured: true,
    },
    {
      name: "gitlab",
      description: "GitLab API — manage merge requests, issues, pipelines, and repositories",
      category: "vcs",
      platform: ["cross-platform"],
      repository: "https://github.com/zereight/gitlab-mcp",
      author: "zereight",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "api-key", description: "GitLab Personal Access Token" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "gitlab-mcp"],
        environment: { GITLAB_TOKEN: "", GITLAB_URL: "https://gitlab.com" },
        enabled: false,
      },
      setupInstructions: `Set GITLAB_TOKEN and optionally GITLAB_URL for self-hosted instances.`,
      tags: ["gitlab", "git", "vcs", "merge-requests", "ci-cd"],
      featured: false,
    },
    // ── Database ───────────────────────────────────────────────────────────────
    {
      name: "postgres",
      description: "Query PostgreSQL databases — read-only SQL execution with schema inspection",
      category: "database",
      platform: ["cross-platform"],
      repository: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
      author: "Anthropic",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "api-key", description: "DATABASE_URL connection string" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-postgres", "${env:DATABASE_URL}"],
        enabled: false,
      },
      setupInstructions: `Set DATABASE_URL=postgresql://user:pass@host/db in your environment.`,
      tags: ["postgres", "postgresql", "sql", "database"],
      featured: true,
    },
    {
      name: "sqlite",
      description: "Full read/write access to SQLite databases via AI-generated SQL",
      category: "database",
      platform: ["cross-platform"],
      repository: "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
      author: "Anthropic",
      requirements: [{ type: "nodejs", description: "Node.js with npx" }],
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-sqlite", "--db-path", "./db.sqlite"],
        enabled: false,
      },
      setupInstructions: `Update the --db-path argument to point to your SQLite database file.`,
      tags: ["sqlite", "sql", "database", "local"],
      featured: false,
    },
    {
      name: "redis",
      description: "Redis key-value store operations — get, set, delete, scan, and pub/sub",
      category: "database",
      platform: ["cross-platform"],
      repository: "https://github.com/modelcontextprotocol/servers/tree/main/src/redis",
      author: "Anthropic",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "api-key", description: "REDIS_URL connection string" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-redis", "${env:REDIS_URL}"],
        enabled: false,
      },
      setupInstructions: `Set REDIS_URL=redis://localhost:6379 in your environment.`,
      tags: ["redis", "cache", "database", "key-value"],
      featured: false,
    },
    // ── Search ─────────────────────────────────────────────────────────────────
    {
      name: "brave-search",
      description: "Privacy-respecting web and local search via Brave Search API",
      category: "search",
      platform: ["cross-platform"],
      repository: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
      author: "Anthropic",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "api-key", description: "Brave Search API key (BRAVE_API_KEY)" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-brave-search"],
        environment: { BRAVE_API_KEY: "" },
        enabled: false,
      },
      setupInstructions: `Get a free API key at https://brave.com/search/api/ and set BRAVE_API_KEY.`,
      tags: ["search", "web", "brave", "privacy"],
      featured: true,
    },
    {
      name: "exa-search",
      description: "Semantic web search powered by Exa.ai — superior for research and code lookups",
      category: "search",
      platform: ["cross-platform"],
      repository: "https://github.com/exa-labs/exa-mcp-server",
      author: "Exa",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "api-key", description: "Exa API key (EXA_API_KEY)" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "exa-mcp-server"],
        environment: { EXA_API_KEY: "" },
        enabled: false,
      },
      setupInstructions: `Get an API key at https://exa.ai and set EXA_API_KEY.`,
      tags: ["search", "web", "semantic", "exa", "research"],
      featured: true,
    },
    // ── Communication ──────────────────────────────────────────────────────────
    {
      name: "slack",
      description: "Read channels, send messages, list users — full Slack workspace integration",
      category: "communication",
      platform: ["cross-platform"],
      repository: "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
      author: "Anthropic",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "api-key", description: "Slack Bot Token (SLACK_BOT_TOKEN) and Team ID (SLACK_TEAM_ID)" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-slack"],
        environment: { SLACK_BOT_TOKEN: "", SLACK_TEAM_ID: "" },
        enabled: false,
      },
      setupInstructions: `Create a Slack App at https://api.slack.com/apps. Add scopes: channels:read, chat:write, users:read. Set SLACK_BOT_TOKEN and SLACK_TEAM_ID.`,
      tags: ["slack", "communication", "chat", "team"],
      featured: false,
    },
    {
      name: "linear",
      description: "Manage Linear issues, projects, cycles, and teams via the Linear API",
      category: "communication",
      platform: ["cross-platform"],
      repository: "https://github.com/linear/linear-mcp",
      author: "Linear",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "api-key", description: "Linear API key (LINEAR_API_KEY)" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@linear/mcp-server"],
        environment: { LINEAR_API_KEY: "" },
        enabled: false,
      },
      setupInstructions: `Go to Linear Settings > API > Personal API Keys. Set LINEAR_API_KEY=lin_api_xxxx.`,
      tags: ["linear", "issues", "project-management", "agile"],
      featured: true,
    },
    {
      name: "notion",
      description: "Search, read, create, and update Notion pages and databases",
      category: "productivity",
      platform: ["cross-platform"],
      repository: "https://github.com/makenotion/notion-mcp-server",
      author: "Notion",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "api-key", description: "Notion Integration Token (NOTION_API_KEY)" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@notionhq/notion-mcp-server"],
        environment: {
          OPENAPI_MCP_HEADERS: '{"Authorization":"Bearer $NOTION_API_KEY","Notion-Version":"2022-06-28"}',
        },
        enabled: false,
      },
      setupInstructions: `Create an integration at https://www.notion.so/my-integrations. Set NOTION_API_KEY and share pages with the integration.`,
      tags: ["notion", "notes", "wiki", "productivity", "knowledge"],
      featured: true,
    },
    // ── Browser Automation ─────────────────────────────────────────────────────
    {
      name: "puppeteer",
      description: "Browser automation — navigate, fill forms, take screenshots, extract content",
      category: "browser",
      platform: ["cross-platform"],
      repository: "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
      author: "Anthropic",
      requirements: [{ type: "nodejs", description: "Node.js with npx" }],
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-puppeteer"],
        enabled: false,
      },
      setupInstructions: `No setup required — puppeteer will download Chromium automatically on first use.`,
      tags: ["browser", "puppeteer", "automation", "scraping", "screenshots"],
      featured: true,
    },
    {
      name: "playwright",
      description: "Cross-browser automation (Chrome, Firefox, Safari) with screenshot and network capture",
      category: "browser",
      platform: ["cross-platform"],
      repository: "https://github.com/microsoft/playwright-mcp",
      author: "Microsoft",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "binary", description: "Playwright browsers", installCommand: "npx playwright install" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@playwright/mcp@latest"],
        enabled: false,
      },
      setupInstructions: `Run: npx playwright install to install browser binaries before first use.`,
      tags: ["browser", "playwright", "automation", "testing", "cross-browser"],
      featured: true,
    },
    // ── AI Tools ───────────────────────────────────────────────────────────────
    {
      name: "sequential-thinking",
      description: "Multi-step reasoning with revisable thought sequences — for complex analysis tasks",
      category: "ai",
      platform: ["cross-platform"],
      repository: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
      author: "Anthropic",
      requirements: [{ type: "nodejs", description: "Node.js with npx" }],
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
        enabled: false,
      },
      setupInstructions: `No setup required.`,
      tags: ["ai", "reasoning", "thinking", "analysis"],
      featured: true,
    },
    {
      name: "memory",
      description: "Persistent knowledge graph — remember facts, preferences, and context across sessions",
      category: "ai",
      platform: ["cross-platform"],
      repository: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
      author: "Anthropic",
      requirements: [{ type: "nodejs", description: "Node.js with npx" }],
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
        enabled: false,
      },
      setupInstructions: `No setup required. Memory persists to a local knowledge graph file.`,
      tags: ["ai", "memory", "knowledge-graph", "context", "persistence"],
      featured: true,
    },
    // ── Browser: Chrome DevTools / Mobile ─────────────────────────────────────
    {
      name: "chrome-devtools",
      description: "Chrome DevTools Protocol MCP — inspect DOM, evaluate JS, capture network and console in real-time",
      category: "browser",
      platform: ["cross-platform"],
      repository: "https://github.com/chrome-devtools-mcp/chrome-devtools-mcp",
      author: "chrome-devtools-mcp",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "app", description: "Google Chrome or Chromium with remote debugging enabled" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "chrome-devtools-mcp"],
        enabled: false,
      },
      setupInstructions: `Launch Chrome with: --remote-debugging-port=9222\nThen start this MCP server — it connects to the live tab automatically.`,
      tags: ["chrome", "devtools", "debugging", "dom", "network", "javascript", "browser"],
      featured: true,
    },
    {
      name: "mobile-mcp",
      description: "Control real iOS and Android devices — tap, swipe, screenshot, run apps via Appium-style automation",
      category: "browser",
      platform: ["cross-platform"],
      repository: "https://github.com/mobile-next/mobile-mcp",
      author: "mobilenext",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "binary", description: "Appium server or connected device/simulator" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@mobilenext/mobile-mcp"],
        enabled: false,
      },
      setupInstructions: `Connect a physical device via USB or start an emulator/simulator.\nEnsure developer mode is on (Android) or Xcode instruments available (iOS).`,
      tags: ["mobile", "ios", "android", "appium", "testing", "automation", "devices"],
      featured: true,
    },
    {
      name: "playwright-executeautomation",
      description: "Playwright MCP by ExecuteAutomation — browser control with full accessibility tree and snapshot support",
      category: "browser",
      platform: ["cross-platform"],
      repository: "https://github.com/executeautomation/playwright-mcp-server",
      author: "executeautomation",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "binary", description: "Playwright browsers", installCommand: "npx playwright install" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@executeautomation/playwright-mcp-server"],
        enabled: false,
      },
      setupInstructions: `Run: npx playwright install to install browser binaries before first use.`,
      tags: ["browser", "playwright", "automation", "testing", "accessibility", "snapshots"],
      featured: false,
    },
    // ── Development Tools ──────────────────────────────────────────────────────
    {
      name: "mcp-inspector",
      description: "Visual MCP server inspector — debug tools, browse resources, test prompts interactively",
      category: "development",
      platform: ["cross-platform"],
      repository: "https://github.com/mcp-use/inspector",
      author: "mcp-use",
      requirements: [{ type: "nodejs", description: "Node.js with npx" }],
      config: {
        type: "local",
        command: ["npx", "-y", "@mcp-use/inspector"],
        enabled: false,
      },
      setupInstructions: `Start this server then connect any MCP client to inspect and debug live MCP servers.`,
      tags: ["mcp", "inspector", "debug", "testing", "development", "tools"],
      featured: true,
    },
    {
      name: "storybook",
      description: "Storybook MCP — browse component stories, inspect args and docs, test UI components via AI",
      category: "development",
      platform: ["cross-platform"],
      repository: "https://github.com/storybookjs/mcp",
      author: "Storybook",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "app", description: "Storybook running at localhost:6006 (or configured port)" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@storybook/mcp"],
        enabled: false,
      },
      setupInstructions: `Start Storybook first (npm run storybook), then enable this server to let AI browse your components.`,
      tags: ["storybook", "components", "ui", "frontend", "react", "vue", "testing"],
      featured: true,
    },
    {
      name: "npm-mcp",
      description: "npm package manager MCP — search packages, view READMEs, check versions, audit dependencies",
      category: "development",
      platform: ["cross-platform"],
      repository: "https://github.com/mikusnuz/npm-mcp",
      author: "mikusnuz",
      requirements: [{ type: "nodejs", description: "Node.js with npx" }],
      config: {
        type: "local",
        command: ["npx", "-y", "@mikusnuz/npm-mcp"],
        enabled: false,
      },
      setupInstructions: `No setup required. Connects to the public npm registry by default.`,
      tags: ["npm", "packages", "registry", "dependencies", "javascript", "node"],
      featured: false,
    },
    {
      name: "next-devtools",
      description: "Next.js DevTools MCP — inspect routes, components, build output, and runtime diagnostics",
      category: "development",
      platform: ["cross-platform"],
      repository: "https://github.com/xinyao27/next-devtools",
      author: "xinyao27",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "app", description: "Next.js app running in dev mode" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "next-devtools-mcp"],
        enabled: false,
      },
      setupInstructions: `Start your Next.js dev server, then enable this MCP to give AI full insight into your app.`,
      tags: ["nextjs", "react", "devtools", "routing", "development", "frontend"],
      featured: true,
    },
    {
      name: "n8n-mcp",
      description: "n8n workflow automation MCP — trigger workflows, manage executions, interact with n8n via AI",
      category: "automation",
      platform: ["cross-platform"],
      repository: "https://www.npmjs.com/package/n8n-nodes-mcp",
      author: "n8n",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "app", description: "Running n8n instance" },
        { type: "api-key", description: "n8n API key (N8N_API_KEY) and base URL (N8N_BASE_URL)" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "n8n-nodes-mcp"],
        environment: { N8N_API_KEY: "", N8N_BASE_URL: "http://localhost:5678" },
        enabled: false,
      },
      setupInstructions: `Set N8N_API_KEY and N8N_BASE_URL (e.g. http://localhost:5678) in your environment.\nGenerate an API key in n8n Settings > API.`,
      tags: ["n8n", "automation", "workflow", "no-code", "orchestration"],
      featured: false,
    },
    // ── Cloud Services ─────────────────────────────────────────────────────────
    {
      name: "azure",
      description: "Azure MCP — manage Azure resources, subscriptions, storage, databases, and services via AI",
      category: "cloud",
      platform: ["cross-platform"],
      repository: "https://github.com/Azure/azure-mcp",
      author: "Microsoft",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "binary", description: "Azure CLI (az) logged in, or AZURE_* env vars set" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@azure/mcp@latest"],
        enabled: false,
      },
      setupInstructions: `Run: az login  OR set AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_CLIENT_SECRET env vars.\nWindows users: @azure/mcp-win32-x64 is automatically selected.`,
      tags: ["azure", "microsoft", "cloud", "resources", "storage", "databases", "subscriptions"],
      featured: true,
    },
    {
      name: "firebase",
      description: "Firebase MCP — manage Firestore, Auth, Storage, Hosting, and Functions via the Firebase CLI",
      category: "cloud",
      platform: ["cross-platform"],
      repository: "https://github.com/firebase/firebase-tools",
      author: "Google / Firebase",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "app", description: "Firebase CLI authenticated (firebase login)" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "firebase-tools", "experimental:mcp"],
        enabled: false,
      },
      setupInstructions: `Run: npx firebase-tools login\nThen enable this MCP — the AI can manage your Firebase project directly.`,
      tags: ["firebase", "google", "cloud", "firestore", "auth", "storage", "hosting", "functions"],
      featured: true,
    },
    {
      name: "salesforce",
      description: "Salesforce MCP — query Salesforce orgs, manage records, run SOQL, deploy metadata",
      category: "cloud",
      platform: ["cross-platform"],
      repository: "https://github.com/salesforce/mcp",
      author: "Salesforce",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "app", description: "Salesforce CLI (sf) authenticated to an org" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@salesforce/mcp"],
        enabled: false,
      },
      setupInstructions: `Run: sf org login web\nThen enable this MCP to manage Salesforce records, metadata, and deployments.`,
      tags: ["salesforce", "crm", "soql", "apex", "metadata", "cloud", "enterprise"],
      featured: false,
    },
    // ── Design Tools ───────────────────────────────────────────────────────────
    {
      name: "figma-developer",
      description: "Figma Developer MCP — read designs, inspect components, extract styles, and export assets via AI",
      category: "design",
      platform: ["cross-platform"],
      repository: "https://github.com/GLips/Figma-Context-MCP",
      author: "GLips",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "api-key", description: "Figma Personal Access Token (FIGMA_API_KEY)" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "figma-developer-mcp", "--figma-api-key", "${env:FIGMA_API_KEY}"],
        enabled: false,
      },
      setupInstructions: `Go to Figma Settings > Account > Personal Access Tokens.\nSet FIGMA_API_KEY=figd_xxxx in your environment.`,
      tags: ["figma", "design", "components", "styles", "assets", "ui", "ux"],
      featured: true,
    },
    {
      name: "figma-console",
      description: "Figma Console MCP — debug Figma plugins with real-time console output and plugin inspection",
      category: "design",
      platform: ["cross-platform"],
      repository: "https://www.npmjs.com/package/figma-console-mcp",
      author: "figma-console-mcp",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "app", description: "Figma Desktop with developer mode enabled" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "figma-console-mcp"],
        enabled: false,
      },
      setupInstructions: `Enable Figma Developer Mode in Figma Preferences > General.\nConnect to the Figma Desktop app to stream plugin console output.`,
      tags: ["figma", "plugin", "console", "debugging", "development", "design"],
      featured: false,
    },
    {
      name: "blueprint-extractor",
      description: "Blueprint Extractor MCP — extract design blueprints, component specs, and tokens from Figma files",
      category: "design",
      platform: ["cross-platform"],
      repository: "https://www.npmjs.com/package/blueprint-extractor-mcp",
      author: "blueprint-extractor-mcp",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "api-key", description: "Figma API key (FIGMA_API_KEY)" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "blueprint-extractor-mcp"],
        environment: { FIGMA_API_KEY: "" },
        enabled: false,
      },
      setupInstructions: `Set FIGMA_API_KEY in your environment. Use to extract component blueprints for code generation.`,
      tags: ["figma", "blueprint", "design-tokens", "components", "codegen", "design"],
      featured: false,
    },
    // ── Communication ──────────────────────────────────────────────────────────
    {
      name: "gmail-autoauth",
      description: "Gmail MCP with auto OAuth — read, search, send, and manage Gmail without manual token setup",
      category: "communication",
      platform: ["cross-platform"],
      repository: "https://github.com/gongrzhe/server-gmail-autoauth-mcp",
      author: "gongrzhe",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "api-key", description: "Google OAuth credentials (auto-setup on first run)" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@gongrzhe/server-gmail-autoauth-mcp"],
        enabled: false,
      },
      setupInstructions: `On first run the server opens a browser for Google OAuth sign-in.\nNo manual credential setup needed — auth token is stored locally.`,
      tags: ["gmail", "email", "google", "communication", "oauth", "messages"],
      featured: true,
    },
    {
      name: "clickup",
      description: "ClickUp MCP — manage tasks, lists, spaces, docs, and goals across ClickUp workspaces",
      category: "productivity",
      platform: ["cross-platform"],
      repository: "https://github.com/taazkareem/clickup-mcp-server",
      author: "taazkareem",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "api-key", description: "ClickUp API token (CLICKUP_API_TOKEN)" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@taazkareem/clickup-mcp-server"],
        environment: { CLICKUP_API_TOKEN: "" },
        enabled: false,
      },
      setupInstructions: `Go to ClickUp Settings > Apps > API.\nGenerate a personal API token and set CLICKUP_API_TOKEN in your environment.`,
      tags: ["clickup", "tasks", "project-management", "productivity", "agile", "teams"],
      featured: false,
    },
    // ── Game Engines ───────────────────────────────────────────────────────────
    {
      name: "unreal-engine",
      description: "Unreal Engine MCP — control UE Editor via AI: spawn actors, run Blueprint nodes, manage assets",
      category: "game-engine",
      platform: ["windows", "macos", "linux"],
      repository: "https://www.npmjs.com/package/ue-mcp",
      author: "ue-mcp",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "app", description: "Unreal Engine 5.x Editor running with the MCP plugin enabled" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "ue-mcp"],
        enabled: false,
      },
      setupInstructions: `1. Install the UE MCP plugin into your Unreal project\n2. Enable the plugin in the UE Editor\n3. Start this server — it connects to the Editor via REST/WebSocket`,
      tags: ["unreal", "ue5", "gamedev", "blueprint", "actors", "assets", "c++"],
      featured: true,
    },
    {
      name: "unreal-master",
      description: "Unreal Master MCP — advanced Unreal Engine integration with full project management and Blueprint generation",
      category: "game-engine",
      platform: ["windows", "macos", "linux"],
      repository: "https://www.npmjs.com/package/unreal-master-mcp-server",
      author: "unreal-master-mcp-server",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "app", description: "Unreal Engine 5.x Editor" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "unreal-master-mcp-server"],
        enabled: false,
      },
      setupInstructions: `Configure Unreal Engine to accept remote connections, then start this server.\nProvides additional Blueprint generation and project management capabilities beyond ue-mcp.`,
      tags: ["unreal", "ue5", "gamedev", "blueprint", "project-management", "advanced"],
      featured: false,
    },
    // ── Cloud (Railway) ────────────────────────────────────────────────────────
    {
      name: "railway",
      description: "Railway MCP — deploy, manage, and inspect Railway.app projects, services, variables, and logs via AI",
      category: "cloud",
      platform: ["cross-platform"],
      repository: "https://github.com/railwayapp/mcp-server",
      author: "railwayapp",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "api-key", description: "Railway API token (RAILWAY_API_TOKEN)" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@railway/mcp-server"],
        environment: { RAILWAY_API_TOKEN: "" },
        enabled: false,
      },
      setupInstructions: `Go to railway.app → Account Settings → Tokens.\nCreate a new token and set RAILWAY_API_TOKEN in your environment.\nThen start the server — it connects to your Railway account and projects.`,
      tags: ["railway", "deploy", "cloud", "hosting", "services", "logs", "devops"],
      featured: true,
    },
    // ── Development (Reference / Testing) ────────────────────────────────────
    {
      name: "mcp-everything",
      description: "Official MCP reference server — exercises every MCP protocol feature: tools, resources, prompts, sampling, logging",
      category: "development",
      platform: ["cross-platform"],
      repository: "https://github.com/modelcontextprotocol/servers",
      author: "modelcontextprotocol",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-everything"],
        enabled: false,
      },
      setupInstructions: `No setup required — runs immediately via npx.\nUseful for testing MCP client implementations against the full protocol surface.`,
      tags: ["mcp", "reference", "testing", "protocol", "tools", "resources", "prompts", "sampling"],
      featured: false,
    },
    // ── Search (SearXNG) ──────────────────────────────────────────────────────
    {
      name: "searxng",
      description: "SearXNG MCP — privacy-respecting metasearch engine integration; search the web without tracking",
      category: "search",
      platform: ["cross-platform"],
      repository: "https://github.com/ihor-sokoliuk/mcp-searxng",
      author: "ihor-sokoliuk",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "binary", description: "A running SearXNG instance (self-hosted or public)" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "mcp-searxng"],
        environment: { SEARXNG_URL: "https://searx.be" },
        enabled: false,
      },
      setupInstructions: `Set SEARXNG_URL to your SearXNG instance (e.g. https://searx.be or self-hosted).\nNo API key needed — SearXNG is open-source and free to use.`,
      tags: ["search", "web", "privacy", "searxng", "metasearch", "no-tracking"],
      featured: false,
    },
    // ── Productivity (Notion) ─────────────────────────────────────────────────
    {
      name: "notion",
      description: "Notion MCP — read and write Notion pages, databases, blocks, and search across your workspace",
      category: "productivity",
      platform: ["cross-platform"],
      repository: "https://github.com/awkoy/notion-mcp-server",
      author: "awkoy",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "api-key", description: "Notion Integration Token (NOTION_TOKEN)" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "notion-mcp-server"],
        environment: { NOTION_TOKEN: "" },
        enabled: false,
      },
      setupInstructions: `1. Go to https://www.notion.so/profile/integrations\n2. Create a new integration and copy the token\n3. Share your Notion pages/databases with the integration\n4. Set NOTION_TOKEN in your environment`,
      tags: ["notion", "notes", "wiki", "database", "pages", "productivity", "knowledge"],
      featured: true,
    },
    // ── Productivity (HubSpot) ────────────────────────────────────────────────
    {
      name: "hubspot",
      description: "HubSpot MCP — manage CRM contacts, companies, deals, tickets, and marketing data via AI",
      category: "productivity",
      platform: ["cross-platform"],
      repository: "https://github.com/HubSpot/mcp-server",
      author: "HubSpot",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "api-key", description: "HubSpot Private App Access Token (HUBSPOT_ACCESS_TOKEN)" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@hubspot/mcp-server"],
        environment: { HUBSPOT_ACCESS_TOKEN: "" },
        enabled: false,
      },
      setupInstructions: `1. In HubSpot, go to Settings → Integrations → Private Apps\n2. Create a Private App with the scopes you need (CRM, Marketing, etc.)\n3. Copy the access token and set HUBSPOT_ACCESS_TOKEN in your environment`,
      tags: ["hubspot", "crm", "contacts", "deals", "marketing", "sales", "business"],
      featured: false,
    },
    // ── Browser (Puppeteer) ───────────────────────────────────────────────────
    {
      name: "puppeteer",
      description: "Official MCP Puppeteer server — headless Chrome browser automation: navigate, screenshot, click, fill forms, extract content",
      category: "browser",
      platform: ["cross-platform"],
      repository: "https://github.com/modelcontextprotocol/servers",
      author: "modelcontextprotocol",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-puppeteer"],
        enabled: false,
      },
      setupInstructions: `No setup required — browser binaries are bundled with puppeteer-core.\nRuns headless Chrome automatically. Set PUPPETEER_EXECUTABLE_PATH env var to use a custom Chrome path.`,
      tags: ["puppeteer", "browser", "chrome", "headless", "automation", "screenshot", "scraping"],
      featured: true,
    },
    // ── Database (Prisma) ────────────────────────────────────────────────────
    {
      name: "prisma",
      description: "Prisma MCP — AI-powered database management: run migrations, push schema changes, seed data, execute queries, and introspect databases",
      category: "database",
      platform: ["cross-platform"],
      repository: "https://github.com/prisma/mcp",
      author: "prisma",
      requirements: [
        { type: "nodejs", description: "Node.js with npx" },
        { type: "binary", description: "A database supported by Prisma (PostgreSQL, MySQL, SQLite, MongoDB, etc.)" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "prisma", "mcp"],
        enabled: false,
      },
      setupInstructions: `Run inside a project that has a prisma/schema.prisma file.\nFor cloud Prisma Postgres, use: npx -y mcp-remote https://mcp.prisma.io/mcp\nThe server exposes migration, schema push/pull, seeding, and query tools.`,
      tags: ["prisma", "database", "orm", "migrations", "schema", "sql", "postgres", "mysql", "sqlite", "mongodb"],
      featured: true,
    },
    // ── Design (Canva) ────────────────────────────────────────────────────────
    {
      name: "canva",
      description: "Official Canva CLI — scaffold, develop, and publish Canva apps and extensions from the terminal",
      category: "design",
      platform: ["cross-platform"],
      repository: "https://github.com/canva-sdks/canva-cli",
      author: "canva-sdks",
      requirements: [
        { type: "nodejs", description: "Node.js 18+ with npx" },
      ],
      config: {
        type: "local",
        command: ["npx", "-y", "@canva/cli@latest"],
        enabled: false,
      },
      setupInstructions: `Run 'npx @canva/cli@latest create' to scaffold a new Canva app.\nRequires a Canva Developer account at canva.com/developers.\nLogin with 'npx @canva/cli@latest login' to authenticate.`,
      tags: ["canva", "design", "graphics", "apps", "extensions", "cli", "developer"],
      featured: false,
    },
  ]

  export function getByName(name: string): RegistryEntry | undefined {
    return registry.find((entry) => entry.name === name)
  }

  export function getByCategory(category: Category): RegistryEntry[] {
    return registry.filter((entry) => entry.category === category)
  }

  export function getByPlatform(platform: Platform): RegistryEntry[] {
    return registry.filter((entry) =>
      entry.platform.includes(platform) || entry.platform.includes("cross-platform")
    )
  }

  export function getFeatured(): RegistryEntry[] {
    return registry.filter((entry) => entry.featured)
  }

  export function search(query: string): RegistryEntry[] {
    const lowerQuery = query.toLowerCase()
    return registry.filter(
      (entry) =>
        entry.name.toLowerCase().includes(lowerQuery) ||
        entry.description.toLowerCase().includes(lowerQuery) ||
        entry.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
    )
  }

  export function isCompatible(entry: RegistryEntry): boolean {
    const currentPlatform = process.platform
    const platformMap: Record<string, Platform> = {
      win32: "windows",
      darwin: "macos",
      linux: "linux",
    }
    const platform = platformMap[currentPlatform] || "linux"
    return entry.platform.includes(platform) || entry.platform.includes("cross-platform")
  }

  export function getInstallInstructions(entry: RegistryEntry): string {
    return entry.setupInstructions || "No setup instructions available."
  }

  export function formatConfig(entry: RegistryEntry): Config.Mcp {
    return {
      ...entry.config,
      enabled: false,
    }
  }
}
