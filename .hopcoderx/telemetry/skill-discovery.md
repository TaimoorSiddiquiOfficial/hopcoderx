# Skill Discovery & Snippets

## Overview

HopCoderX now includes enhanced skill discovery and snippet expansion capabilities for dynamic, context-aware AI assistance.

## Features

### 1. Skill Discovery

Automatically discover relevant skills based on:
- **Project Analysis**: Detect frameworks (React, Next.js, Express, etc.), tools (Docker, Terraform, Kubernetes), and languages
- **Local Skills**: Scan `.hopcoderx/skills/` directory for project-specific skills
- **GitHub Integration**: Search awesome lists and skill repositories
- **Marketplace Recommendations**: Get npm package suggestions based on detected context

### 2. Snippet Expansion

Text expansion for common coding patterns:
- **Built-in Snippets**: 25+ pre-configured snippets for React, Next.js, Express, TypeScript, Python
- **Custom Snippets**: User-defined snippets saved to config
- **Variable Substitution**: Template variables with defaults
- **Language Scoping**: Snippets filtered by language context

## SkillDiscovery API

### `scanProject(root)`

Scan a project directory and discover relevant skills.

```typescript
const skills = await SkillDiscovery.scanProject("/path/to/project")

for (const skill of skills) {
  console.log(`${skill.name}: ${skill.confidence * 100}% match`)
  for (const rec of skill.recommendations) {
    console.log(`  - ${rec.package}: ${rec.reason}`)
  }
}
```

### `analyzeProject(root)`

Analyze project structure to detect frameworks, tools, and languages.

```typescript
const context = await SkillDiscovery.analyzeProject("/path/to/project")

console.log("Frameworks:", context.frameworks)  // ["react", "nextjs"]
console.log("Tools:", context.tools)            // ["docker", "github"]
console.log("Languages:", context.languages)    // ["typescript"]
console.log("Dependencies:", context.dependencies)
```

### `getRecommendations(root)`

Get skill recommendations for a project.

```typescript
const { discovered, allRecommendations } = await SkillDiscovery.getRecommendations(root)

// allRecommendations is deduplicated and sorted by priority
for (const rec of allRecommendations) {
  console.log(`${rec.package}: ${rec.priority} - ${rec.reason}`)
}
```

### `autoApply(discovered)`

Auto-install high-priority skills based on project analysis.

```typescript
const discovered = await SkillDiscovery.scanProject(root)
const installed = await SkillDiscovery.autoApply(discovered)

console.log("Auto-installed:", installed)
```

### `searchGitHub(query)`

Search GitHub for awesome lists and skill repositories.

```typescript
const repos = await SkillDiscovery.searchGitHub("react tools")
for (const repo of repos) {
  console.log(`${repo.name}: ${repo.description}`)
}
```

## SnippetExpansion API

### `expand(identifier, variables?, language?)`

Expand a snippet template with provided variables.

```typescript
// Expand React functional component
const result = SnippetExpansion.expand("rfc", {
  name: "MyComponent",
  props: "{ title, children }",
})

console.log(result.text)
// export function MyComponent({ title, children }): JSX.Element {
//   return (
//     <div>
//       {1}
//     </div>
//   )
// }

console.log(result.pendingVariables)  // Variables needing user input
console.log(result.cursorPosition)    // Where cursor should be placed
```

### `find(identifier, language?)`

Find a snippet by ID or prefix.

```typescript
const snippet = SnippetExpansion.find("rfc")
console.log(snippet.description)  // "React Functional Component"
console.log(snippet.scope)        // ["typescript", "typescriptreact", ...]
```

### `suggest(query, language?)`

Get snippet suggestions based on a search query.

```typescript
const suggestions = SnippetExpansion.suggest("react", "typescript")
// Returns snippets matching "react" in TypeScript context
```

### `all(language?)`

Get all available snippets.

```typescript
const allSnippets = SnippetExpansion.all()
const tsSnippets = SnippetExpansion.all("typescript")
```

### `saveCustom(snippet)`

Save a custom snippet to user configuration.

```typescript
await SnippetExpansion.saveCustom({
  id: "my-custom-hook",
  prefix: "mhook",
  description: "Custom hook template",
  body: [
    "export function use${name}(${params}) {",
    "  const [state, setState] = useState<${type}>(${initial})",
    "  ${1}",
    "  return { state, setState }",
    "}",
  ],
  variables: [
    { name: "name", description: "Hook name" },
    { name: "params", default: "", description: "Parameters" },
    { name: "type", default: "unknown", description: "State type" },
    { name: "initial", default: "null", description: "Initial value" },
  ],
  scope: ["typescript", "typescriptreact"],
  tags: ["react", "hook", "custom"],
})
```

### `deleteCustom(id)`

Delete a custom snippet.

```typescript
const deleted = await SnippetExpansion.deleteCustom("my-custom-hook")
```

## Built-in Snippets

### React
| Prefix | Description |
|--------|-------------|
| `rfc` | React Functional Component |
| `rhook` | Custom React Hook |
| `rue` | React useEffect Hook |
| `rus` | React useState Hook |
| `npage` | Next.js Page Component |
| `napi` | Next.js API Route |

### Express
| Prefix | Description |
|--------|-------------|
| `exroute` | Express Route Handler |
| `exmw` | Express Middleware |

### TypeScript
| Prefix | Description |
|--------|-------------|
| `tsif` | TypeScript Interface |
| `tstype` | TypeScript Type Alias |
| `tsenum` | TypeScript Enum |

