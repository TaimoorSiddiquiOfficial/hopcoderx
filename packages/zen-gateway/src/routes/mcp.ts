import { Hono } from 'hono'
import { createHash } from 'crypto'

// MCP JSON-RPC 2.0 gateway proxy
// Supported methods: initialize, tools/list, tools/call
// Auth: x-hopcoderx-key or Authorization: Bearer <key>

interface McpRpc {
  jsonrpc: '2.0'
  id?: number | string | null
  method: string
  params?: any
}

interface McpServer {
  id: number
  name: string
  url: string
  api_key_encrypted: string | null
  allowed_tools: string | null
  is_active: number
}

function rpcError(id: any, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}
function rpcResult(id: any, result: any) {
  return { jsonrpc: '2.0', id, result }
}

export function mcpRoutes() {
  const app = new Hono()

  app.post('/', async (c) => {
    // Auth
    let apiKey = c.req.header('x-hopcoderx-key')
    if (!apiKey) {
      const auth = c.req.header('Authorization')
      if (auth?.startsWith('Bearer ')) apiKey = auth.slice(7)
    }
    if (!apiKey) {
      return c.json(rpcError(null, -32600, 'Missing API key. Use x-hopcoderx-key or Authorization: Bearer'), 401)
    }
    const keyHash = createHash('sha256').update(apiKey).digest('hex')
    const keyRecord = await c.env.DB.prepare(
      `SELECT ak.id, u.suspended FROM api_keys ak JOIN users u ON ak.user_id = u.id WHERE ak.key_hash = ? AND ak.is_active = 1`
    ).bind(keyHash).first<{ id: number; suspended: number }>()
    if (!keyRecord) return c.json(rpcError(null, -32600, 'Invalid API key'), 401)
    if (keyRecord.suspended) return c.json(rpcError(null, -32600, 'Account suspended'), 403)

    // Parse request
    const rpc = await c.req.json<McpRpc>()
    const { id, method, params } = rpc

    // Load active MCP servers
    let servers: McpServer[] = []
    try {
      const { results } = await c.env.DB.prepare(
        'SELECT * FROM mcp_servers WHERE is_active = 1 ORDER BY id ASC'
      ).all()
      servers = (results || []) as McpServer[]
    } catch { /* table may not exist yet */ }

    if (method === 'initialize') {
      return c.json(rpcResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'HopCoderX MCP Gateway', version: '1.0.0' },
      }))
    }

    if (method === 'tools/list') {
      // Aggregate tool lists from all active MCP servers
      const toolsByServer = await Promise.all(servers.map(async (srv) => {
        try {
          const resp = await fetch(srv.url, {
            method: 'POST',
            headers: buildHeaders(srv),
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
            signal: AbortSignal.timeout(10000),
          })
          if (!resp.ok) return []
          const data: any = await resp.json()
          const rawTools: any[] = data.result?.tools || []
          // Prefix tool names with server id to avoid collisions
          return rawTools
            .filter(t => isToolAllowed(t.name, srv.allowed_tools))
            .map(t => ({ ...t, name: `${srv.name}__${t.name}`, _srv_id: srv.id }))
        } catch { return [] }
      }))
      return c.json(rpcResult(id, { tools: toolsByServer.flat() }))
    }

    if (method === 'tools/call') {
      const toolName: string = params?.name || ''
      // Find which server owns this tool (name is prefixed with server_name__)
      const parts = toolName.split('__')
      if (parts.length < 2) {
        return c.json(rpcError(id, -32602, `Tool name must be prefixed with server name: <serverName>__<toolName>`))
      }
      const srvName = parts[0]
      const actualTool = parts.slice(1).join('__')
      const srv = servers.find(s => s.name === srvName)
      if (!srv) return c.json(rpcError(id, -32601, `MCP server '${srvName}' not found or inactive`))
      if (!isToolAllowed(actualTool, srv.allowed_tools)) {
        return c.json(rpcError(id, -32601, `Tool '${actualTool}' is not allowed on server '${srvName}'`))
      }

      try {
        const resp = await fetch(srv.url, {
          method: 'POST',
          headers: buildHeaders(srv),
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'tools/call',
            params: { ...params, name: actualTool },
          }),
          signal: AbortSignal.timeout(30000),
        })
        const data: any = await resp.json()
        if (data.error) return c.json(rpcError(id, data.error.code || -32000, data.error.message))
        return c.json(rpcResult(id, data.result))
      } catch (e: any) {
        return c.json(rpcError(id, -32000, `MCP server error: ${e.message}`))
      }
    }

    // Notifications: acknowledge without forwarding
    if (method.startsWith('notifications/')) {
      return c.json({ jsonrpc: '2.0', id: null })
    }

    return c.json(rpcError(id, -32601, `Method '${method}' not supported`))
  })

  return app
}

function buildHeaders(srv: McpServer): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (srv.api_key_encrypted) h['Authorization'] = `Bearer ${srv.api_key_encrypted}`
  return h
}

function isToolAllowed(tool: string, allowedJson: string | null): boolean {
  if (!allowedJson) return true
  try {
    const allowed: string[] = JSON.parse(allowedJson)
    return !allowed.length || allowed.includes(tool)
  } catch { return true }
}
