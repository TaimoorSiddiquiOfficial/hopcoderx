import crypto from "crypto"

export function generateSecret(length = 43): string {
  const bytes = crypto.randomBytes(length)
  return base64UrlEncode(bytes)
}

export function generateCodeChallengeFromVerifier(verifier: string): string {
  const hash = crypto.createHash("sha256").update(verifier).digest()
  return base64UrlEncode(hash)
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}
