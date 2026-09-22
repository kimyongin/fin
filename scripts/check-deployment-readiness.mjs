const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SMOKE_EMAIL', 'SUPABASE_SMOKE_PASSWORD']
const missing = required.filter((name) => !process.env[name])
if (missing.length) throw new Error(`Missing deployment-readiness secrets: ${missing.join(', ')}`)

const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, '')
const commonHeaders = { apikey: process.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }
const authResponse = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: commonHeaders,
  body: JSON.stringify({ email: process.env.SUPABASE_SMOKE_EMAIL, password: process.env.SUPABASE_SMOKE_PASSWORD }),
})
if (!authResponse.ok) throw new Error(`Authenticated readiness login failed (${authResponse.status})`)
const session = await authResponse.json()
if (!session.access_token) throw new Error('Authenticated readiness login returned no access token')

const rpcChecks = [
  ['app_list_daily_briefing_page', { input_cursor: null, input_limit: 1, input_owner_user_id: null }],
  ['app_list_investment_decision_page', { input_cursor: null, input_filter: 'current', input_limit: 1, input_owner_user_id: null }],
  ['app_list_portfolio_task_page', { input_cursor: null, input_filter: 'active', input_limit: 1, input_owner_user_id: null }],
  ['app_list_transaction_page', { input_account_id: null, input_cursor: null, input_instrument_id: null, input_limit: 1 }],
  ['app_list_my_product_feedback', { input_cursor: null, input_limit: 1 }],
]

for (const [name, body] of rpcChecks) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { ...commonHeaders, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`${name} readiness check failed (${response.status}): ${detail.slice(0, 300)}`)
  }
}

const mcpUrl = `${baseUrl}/functions/v1/portfolio-mcp-oauth`
async function mcp(method, params = {}) {
  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers: { ...commonHeaders, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
  })
  if (!response.ok) throw new Error(`OAuth MCP ${method} readiness failed (${response.status})`)
  const body = await response.json()
  if (body.error) throw new Error(`OAuth MCP ${method} readiness failed (${body.error.code}): ${body.error.message}`)
  return body.result
}

const initialized = await mcp('initialize', {
  protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'deployment-readiness', version: '1' },
})
if (initialized?.protocolVersion !== '2025-06-18') throw new Error('OAuth MCP returned an incompatible protocol version')
const listed = await mcp('tools/list')
const toolNames = new Set((listed?.tools ?? []).map((tool) => tool.name))
for (const requiredTool of [
  'get_daily_context',
  'save_daily_briefing',
  'list_transactions',
  'verify_holdings',
  'list_operating_rules',
  'save_operating_rule',
  'archive_operating_rule',
  'update_entity_note',
  'submit_product_feedback',
  'list_my_product_feedback',
]) {
  if (!toolNames.has(requiredTool)) throw new Error(`OAuth MCP is missing required tool: ${requiredTool}`)
}

console.log(`Authenticated readiness passed for ${rpcChecks.length} RPCs and OAuth MCP discovery.`)
