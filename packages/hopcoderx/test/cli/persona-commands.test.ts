import { test, expect, describe, afterEach } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Global } from "../../src/global"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "../../src/util/filesystem"

const personasPath = path.join(Global.Path.config, "personas.json")

afterEach(async () => {
  await fs.rm(personasPath, { force: true }).catch(() => {})
})

async function writePersonas(personas: Record<string, any>) {
  await fs.mkdir(Global.Path.config, { recursive: true })
  await Filesystem.write(personasPath, JSON.stringify(personas, null, 2))
}

async function readPersonas(): Promise<Record<string, any>> {
  if (!(await Filesystem.exists(personasPath))) {
    return {}
  }
  const content = await Filesystem.readText(personasPath)
  return JSON.parse(content)
}

describe("persona edit", () => {
  test("updates persona name", async () => {
    await writePersonas({
      frontend: {
        id: "frontend",
        name: "Frontend Specialist",
        description: "React expert",
        systemPrompt: "You are a frontend specialist.",
      },
    })

    const personas = await readPersonas()
    personas.frontend.name = "Frontend Expert"
    await writePersonas(personas)

    const updated = await readPersonas()
    expect(updated.frontend.name).toBe("Frontend Expert")
  })

  test("updates persona description", async () => {
    await writePersonas({
      security: {
        id: "security",
        name: "Security Auditor",
        description: "Old description",
        systemPrompt: "You are a security specialist.",
      },
    })

    const personas = await readPersonas()
    personas.security.description = "New description"
    await writePersonas(personas)

    const updated = await readPersonas()
    expect(updated.security.description).toBe("New description")
  })

  test("updates persona system prompt", async () => {
    await writePersonas({
      refactor: {
        id: "refactor",
        name: "Refactoring Expert",
        description: "Clean code specialist",
        systemPrompt: "Old prompt",
      },
    })

    const personas = await readPersonas()
    personas.refactor.systemPrompt = "New system prompt"
    await writePersonas(personas)

    const updated = await readPersonas()
    expect(updated.refactor.systemPrompt).toBe("New system prompt")
  })

  test("updates persona model preference", async () => {
    await writePersonas({
      docs: {
        id: "docs",
        name: "Documentation Writer",
        description: "Technical writer",
        systemPrompt: "You write docs.",
      },
    })

    const personas = await readPersonas()
    personas.docs.model = "anthropic/claude-sonnet-4-5-20250929"
    await writePersonas(personas)

    const updated = await readPersonas()
    expect(updated.docs.model).toBe("anthropic/claude-sonnet-4-5-20250929")
  })

  test("updates persona temperature", async () => {
    await writePersonas({
      creative: {
        id: "creative",
        name: "Creative Writer",
        description: "Creative content",
        systemPrompt: "You write creatively.",
        temperature: 0.5,
      },
    })

    const personas = await readPersonas()
    personas.creative.temperature = 0.9
    await writePersonas(personas)

    const updated = await readPersonas()
    expect(updated.creative.temperature).toBe(0.9)
  })

  test("updates multiple fields at once", async () => {
    await writePersonas({
      db: {
        id: "db",
        name: "Database Architect",
        description: "SQL expert",
        systemPrompt: "You design schemas.",
        model: "old/model",
        temperature: 0.3,
      },
    })

    const personas = await readPersonas()
    personas.db = {
      ...personas.db,
      name: "Database Expert",
      description: "SQL and NoSQL expert",
      model: "new/model",
      temperature: 0.5,
    }
    await writePersonas(personas)

    const updated = await readPersonas()
    expect(updated.db.name).toBe("Database Expert")
    expect(updated.db.description).toBe("SQL and NoSQL expert")
    expect(updated.db.model).toBe("new/model")
    expect(updated.db.temperature).toBe(0.5)
  })

  test("handles non-existent persona", async () => {
    await writePersonas({})

    const personas = await readPersonas()
    expect(personas["non-existent"]).toBeUndefined()
  })
})

describe("persona list", () => {
  test("lists all personas", async () => {
    await writePersonas({
      frontend: {
        id: "frontend",
        name: "Frontend Specialist",
        description: "React expert",
        systemPrompt: "Frontend prompt",
      },
      backend: {
        id: "backend",
        name: "Backend Specialist",
        description: "Node.js expert",
        systemPrompt: "Backend prompt",
      },
    })

    const personas = await readPersonas()
    expect(Object.keys(personas)).toHaveLength(2)
    expect(personas.frontend.name).toBe("Frontend Specialist")
    expect(personas.backend.name).toBe("Backend Specialist")
  })

  test("returns default personas when file doesn't exist", async () => {
    const exists = await Filesystem.exists(personasPath)
    expect(exists).toBe(false)
  })
})

describe("persona show", () => {
  test("shows a specific persona", async () => {
    await writePersonas({
      security: {
        id: "security",
        name: "Security Auditor",
        description: "Security expert",
        systemPrompt: "You are a security specialist.",
      },
    })

    const personas = await readPersonas()
    const security = personas.security

    expect(security).toBeDefined()
    expect(security.name).toBe("Security Auditor")
    expect(security.systemPrompt).toBe("You are a security specialist.")
  })

  test("returns undefined for non-existent persona", async () => {
    await writePersonas({})

    const personas = await readPersonas()
    expect(personas["non-existent"]).toBeUndefined()
  })
})

describe("persona add", () => {
  test("adds a new persona", async () => {
    await writePersonas({})

    const personas = await readPersonas()
    personas["custom"] = {
      id: "custom",
      name: "Custom Persona",
      description: "A custom persona",
      systemPrompt: "Custom prompt",
      model: "test/model",
      temperature: 0.7,
    }
    await writePersonas(personas)

    const updated = await readPersonas()
    expect(updated.custom).toBeDefined()
    expect(updated.custom.name).toBe("Custom Persona")
  })
})

describe("persona remove", () => {
  test("removes a persona", async () => {
    await writePersonas({
      toRemove: {
        id: "toRemove",
        name: "To Remove",
        description: "Will be removed",
        systemPrompt: "Remove me",
      },
      keep: {
        id: "keep",
        name: "Keep",
        description: "Will be kept",
        systemPrompt: "Keep me",
      },
    })

    const personas = await readPersonas()
    delete personas.toRemove
    await writePersonas(personas)

    const updated = await readPersonas()
    expect(updated.toRemove).toBeUndefined()
    expect(updated.keep).toBeDefined()
  })
})

describe("persona reset", () => {
  test("resets to default personas", async () => {
    const defaultPersonas = {
      frontend: {
        id: "frontend",
        name: "Frontend Specialist",
        description: "Expert in React, TypeScript, CSS, and UX",
        systemPrompt: "You are a frontend specialist.",
      },
      security: {
        id: "security",
        name: "Security Auditor",
        description: "Security-first code review",
        systemPrompt: "You are a security specialist.",
      },
      performance: {
        id: "performance",
        name: "Performance Engineer",
        description: "Optimization specialist",
        systemPrompt: "You are a performance engineer.",
      },
    }

    await writePersonas(defaultPersonas)

    const personas = await readPersonas()
    expect(personas.frontend).toBeDefined()
    expect(personas.security).toBeDefined()
    expect(personas.performance).toBeDefined()
  })
})
