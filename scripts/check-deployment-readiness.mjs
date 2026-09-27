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
  ['app_get_portfolio_state', { input_owner_user_id: null }],
  ['app_get_strategy_state', { input_owner_user_id: null }],
  ['app_get_sharing_profile', {}],
  ['list_friends', {}],
  ['app_list_portfolio_viewers', { input_limit: 1, input_offset: 0 }],
  ['app_get_daily_context', { input_subject_tickers: null, input_timezone: 'Asia/Seoul' }],
  ['app_search_activities', { input_owner_user_id: null, input_query: null, input_from: null, input_to: null,
    input_record_state: 'done', input_instrument_id: null,
    input_tag_ids: [], input_tag_match: 'any', input_limit: 1, input_cursor: null, input_timezone: 'Asia/Seoul' }],
  ['app_search_activities_ticker', { input_owner_user_id: null, input_query: null, input_from: null, input_to: null,
    input_record_state: 'done', input_instrument_ticker: null,
    input_tag_ids: [], input_tag_match: 'any', input_limit: 1, input_cursor: null, input_timezone: 'Asia/Seoul' }],
  ['app_list_general_task_page', { input_cursor: null, input_filter: 'active', input_limit: 1 }],
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
  'search_activities',
  'delete_activity',
  'list_transactions',
  'reconcile_holding',
  'list_principles',
  'save_principle',
  'list_general_tasks',
  'save_general_task',
  'get_activity_report_context',
  'record_manual_activity',
  'update_entity_note',
  'submit_product_feedback',
  'list_my_product_feedback',
  'get_my_product_feedback',
  'update_my_product_feedback',
  'delete_my_product_feedback',
  'get_principle_row',
  'correct_principle_row',
  'delete_principle_row',
  'delete_general_task',
  'save_asset_detail',
  'delete_holding',
  'save_allocation_targets',
  'sync_prices',
  'get_sharing_profile',
  'save_sharing_profile',
  'reset_sharing_profile',
  'set_profile_avatar',
  'list_friends',
  'connect_friend',
  'remove_friend',
  'list_portfolio_viewers',
  'get_shared_portfolio_state',
]) {
  if (!toolNames.has(requiredTool)) throw new Error(`OAuth MCP is missing required tool: ${requiredTool}`)
}

const searchInput = {
  query: '점검', from: null, to: null, record_state: 'all', instrument_ticker: null,
  tag_ids: [], tag_match: 'any', limit: 1, cursor: null, timezone: 'Asia/Seoul',
}
const searchResponse = await fetch(`${baseUrl}/functions/v1/activity-search`, {
  method: 'POST',
  headers: { ...commonHeaders, Authorization: `Bearer ${session.access_token}` },
  body: JSON.stringify(searchInput),
})
if (!searchResponse.ok) throw new Error(`Authenticated activity search failed (${searchResponse.status})`)
const searchPage = await searchResponse.json()
if (!Array.isArray(searchPage.items) || !['active', 'indexing'].includes(searchPage.semantic_status)) {
  throw new Error(`Activity search embedding is unavailable (${searchPage.semantic_status ?? 'unknown'})`)
}
if (searchPage.search_mode !== 'hybrid' || searchPage.embedding_model !== 'gte-small' ||
    searchPage.semantic_threshold !== 0.96 || !['complete', 'partial', 'unknown'].includes(searchPage.index_status) ||
    searchPage.fallback_reason !== null || searchPage.items.some((item) => !Array.isArray(item.matched_by))) {
  throw new Error('Activity search evidence contract is unavailable')
}
const mcpSearch = await mcp('tools/call', { name: 'search_activities', arguments: searchInput })
const mcpSearchPage = mcpSearch?.structuredContent?.data
if (mcpSearch?.isError || !Array.isArray(mcpSearchPage?.items) ||
    !['active', 'indexing'].includes(mcpSearchPage?.semantic_status)) {
  throw new Error('OAuth MCP activity search is unavailable')
}
if (mcpSearchPage.search_mode !== 'hybrid' || mcpSearchPage.semantic_threshold !== 0.96 ||
    !['complete', 'partial', 'unknown'].includes(mcpSearchPage.index_status) ||
    mcpSearchPage.fallback_reason !== null ||
    mcpSearchPage.items.some((item) => !Array.isArray(item.matched_by))) {
  throw new Error('OAuth MCP search evidence contract is unavailable')
}

console.log(`Authenticated readiness passed for ${rpcChecks.length} read RPCs, OAuth MCP discovery, and both activity search routes.`)
