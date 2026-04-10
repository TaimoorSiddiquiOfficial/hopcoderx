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