### General
| Prefix | Description |
|--------|-------------|
| `func` | Function Declaration |
| `async` | Async Function |
| `class` | Class Declaration |
| `try` | Try-Catch Block |
| `log` | Console Log |

### Python
| Prefix | Description |
|--------|-------------|
| `pfunc` | Python Function |
| `pclass` | Python Class |

## REST API Endpoints

### List Skills
```http
GET /api/skills/
```

### Search Marketplace
```http
GET /api/skills/marketplace/search?q=react
```

### Get Package Info
```http
GET /api/skills/marketplace/:packageName
```

### Install Skill
```http
POST /api/skills/marketplace/install
Content-Type: application/json

{
  "packageName": "hopcoderx-skill-react",
  "version": "1.0.0"
}
```

### Uninstall Skill
```http
POST /api/skills/marketplace/uninstall
Content-Type: application/json

{
  "packageName": "hopcoderx-skill-react"
}
```

### List Installed Skills
```http
GET /api/skills/marketplace/installed
```

### Discover Skills
```http
GET /api/skills/discover
```

### Auto-Install Skills
```http
POST /api/skills/discover/auto-install
```

### List Snippets
```http
GET /api/skills/snippets?language=typescript
```

### Suggest Snippets
```http
GET /api/skills/snippets/suggest?q=react&language=typescript
```

### Expand Snippet
```http
POST /api/skills/snippets/expand
Content-Type: application/json

{
  "identifier": "rfc",
  "variables": {
    "name": "MyComponent",
    "props": "{ title }"
  },
  "language": "typescript"
}
```

### Save Custom Snippet
```http
POST /api/skills/snippets/custom
Content-Type: application/json

{
  "id": "my-snippet",
  "prefix": "myx",
  "description": "My custom snippet",
  "body": ["console.log('${1}')"],
  "scope": ["typescript"],
  "tags": ["custom"]
}
```

### Delete Custom Snippet
```http
DELETE /api/skills/snippets/custom/:id
```

### Execute Skill Tool
```http
POST /api/skills/execute
Content-Type: application/json

{
  "skillId": "github",
  "toolName": "github-list-prs",
  "args": {
    "repo": "owner/repo"
  }
}
```

## Events

### `skills.discovered`

Fired when new skills are discovered for a project.

```typescript
Bus.event.listen((event) => {
  if (event.type === "skills.discovered") {
    console.log(`Found ${event.properties.count} relevant skills`)
  }
})
```

### `skills.installed`

Fired when a skill is installed.

```typescript
Bus.event.listen((event) => {
  if (event.type === "skills.installed") {
    console.log(`Installed ${event.properties.package}`)
  }
})
```

## Integration Points

1. **Session Init**: Auto-discover skills when session starts
2. **TUI Sidebar**: Show recommended skills based on project
3. **Editor Integration**: Trigger snippet expansion via command palette
4. **CLI Commands**: `hopcoderx skills discover`, `hopcoderx snippets expand`

## Example: Project Analysis

```typescript
import { SkillDiscovery } from "@/skills/discovery"

async function analyzeMyProject() {
  const context = await SkillDiscovery.analyzeProject(process.cwd())
  
  console.log("Detected Frameworks:", context.frameworks)
  // Output: ["react", "nextjs", "tailwind"]
  
  console.log("Detected Tools:", context.tools)
  // Output: ["docker", "github", "vercel"]
  
  console.log("Detected Languages:", context.languages)
  // Output: ["typescript"]
  
  // Get recommendations
  const { allRecommendations } = await SkillDiscovery.getRecommendations(process.cwd())
  
  console.log("Recommended Skills:")
  for (const rec of allRecommendations) {
    console.log(`  ${rec.package} (${rec.priority}): ${rec.reason}`)
  }
}
```

## Example: Snippet Workflow

```typescript
import { SnippetExpansion } from "@/skills/snippets"

// Find a snippet
const snippet = SnippetExpansion.find("rfc")
console.log(snippet.description)  // "React Functional Component"

// Expand with variables
const result = SnippetExpansion.expand("rfc", {
  name: "UserProfile",
  props: "{ user, loading }",
}, "typescript")

console.log(result.text)
// export function UserProfile({ user, loading }): JSX.Element {
//   return (
//     <div>
//       {1}
//     </div>
//   )
// }

// Save a custom snippet
await SnippetExpansion.saveCustom({
  id: "react-memo",
  prefix: "rmemo",
  description: "React.memo Component",
  body: [
    "export const ${name} = memo(function ${name}(${props}) {",
    "  return (",
    "    <div>${1}</div>",
    "  )",
    "})",
  ],
  scope: ["typescript", "typescriptreact"],
  tags: ["react", "memo", "optimization"],
})
```

## Best Practices

1. **Discover on session start**: Run `scanProject()` when a new session begins to load relevant skills automatically.

2. **Review before auto-install**: Show recommendations to users before auto-installing, especially for medium/low priority skills.

3. **Scope snippets appropriately**: Use language-specific scopes to avoid suggesting Python snippets in TypeScript files.

4. **Share custom snippets**: Store team snippets in `.hopcoderx/skills/custom.json` for consistent team patterns.

5. **Pin skill versions**: Use `Skills.saveVersionPin()` to ensure consistent skill versions across team members.

6. **Check availability**: Always check `skill.isAvailable()` before executing to handle missing credentials gracefully.

## File Structure

```
src/skills/
  skills.ts        - Built-in skill definitions (GitHub, Docker, Sentry, Vercel)
  framework.ts     - Skill framework with manifests and permissions
  marketplace.ts   - npm marketplace integration
  discovery.ts     - Project analysis and skill discovery
  snippets.ts      - Snippet expansion system
```
