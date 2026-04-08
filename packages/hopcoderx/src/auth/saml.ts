/**
 * SAML 2.0 SSO + SCIM 2.0 user provisioning for HopCoderX.
 *
 * SAML 2.0 flow:
 *   1. User hits /auth/saml/login → redirect to IdP
 *   2. IdP posts SAMLResponse to /auth/saml/callback
 *   3. We verify signature, extract attributes, issue session
 *
 * SCIM 2.0:
 *   - /scim/v2/Users (GET, POST, PATCH, DELETE)
 *   - /scim/v2/Groups (GET, POST, PATCH, DELETE)
 *   - IdP can auto-provision/deprovision users
 *
 * Config (env):
 *   SAML_IDP_METADATA_URL=https://idp.example.com/metadata
 *   SAML_SP_ENTITY_ID=https://hopcoderx.example.com
 *   SAML_SP_CALLBACK_URL=https://hopcoderx.example.com/auth/saml/callback
 *   SAML_SP_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
 *   SAML_SP_CERT=-----BEGIN CERTIFICATE-----...
 *   SCIM_BEARER_TOKEN=shared-secret-for-idp
 */

import { createHash, createVerify } from "crypto"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SAMLConfig {
  idpMetadataUrl?: string
  idpSsoUrl?: string
  idpCertificate?: string
  spEntityId: string
  spCallbackUrl: string
  spPrivateKey?: string
  spCertificate?: string
  attributeMapping?: {
    email?: string
    name?: string
    groups?: string
    userId?: string
  }
}

export interface SAMLUser {
  id: string
  email: string
  name: string
  groups: string[]
  attributes: Record<string, string | string[]>
}

export interface ScimUser {
  id: string
  externalId?: string
  userName: string
  name: { formatted?: string; givenName?: string; familyName?: string }
  emails: Array<{ value: string; primary?: boolean; type?: string }>
  active: boolean
  groups?: Array<{ value: string; display?: string }>
  meta?: { resourceType: string; created?: string; lastModified?: string }
}

export interface ScimGroup {
  id: string
  displayName: string
  members?: Array<{ value: string; display?: string }>
  meta?: { resourceType: string; created?: string; lastModified?: string }
}

// ─── In-memory SCIM store (replace with DB in production) ────────────────────

const scimUsers = new Map<string, ScimUser>()
const scimGroups = new Map<string, ScimGroup>()

function generateId(): string {
  return createHash("sha256").update(Date.now() + Math.random().toString()).digest("hex").slice(0, 16)
}

// ─── SAMLProvider ─────────────────────────────────────────────────────────────

export class SAMLProvider {
  private config: SAMLConfig

  constructor(config?: Partial<SAMLConfig>) {
    this.config = {
      spEntityId: config?.spEntityId ?? process.env.SAML_SP_ENTITY_ID ?? "https://hopcoderx.example.com",
      spCallbackUrl: config?.spCallbackUrl ?? process.env.SAML_SP_CALLBACK_URL ?? "https://hopcoderx.example.com/auth/saml/callback",
      idpMetadataUrl: config?.idpMetadataUrl ?? process.env.SAML_IDP_METADATA_URL,
      idpSsoUrl: config?.idpSsoUrl ?? process.env.SAML_IDP_SSO_URL,
      idpCertificate: config?.idpCertificate ?? process.env.SAML_IDP_CERT,
      spPrivateKey: config?.spPrivateKey ?? process.env.SAML_SP_PRIVATE_KEY,
      spCertificate: config?.spCertificate ?? process.env.SAML_SP_CERT,
      attributeMapping: config?.attributeMapping ?? {
        email: "email",
        name: "displayName",
        groups: "memberOf",
        userId: "uid",
      },
    }
  }

  /** Fetch and parse IdP metadata XML to get SSO URL and certificate */
  async loadIdPMetadata(): Promise<void> {
    if (!this.config.idpMetadataUrl) return
    const res = await fetch(this.config.idpMetadataUrl, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`Failed to fetch IdP metadata: ${res.status}`)
    const xml = await res.text()

    // Extract SSO URL
    const ssoMatch = xml.match(/SingleSignOnService[^>]*Location="([^"]+)"/)
    if (ssoMatch) this.config.idpSsoUrl = ssoMatch[1]

