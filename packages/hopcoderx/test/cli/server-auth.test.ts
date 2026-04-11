import { describe, expect, test } from "bun:test"
import { buildServerAuthHeaders } from "../../src/cli/server-auth"

describe("buildServerAuthHeaders", () => {
  test("returns undefined when password is absent", () => {
    expect(buildServerAuthHeaders()).toBeUndefined()
  })

  test("creates basic auth headers for remote server access", () => {
    expect(buildServerAuthHeaders("secret")).toEqual({
      Authorization: `Basic ${Buffer.from("HopCoderX:secret").toString("base64")}`,
    })
  })
})
