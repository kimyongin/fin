const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
const missing = required.filter((name) => !process.env[name])
if (missing.length) throw new Error(`Missing local MCP contract environment: ${missing.join(', ')}`)

const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, '')
const hostname = new URL(baseUrl).hostname
if (!['127.0.0.1', 'localhost'].includes(hostname)) throw new Error('MCP contract test only runs against local Supabase')

const anonKey = process.env.SUPABASE_ANON_KEY
const functionUrl = `${baseUrl}/functions/v1/portfolio-mcp-oauth`
const commonHeaders = { apikey: anonKey, 'Content-Type': 'application/json' }
let userId = null

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function call(accessToken, method, params = {}) {
  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: { ...commonHeaders, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
  })
  return { response, body: await response.json().catch(() => null) }
}

try {
  const denied = await call('', 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'contract-test', version: '1' } })
  assert(denied.response.status === 401, `Unauthenticated MCP request returned ${denied.response.status}`)

  const signup = await fetch(`${baseUrl}/auth/v1/signup`, { method: 'POST', headers: commonHeaders, body: '{}' })
  assert(signup.ok, `Local anonymous signup failed (${signup.status})`)
  const session = await signup.json()
  assert(session.access_token && session.user?.id, 'Local anonymous signup returned no session')
  userId = session.user.id

  const initialized = await call(session.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'contract-test', version: '1' } })
  assert(initialized.response.ok && initialized.body?.result?.protocolVersion === '2025-06-18', 'MCP initialize contract failed')

  const listed = await call(session.access_token, 'tools/list')
  assert(listed.response.ok && listed.body?.result?.tools?.some((tool) => tool.name === 'get_profile'), 'MCP tools/list contract failed')

  const profile = await call(session.access_token, 'tools/call', { name: 'get_profile', arguments: {} })
  assert(profile.response.ok && profile.body?.result?.isError === false, 'Authenticated MCP tools/call failed')

  const invalid = await call(session.access_token, 'tools/call', { name: 'log_completed_trade', arguments: {} })
  const toolError = invalid.body?.result?.structuredContent?.error
  assert(invalid.response.ok && invalid.body?.result?.isError === true, 'Invalid tool input did not return an MCP tool error')
  assert(toolError?.code === 'validation_error' && toolError?.retryable === false, 'Invalid tool input returned the wrong recovery contract')
  assert(typeof toolError?.request_id === 'string' && toolError.request_id.length > 20, 'Tool error did not include a request ID')

  console.log('MCP initialize, tools/list, authenticated tools/call, auth denial, and validation error contracts passed.')
} finally {
  if (userId) {
    await fetch(`${baseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    })
  }
}