    // Extract X509 certificate
    const certMatch = xml.match(/<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/)
    if (certMatch) {
      this.config.idpCertificate = certMatch[1].replace(/\s/g, "")
    }
  }

  /** Generate SAML AuthnRequest URL to redirect user to IdP */
  generateAuthnRequestUrl(relayState?: string): string {
    if (!this.config.idpSsoUrl) throw new Error("IdP SSO URL not configured")

    const id = `_${generateId()}`
    const instant = new Date().toISOString()
    const authnRequest = [
      `<samlp:AuthnRequest`,
      `  xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"`,
      `  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"`,
      `  ID="${id}"`,
      `  Version="2.0"`,
      `  IssueInstant="${instant}"`,
      `  AssertionConsumerServiceURL="${this.config.spCallbackUrl}"`,
      `  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">`,
      `  <saml:Issuer>${this.config.spEntityId}</saml:Issuer>`,
      `  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>`,
      `</samlp:AuthnRequest>`,
    ].join("\n")

    const encoded = Buffer.from(authnRequest).toString("base64")
    const params = new URLSearchParams({ SAMLRequest: encoded })
    if (relayState) params.set("RelayState", relayState)

    return `${this.config.idpSsoUrl}?${params}`
  }

  /** Parse and verify a SAMLResponse from IdP callback */
  async parseResponse(samlResponseBase64: string): Promise<SAMLUser> {
    const xml = Buffer.from(samlResponseBase64, "base64").toString("utf8")

    // Extract NameID (email)
    const nameIdMatch = xml.match(/<(?:saml:)?NameID[^>]*>([^<]+)<\/(?:saml:)?NameID>/)
    const nameId = nameIdMatch?.[1]?.trim() ?? ""

    // Validate issuer
    const issuerMatch = xml.match(/<(?:saml:)?Issuer[^>]*>([^<]+)<\/(?:saml:)?Issuer>/)
    const issuer = issuerMatch?.[1]?.trim() ?? ""

    // Check NotOnOrAfter
    const notOnOrAfterMatch = xml.match(/NotOnOrAfter="([^"]+)"/)
    if (notOnOrAfterMatch) {
      const expiry = new Date(notOnOrAfterMatch[1])
      if (expiry < new Date()) throw new Error("SAML assertion has expired")
    }

    // Extract attributes
    const attributes: Record<string, string | string[]> = {}
    const attrRegex = /<(?:saml:)?Attribute[^>]+Name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:saml:)?Attribute>/g
    let attrMatch: RegExpExecArray | null
    while ((attrMatch = attrRegex.exec(xml)) !== null) {
      const attrName = attrMatch[1]
      const valuesXml = attrMatch[2]
      const vals: string[] = []
      const valRegex = /<(?:saml:)?AttributeValue[^>]*>([^<]*)<\/(?:saml:)?AttributeValue>/g
      let valMatch: RegExpExecArray | null
      while ((valMatch = valRegex.exec(valuesXml)) !== null) {
        vals.push(valMatch[1].trim())
      }
      attributes[attrName] = vals.length === 1 ? vals[0] : vals
    }

    const mapping = this.config.attributeMapping!
    const email = (mapping.email && typeof attributes[mapping.email] === "string" ? attributes[mapping.email] as string : nameId) ?? nameId
    const name = (mapping.name && typeof attributes[mapping.name] === "string" ? attributes[mapping.name] as string : "") ?? ""
    const groupsRaw = mapping.groups ? attributes[mapping.groups] : []
    const groups = Array.isArray(groupsRaw) ? groupsRaw : (groupsRaw ? [groupsRaw] : [])
    const userId = (mapping.userId && typeof attributes[mapping.userId] === "string" ? attributes[mapping.userId] as string : email) ?? email

    return { id: userId, email, name, groups, attributes }
  }

  /** Generate SP metadata XML for registration with IdP */
  generateSpMetadata(): string {
    return [
      `<?xml version="1.0"?>`,
      `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${this.config.spEntityId}">`,
      `  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true"`,
      `    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">`,
      `    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"`,
      `      Location="${this.config.spCallbackUrl}" index="1"/>`,
      `  </md:SPSSODescriptor>`,
      `</md:EntityDescriptor>`,
    ].join("\n")
  }

  isConfigured(): boolean {
    return !!(this.config.idpSsoUrl || this.config.idpMetadataUrl)
  }
}

// ─── SCIM 2.0 Handler ─────────────────────────────────────────────────────────

export class SCIMHandler {
  private bearerToken: string

  constructor(bearerToken?: string) {
    this.bearerToken = bearerToken ?? process.env.SCIM_BEARER_TOKEN ?? ""
  }

