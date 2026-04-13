import { test, expect, describe, afterEach } from "bun:test"
import { Auth } from "../../src/auth"
import { tmpdir } from "../fixture/fixture"
import { Global } from "../../src/global"
import path from "path"
import fs from "fs/promises"

const testDataDir = process.env.HOPCODERX_TEST_DATA_DIR || path.join(Global.Path.data, "test")

afterEach(async () => {
  await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {})
  // Clean up auth credentials after each test
  const allAuth = await Auth.all()
  for (const provider of Object.keys(allAuth)) {
    await Auth.remove(provider).catch(() => {})
  }
})

describe("auth refresh", () => {
  test("handles missing credentials gracefully", async () => {
    await using tmp = await tmpdir()

    // Try to refresh non-existent credentials
    const allAuth = await Auth.all()
    expect(allAuth["test-provider"]).toBeUndefined()
  })

  test("identifies OAuth credentials", async () => {
    await using tmp = await tmpdir()

    // Set OAuth credentials
    await Auth.set("oauth-provider", {
      type: "oauth",
      refresh: "refresh-token-123",
      access: "access-token-456",
      expires: Date.now() + 3600000, // 1 hour from now
    })

    const credentials = await Auth.all()
    expect(credentials["oauth-provider"]).toBeDefined()
    expect(credentials["oauth-provider"].type).toBe("oauth")
  })

  test("identifies API key credentials", async () => {
    await using tmp = await tmpdir()

    // Set API key credentials
    await Auth.set("api-provider", {
      type: "api",
      key: "sk-test-key-123",
    })

    const credentials = await Auth.all()
    expect(credentials["api-provider"]).toBeDefined()
    expect(credentials["api-provider"].type).toBe("api")
  })

  test("detects expired OAuth credentials", async () => {
    await using tmp = await tmpdir()

    // Set expired OAuth credentials
    await Auth.set("expired-provider", {
      type: "oauth",
      refresh: "refresh-token-123",
      access: "access-token-456",
      expires: Date.now() - 3600000, // 1 hour ago
    })

    const credentials = await Auth.all()
    expect(credentials["expired-provider"]).toBeDefined()
    expect(credentials["expired-provider"].type).toBe("oauth")
    expect(credentials["expired-provider"].expires).toBeLessThan(Date.now())
  })
})

describe("auth verify", () => {
  test("verifies API key credentials exist", async () => {
    await using tmp = await tmpdir()

    await Auth.set("test-api-provider", {
      type: "api",
      key: "sk-test-key",
    })

    const credentials = await Auth.all()
    expect(credentials["test-api-provider"]).toBeDefined()
    expect(credentials["test-api-provider"].type).toBe("api")
    expect(credentials["test-api-provider"].key).toBe("sk-test-key")
  })

  test("verifies OAuth credentials are not expired", async () => {
    await using tmp = await tmpdir()

    const futureExpiry = Date.now() + 3600000 // 1 hour from now
    await Auth.set("valid-oauth-provider", {
      type: "oauth",
      refresh: "refresh-token",
      access: "access-token",
      expires: futureExpiry,
    })

    const credentials = await Auth.all()
    expect(credentials["valid-oauth-provider"]).toBeDefined()
    expect(credentials["valid-oauth-provider"].expires).toBeGreaterThan(Date.now())
  })

  test("detects expired OAuth credentials", async () => {
    await using tmp = await tmpdir()

    const pastExpiry = Date.now() - 3600000 // 1 hour ago
    await Auth.set("expired-oauth-provider", {
      type: "oauth",
      refresh: "refresh-token",
      access: "access-token",
      expires: pastExpiry,
    })

    const credentials = await Auth.all()
    expect(credentials["expired-oauth-provider"]).toBeDefined()
    expect(credentials["expired-oauth-provider"].expires).toBeLessThan(Date.now())
  })

  test("handles missing credentials", async () => {
    await using tmp = await tmpdir()

    const credentials = await Auth.all()
    expect(credentials["non-existent-provider"]).toBeUndefined()
  })
})

describe("auth list", () => {
  test("lists all configured credentials", async () => {
    await using tmp = await tmpdir()

    // Set multiple credentials
    await Auth.set("provider-1", {
      type: "api",
      key: "key-1",
    })

    await Auth.set("provider-2", {
      type: "oauth",
      refresh: "refresh-2",
      access: "access-2",
      expires: Date.now() + 3600000,
    })

    const credentials = await Auth.all()
    expect(Object.keys(credentials)).toHaveLength(2)
    expect(credentials["provider-1"].type).toBe("api")
    expect(credentials["provider-2"].type).toBe("oauth")
  })

  test("returns empty object when no credentials configured", async () => {
    await using tmp = await tmpdir()

    const credentials = await Auth.all()
    expect(Object.keys(credentials)).toHaveLength(0)
  })
})

describe("auth logout", () => {
  test("removes a configured credential", async () => {
    await using tmp = await tmpdir()

    await Auth.set("to-remove", {
      type: "api",
      key: "test-key",
    })

    // Verify it exists
    const before = await Auth.all()
    expect(before["to-remove"]).toBeDefined()

    // Remove it
    await Auth.remove("to-remove")

    // Verify it's gone
    const after = await Auth.all()
    expect(after["to-remove"]).toBeUndefined()
  })

  test("handles removing non-existent credential", async () => {
    await using tmp = await tmpdir()

    // Should not throw - just resolves without error
    await Auth.remove("non-existent")
  })
})

describe("auth login", () => {
  test("sets API key credentials", async () => {
    await using tmp = await tmpdir()

    await Auth.set("new-provider", {
      type: "api",
      key: "sk-new-key",
    })

    const credentials = await Auth.all()
    expect(credentials["new-provider"]).toBeDefined()
    expect(credentials["new-provider"].type).toBe("api")
    expect(credentials["new-provider"].key).toBe("sk-new-key")
  })

  test("sets OAuth credentials", async () => {
    await using tmp = await tmpdir()

    await Auth.set("new-oauth-provider", {
      type: "oauth",
      refresh: "new-refresh-token",
      access: "new-access-token",
      expires: Date.now() + 7200000, // 2 hours
    })

    const credentials = await Auth.all()
    expect(credentials["new-oauth-provider"]).toBeDefined()
    expect(credentials["new-oauth-provider"].type).toBe("oauth")
    expect(credentials["new-oauth-provider"].refresh).toBe("new-refresh-token")
  })

  test("updates existing credentials", async () => {
    await using tmp = await tmpdir()

    // Set initial credentials
    await Auth.set("update-provider", {
      type: "api",
      key: "old-key",
    })

    // Update credentials
    await Auth.set("update-provider", {
      type: "api",
      key: "new-key",
    })

    const credentials = await Auth.all()
    expect(credentials["update-provider"].key).toBe("new-key")
  })
})
