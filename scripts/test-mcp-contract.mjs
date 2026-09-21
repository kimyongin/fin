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

async function adminWrite(path, method, body) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => null)
  assert(response.ok, `Local contract fixture write failed (${response.status}): ${JSON.stringify(data)}`)
  return data
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
  const guideDefinition = listed.body?.result?.tools?.find((tool) => tool.name === 'get_workflow_guide')
  assert(guideDefinition?.inputSchema?.properties?.topic?.enum?.length === 6, 'Workflow guide topics were not advertised')

  for (const topic of guideDefinition.inputSchema.properties.topic.enum) {
    const guideResult = await call(session.access_token, 'tools/call', { name: 'get_workflow_guide', arguments: { topic } })
    const guide = guideResult.body?.result?.structuredContent?.data
    assert(guideResult.body?.result?.isError === false && guide?.topic === topic && guide?.revision && guide?.steps?.length, `Workflow guide call failed for ${topic}`)
  }
  const unknownGuide = await call(session.access_token, 'tools/call', { name: 'get_workflow_guide', arguments: { topic: 'unknown' } })
  assert(unknownGuide.body?.result?.structuredContent?.error?.code === 'validation_error', 'Unknown workflow guide topic did not return validation_error')

  const profile = await call(session.access_token, 'tools/call', { name: 'get_profile', arguments: {} })
  assert(profile.response.ok && profile.body?.result?.isError === false, 'Authenticated MCP tools/call failed')

  const policyBefore = await call(session.access_token, 'tools/call', { name: 'get_investment_policy', arguments: {} })
  assert(policyBefore.body?.result?.structuredContent?.data?.profile == null, 'New contract user unexpectedly has an investment policy')
  const policyKey = crypto.randomUUID()
  const policyArgs = {
    schema_version: 1,
    expected_version: null,
    idempotency_key: policyKey,
    patch: {
      goal_text: 'Keep the contract-test goal explicit.',
      restrictions: [{ kind: 'prohibition', text: 'Do not infer missing preferences.' }],
    },
    change_reason: 'Verify policy interview save and read-back contract.',
  }
  const policySaved = await call(session.access_token, 'tools/call', { name: 'save_investment_policy', arguments: policyArgs })
  assert(policySaved.body?.result?.structuredContent?.data?.profile?.version === 1, 'Investment policy save contract failed')
  const policyRetry = await call(session.access_token, 'tools/call', { name: 'save_investment_policy', arguments: policyArgs })
  assert(policyRetry.body?.result?.structuredContent?.data?.profile?.version === 1, 'Investment policy idempotent retry failed')
  const policyAfter = await call(session.access_token, 'tools/call', { name: 'get_investment_policy', arguments: {} })
  assert(policyAfter.body?.result?.structuredContent?.data?.profile?.goal_text === policyArgs.patch.goal_text, 'Investment policy could not be read back')

  const context = await call(session.access_token, 'tools/call', {
    name: 'get_daily_context',
    arguments: { schema_version: 1, timezone: 'Asia/Seoul' },
  })
  const contextData = context.body?.result?.structuredContent?.data
  assert(context.body?.result?.isError === false && contextData?.context_id && contextData?.expires_at, 'Daily context contract failed')

  const saved = await call(session.access_token, 'tools/call', {
    name: 'save_daily_briefing',
    arguments: {
      schema_version: 1,
      context_id: contextData.context_id,
      idempotency_key: crypto.randomUUID(),
      evidence: [],
      scopes: [{
        local_key: 'portfolio',
        subject: { kind: 'portfolio' },
        window_from: new Date(Date.now() - 86400000).toISOString(),
        window_to: new Date().toISOString(),
        coverage: 'unverified',
        reason: 'Contract test does not perform external research.',
        checked_at: new Date().toISOString(),
        evidence_keys: [],
        checked_sources: [],
      }],
      briefing: {
        headline: 'Contract test briefing',
        status: 'insufficient_data',
        changes: ['No researched change was asserted.'],
        uncertainties: [{ title: 'External research was intentionally omitted.' }],
      },
    },
  })
  const savedData = saved.body?.result?.structuredContent?.data
  assert(saved.body?.result?.isError === false && savedData?.id && savedData?.coverage_status === 'failed', `Daily briefing save contract failed: ${JSON.stringify(saved.body?.result?.structuredContent?.error ?? savedData)}`)
  assert(savedData.changes?.[0]?.summary === 'No researched change was asserted.', 'Briefing item normalization failed')

  const reread = await call(session.access_token, 'tools/call', {
    name: 'get_daily_briefing',
    arguments: { briefing_id: savedData.id },
  })
  assert(reread.body?.result?.structuredContent?.data?.id === savedData.id, 'Saved daily briefing could not be read back')

  const briefingPage = await call(session.access_token, 'tools/call', {
    name: 'list_daily_briefings', arguments: { limit: 1, cursor: null },
  })
  assert(Array.isArray(briefingPage.body?.result?.structuredContent?.data?.items), 'Daily briefing cursor page contract failed')
  const tradePage = await call(session.access_token, 'tools/call', {
    name: 'list_transactions', arguments: { limit: 1, cursor: null },
  })
  assert(Array.isArray(tradePage.body?.result?.structuredContent?.data?.items), 'Transaction cursor page contract failed')

  const [account] = await adminWrite('accounts', 'POST', { user_id: userId, name: 'MCP Contract Account' })
  const [instrument] = await adminWrite('instruments', 'POST', {
    user_id: userId, ticker: 'MCP-CONTRACT', display_name: 'MCP Contract Holding', instrument_type: 'market', currency: 'KRW',
  })
  const [holding] = await adminWrite('holdings', 'POST', {
    user_id: userId, account_id: account.id, ticker: instrument.ticker, quantity: 1, avg_price: 100,
  })
  const correctionPreview = await call(session.access_token, 'tools/call', {
    name: 'preview_holding_reconciliation',
    arguments: { holding_id: holding.id, values: { quantity: '2', avg_price: '100' }, reason: 'Contract test correction', effective_on: new Date().toISOString().slice(0, 10), confirmed_fields: [] },
  })
  const previewId = correctionPreview.body?.result?.structuredContent?.data?.preview_id
  assert(previewId, 'Holding correction preview contract failed')

  const verificationKey = crypto.randomUUID()
  const verificationArgs = {
    schema_version: 1, holding_id: holding.id, expected_version: holding.state_version,
    fields: ['quantity'], verified_on: new Date().toISOString().slice(0, 10), note: 'Contract test', idempotency_key: verificationKey,
  }
  const verified = await call(session.access_token, 'tools/call', { name: 'verify_holdings', arguments: verificationArgs })
  const verificationId = verified.body?.result?.structuredContent?.data?.verification_id
  assert(verificationId, 'Holding verification contract failed')
  await adminWrite(`holdings?id=eq.${holding.id}`, 'PATCH', { quantity: 3, avg_price: 100 })
  const verificationRetry = await call(session.access_token, 'tools/call', { name: 'verify_holdings', arguments: verificationArgs })
  assert(verificationRetry.body?.result?.structuredContent?.data?.verification_id === verificationId, 'Lost verification response retry did not return the original success')

  const stale = await call(session.access_token, 'tools/call', {
    name: 'reconcile_holding', arguments: { schema_version: 1, preview_id: previewId, idempotency_key: crypto.randomUUID() },
  })
  assert(stale.body?.result?.structuredContent?.error?.code === 'preview_stale', 'Stale correction preview returned the wrong recovery contract')
  const keyConflict = await call(session.access_token, 'tools/call', {
    name: 'verify_holdings', arguments: { ...verificationArgs, expected_version: holding.state_version + 1, fields: ['avg_price'] },
  })
  assert(keyConflict.body?.result?.structuredContent?.error?.code === 'idempotency_conflict', 'Idempotency key conflict returned the wrong recovery contract')

  const invalid = await call(session.access_token, 'tools/call', { name: 'log_completed_trade', arguments: {} })
  const toolError = invalid.body?.result?.structuredContent?.error
  assert(invalid.response.ok && invalid.body?.result?.isError === true, 'Invalid tool input did not return an MCP tool error')
  assert(toolError?.code === 'validation_error' && toolError?.retryable === false, 'Invalid tool input returned the wrong recovery contract')
  assert(typeof toolError?.request_id === 'string' && toolError.request_id.length > 20, 'Tool error did not include a request ID')

  console.log('MCP initialize, workflow guides, policy save/read, daily briefing save/read, cursor pages, financial retry/conflict recovery, auth denial, and validation contracts passed.')
} finally {
  if (userId) {
    await fetch(`${baseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    })
  }
}