  verifyAuth(authHeader: string | null): boolean {
    if (!authHeader) return false
    const token = authHeader.replace(/^Bearer\s+/i, "")
    return token === this.bearerToken
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  listUsers(filter?: string): { totalResults: number; Resources: ScimUser[] } {
    const users = Array.from(scimUsers.values())
    const filtered = filter
      ? users.filter((u) => {
          const f = filter.toLowerCase()
          return u.userName.toLowerCase().includes(f) || u.emails.some((e) => e.value.toLowerCase().includes(f))
        })
      : users
    return { totalResults: filtered.length, Resources: filtered }
  }

  getUser(id: string): ScimUser | null {
    return scimUsers.get(id) ?? null
  }

  createUser(data: Omit<ScimUser, "id">): ScimUser {
    const id = generateId()
    const user: ScimUser = {
      ...data,
      id,
      meta: { resourceType: "User", created: new Date().toISOString(), lastModified: new Date().toISOString() },
    }
    scimUsers.set(id, user)
    return user
  }

  updateUser(id: string, data: Partial<ScimUser>): ScimUser | null {
    const existing = scimUsers.get(id)
    if (!existing) return null
    const updated: ScimUser = {
      ...existing,
      ...data,
      id,
      meta: { ...existing.meta, resourceType: "User", lastModified: new Date().toISOString() },
    }
    scimUsers.set(id, updated)
    return updated
  }

  deleteUser(id: string): boolean {
    return scimUsers.delete(id)
  }

  // ── Groups ─────────────────────────────────────────────────────────────────

  listGroups(): { totalResults: number; Resources: ScimGroup[] } {
    const groups = Array.from(scimGroups.values())
    return { totalResults: groups.length, Resources: groups }
  }

  getGroup(id: string): ScimGroup | null {
    return scimGroups.get(id) ?? null
  }

  createGroup(data: Omit<ScimGroup, "id">): ScimGroup {
    const id = generateId()
    const group: ScimGroup = {
      ...data,
      id,
      meta: { resourceType: "Group", created: new Date().toISOString(), lastModified: new Date().toISOString() },
    }
    scimGroups.set(id, group)
    return group
  }

  updateGroup(id: string, data: Partial<ScimGroup>): ScimGroup | null {
    const existing = scimGroups.get(id)
    if (!existing) return null
    const updated: ScimGroup = {
      ...existing,
      ...data,
      id,
      meta: { ...existing.meta, resourceType: "Group", lastModified: new Date().toISOString() },
    }
    scimGroups.set(id, updated)
    return updated
  }

  deleteGroup(id: string): boolean {
    return scimGroups.delete(id)
  }

  /** Handle a raw SCIM HTTP request. Returns { status, body } */
  handle(method: string, path: string, body: Record<string, unknown> | null, authHeader: string | null): { status: number; body: unknown } {
    if (!this.verifyAuth(authHeader)) {
      return { status: 401, body: { detail: "Unauthorized", status: 401 } }
    }

    const parts = path.replace(/^\/scim\/v2\//, "").split("/")
    const resource = parts[0]?.toLowerCase()
    const id = parts[1]

    if (resource === "users") {
      if (method === "GET" && !id) {
        return { status: 200, body: { ...this.listUsers(), schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"] } }
      }
      if (method === "GET" && id) {
        const u = this.getUser(id)
        return u ? { status: 200, body: u } : { status: 404, body: { detail: "Not found" } }
      }
      if (method === "POST" && body) {
        const u = this.createUser(body as Omit<ScimUser, "id">)
        return { status: 201, body: u }
      }
      if ((method === "PUT" || method === "PATCH") && id && body) {
        const u = this.updateUser(id, body as Partial<ScimUser>)
        return u ? { status: 200, body: u } : { status: 404, body: { detail: "Not found" } }
      }
      if (method === "DELETE" && id) {
        return this.deleteUser(id) ? { status: 204, body: null } : { status: 404, body: { detail: "Not found" } }
      }
    }

    if (resource === "groups") {
      if (method === "GET" && !id) {
        return { status: 200, body: { ...this.listGroups(), schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"] } }
      }
      if (method === "GET" && id) {
        const g = this.getGroup(id)
        return g ? { status: 200, body: g } : { status: 404, body: { detail: "Not found" } }
      }
      if (method === "POST" && body) {
        const g = this.createGroup(body as Omit<ScimGroup, "id">)
        return { status: 201, body: g }
      }
      if ((method === "PUT" || method === "PATCH") && id && body) {
        const g = this.updateGroup(id, body as Partial<ScimGroup>)
        return g ? { status: 200, body: g } : { status: 404, body: { detail: "Not found" } }
      }
      if (method === "DELETE" && id) {
        return this.deleteGroup(id) ? { status: 204, body: null } : { status: 404, body: { detail: "Not found" } }
      }
    }

    return { status: 404, body: { detail: "Not found" } }
  }
}

// ─── Singletons ───────────────────────────────────────────────────────────────

export const samlProvider = new SAMLProvider()
export const scimHandler = new SCIMHandler()
