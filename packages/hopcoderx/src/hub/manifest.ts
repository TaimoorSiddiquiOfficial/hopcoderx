import { z } from "zod"

export namespace HubManifest {
  export const Kind = z.enum(["mcp", "skill", "bundle", "preset"])
  export type Kind = z.infer<typeof Kind>

  export const Source = z.enum(["builtin", "marketplace", "local", "github", "registry", "project"])
  export type Source = z.infer<typeof Source>

  export const Platform = z.enum(["windows", "macos", "linux", "cross-platform"])
  export type Platform = z.infer<typeof Platform>

  export const PermissionScope = z.enum(["read", "write", "network", "shell", "fs", "secrets"])
  export type PermissionScope = z.infer<typeof PermissionScope>

  export const RequirementType = z.enum([
    "nodejs",
    "python",
    "powershell",
    "binary",
    "app",
    "api-key",
    "oauth",
    "env",
    "manual",
  ])
  export type RequirementType = z.infer<typeof RequirementType>

  export const Requirement = z.object({
    type: RequirementType,
    key: z.string().optional(),
    version: z.string().optional(),
    description: z.string(),
    installCommand: z.string().optional(),
    verifyCommand: z.string().optional(),
    optional: z.boolean().optional(),
  })
  export type Requirement = z.infer<typeof Requirement>

  export const AuthMode = z.enum(["none", "oauth", "api-key", "env", "manual"])
  export type AuthMode = z.infer<typeof AuthMode>

  export const Auth = z.object({
    mode: AuthMode,
    required: z.boolean().default(false),
    displayLabel: z.string().optional(),
    envKeys: z.array(z.string()).default([]),
    setupDocs: z.string().optional(),
    setupCommand: z.string().optional(),
  })
  export type Auth = z.infer<typeof Auth>

  export const SetupState = z.enum(["unconfigured", "partial", "configured", "disabled", "error"])
  export type SetupState = z.infer<typeof SetupState>

  export const Readiness = z.enum([
    "unknown",
    "ready",
    "disabled-missing-auth",
    "disabled-missing-config",
    "auth-required",
    "auth-expired",
    "configured-not-connected",
    "connected",
    "error",
  ])
  export type Readiness = z.infer<typeof Readiness>

  export const Activation = z.object({
    defaultEnabled: z.boolean().default(false),
    autoDisableWhenMissing: z.boolean().default(false),
    requiresSetup: z.boolean().default(false),
    setupState: SetupState.optional(),
    readiness: Readiness.optional(),
  })
  export type Activation = z.infer<typeof Activation>

  export const Relation = z.object({
    kind: Kind,
    id: z.string(),
    reason: z.string().optional(),
  })
  export type Relation = z.infer<typeof Relation>

  export const EmbeddedMcp = z.object({
    id: z.string(),
    name: z.string(),
    packageName: z.string().optional(),
    registryName: z.string().optional(),
    description: z.string().optional(),
    required: z.boolean().default(true),
    auth: Auth.optional(),
    activation: Activation.optional(),
    requirements: z.array(Requirement).default([]),
    tags: z.array(z.string()).default([]),
  })
  export type EmbeddedMcp = z.infer<typeof EmbeddedMcp>

  export const Base = z.object({
    id: z.string(),
    kind: Kind,
    name: z.string(),
    description: z.string(),
    version: z.string().optional(),
    source: Source.default("builtin"),
    category: z.string().optional(),
    tags: z.array(z.string()).default([]),
    author: z.string().optional(),
    homepage: z.string().optional(),
    repository: z.string().optional(),
    docs: z.string().optional(),
    platforms: z.array(Platform).default(["cross-platform"]),
    requirements: z.array(Requirement).default([]),
    auth: Auth.default({
      mode: "none",
      required: false,
      envKeys: [],
    }),
    activation: Activation.default({
      defaultEnabled: false,
      autoDisableWhenMissing: false,
      requiresSetup: false,
    }),
    dependsOnSkills: z.array(z.string()).default([]),
    dependsOnMcp: z.array(z.string()).default([]),
    related: z.array(Relation).default([]),
    embeddedMcp: z.array(EmbeddedMcp).default([]),
  })
  export type Base = z.infer<typeof Base>

  export const MCP = Base.extend({
    kind: z.literal("mcp"),
    registryName: z.string().optional(),
    configSchemaRef: z.string().optional(),
  })
  export type MCP = z.infer<typeof MCP>

  export const Skill = Base.extend({
    kind: z.literal("skill"),
    permissions: z.array(PermissionScope).default([]),
    npm: z.string().optional(),
    minHostVersion: z.string().optional(),
    presets: z.array(z.string()).default([]),
  })
  export type Skill = z.infer<typeof Skill>

  export const Bundle = Base.extend({
    kind: z.literal("bundle"),
    items: z.array(Relation).default([]),
  })
  export type Bundle = z.infer<typeof Bundle>

  export const Preset = Base.extend({
    kind: z.literal("preset"),
    appliesTo: z.array(Relation).default([]),
  })
  export type Preset = z.infer<typeof Preset>

  export const Any = z.discriminatedUnion("kind", [MCP, Skill, Bundle, Preset])
  export type Any = z.infer<typeof Any>

  export function normalizeID(kind: Kind, name: string) {
    return `${kind}:${name.trim().toLowerCase()}`
  }
}
