export function buildServerAuthHeaders(password?: string) {
  if (!password) return undefined
  const auth = `Basic ${Buffer.from(`HopCoderX:${password}`).toString("base64")}`
  return { Authorization: auth }
}
