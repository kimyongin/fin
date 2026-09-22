const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
const missing = required.filter((name) => !process.env[name])
if (missing.length) throw new Error(`Missing local MCP contract environment: ${missing.join(', ')}`)

const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, '')
const hostname = new URL(baseUrl).hostname
if (!['127.0.0.1', 'localhost'].includes(hostname)) throw new Error('MCP contract test only runs against local Supabase')

const anonKey = process.env.SUPABASE_ANON_KEY
const functionUrl = `${baseUrl}/functions/v1/portfolio-mcp-oauth`
const tokenFunctionUrl = `${baseUrl}/functions/v1/portfolio-mcp`
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

async function callTokenMcp(agentToken, method, params = {}) {
  const response = await fetch(tokenFunctionUrl, {
    method: 'POST',
    headers: { ...commonHeaders, Authorization: `Bearer ${agentToken}` },
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

  const email = `mcp-contract-${crypto.randomUUID()}@example.com`
  const password = `Contract-${crypto.randomUUID()}`
  const createdUser = await fetch(`${baseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { ...commonHeaders, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  assert(createdUser.ok, `Local contract user creation failed (${createdUser.status})`)
  const createdUserData = await createdUser.json()
  userId = createdUserData.id
  const signup = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: commonHeaders, body: JSON.stringify({ email, password }),
  })
  assert(signup.ok, `Local contract sign-in failed (${signup.status})`)
  const session = await signup.json()
  assert(session.access_token && session.user?.id, 'Local contract sign-in returned no session')
  userId = session.user.id

  const initialized = await call(session.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'contract-test', version: '1' } })
  assert(initialized.response.ok && initialized.body?.result?.protocolVersion === '2025-06-18', 'MCP initialize contract failed')

  const listed = await call(session.access_token, 'tools/list')
  assert(listed.response.ok && listed.body?.result?.tools?.some((tool) => tool.name === 'get_profile'), 'MCP tools/list contract failed')
  const guideDefinition = listed.body?.result?.tools?.find((tool) => tool.name === 'get_workflow_guide')
  assert(guideDefinition?.inputSchema?.properties?.topic?.enum?.length === 7, 'Workflow guide topics were not advertised')

  for (const topic of guideDefinition.inputSchema.properties.topic.enum) {
    const guideResult = await call(session.access_token, 'tools/call', { name: 'get_workflow_guide', arguments: { topic } })
    const guide = guideResult.body?.result?.structuredContent?.data
    assert(guideResult.body?.result?.isError === false && guide?.topic === topic && guide?.revision && guide?.steps?.length, `Workflow guide call failed for ${topic}`)
  }
  const unknownGuide = await call(session.access_token, 'tools/call', { name: 'get_workflow_guide', arguments: { topic: 'unknown' } })
  assert(unknownGuide.body?.result?.structuredContent?.error?.code === 'validation_error', 'Unknown workflow guide topic did not return validation_error')

  const profile = await call(session.access_token, 'tools/call', { name: 'get_profile', arguments: {} })
  assert(profile.response.ok && profile.body?.result?.isError === false, 'Authenticated MCP tools/call failed')

  const feedbackArgs = {
    schema_version: 1,
    body: 'The contract test found a repeatable product usability issue.',
    context: { page_key: 'feedback', tool_name: 'submit_product_feedback' },
    idempotency_key: crypto.randomUUID(),
  }
  const feedbackSaved = await call(session.access_token, 'tools/call', { name: 'submit_product_feedback', arguments: feedbackArgs })
  const feedbackData = feedbackSaved.body?.result?.structuredContent?.data
  assert(feedbackSaved.body?.result?.isError === false && feedbackData?.id && feedbackData?.status === 'received', 'Product feedback submit contract failed')
  const feedbackRetry = await call(session.access_token, 'tools/call', { name: 'submit_product_feedback', arguments: feedbackArgs })
  assert(feedbackRetry.body?.result?.structuredContent?.data?.id === feedbackData.id, 'Product feedback idempotent retry failed')
  const feedbackPage = await call(session.access_token, 'tools/call', { name: 'list_my_product_feedback', arguments: { cursor: null, limit: 20 } })
  assert(feedbackPage.body?.result?.structuredContent?.data?.items?.some((item) => item.id === feedbackData.id), 'Product feedback could not be read back')
  const unsafeFeedback = await call(session.access_token, 'tools/call', {
    name: 'submit_product_feedback',
    arguments: { ...feedbackArgs, idempotency_key: crypto.randomUUID(), context: { email: 'not-allowed@example.com' } },
  })
  assert(unsafeFeedback.body?.result?.structuredContent?.error?.code === 'validation_error', 'Unsafe feedback context did not return validation_error')

  const agentToken = `fin_agent_contract_${crypto.randomUUID()}`
  const tokenHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(agentToken)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  const tokenCreated = await fetch(`${baseUrl}/rest/v1/rpc/agent_create_token`, {
    method: 'POST',
    headers: { ...commonHeaders, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ input_name: 'MCP contract token', input_token_hash: tokenHash, input_token_prefix: `${agentToken.slice(0, 18)}...` }),
  })
  assert(tokenCreated.ok, `Local agent token creation failed (${tokenCreated.status})`)
  const tokenInitialized = await callTokenMcp(agentToken, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'contract-test', version: '1' } })
  assert(tokenInitialized.response.ok && tokenInitialized.body?.result?.protocolVersion === '2024-11-05', `Token MCP initialize contract failed (${tokenInitialized.response.status}): ${JSON.stringify(tokenInitialized.body)}`)
  const tokenTools = await callTokenMcp(agentToken, 'tools/list')
  assert(tokenTools.body?.result?.tools?.some((tool) => tool.name === 'get_portfolio_state'), 'Token MCP tools/list contract failed')
  const tokenPortfolio = await callTokenMcp(agentToken, 'tools/call', { name: 'get_portfolio_state', arguments: {} })
  assert(tokenPortfolio.response.ok && tokenPortfolio.body?.result?.content?.[0]?.text, 'Token MCP authenticated tools/call failed')
  const invalidTokenPortfolio = await callTokenMcp(`${agentToken}-invalid`, 'tools/call', { name: 'get_portfolio_state', arguments: {} })
  assert(invalidTokenPortfolio.body?.error, 'Token MCP accepted an invalid agent token')

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

  const ruleBefore = await call(session.access_token, 'tools/call', {
    name: 'list_operating_rules', arguments: { workflow_key: 'reconciliation' },
  })
  assert(ruleBefore.body?.result?.structuredContent?.data?.rules?.length === 0, 'New contract user unexpectedly has an operating rule')
  const ruleArgs = {
    schema_version: 1,
    rule_id: null,
    expected_version: null,
    idempotency_key: crypto.randomUUID(),
    title: 'Contract reconciliation rule',
    workflow_key: 'reconciliation',
    applicability: 'Contract-test brokerage export',
    body: 'Treat acquisition amount and valuation amount as different fields; never divide by zero quantity.',
    change_reason: 'Verify reusable operating-rule contracts.',
  }
  const ruleSaved = await call(session.access_token, 'tools/call', { name: 'save_operating_rule', arguments: ruleArgs })
  const savedRule = ruleSaved.body?.result?.structuredContent?.data?.rule
  assert(savedRule?.version === 1 && savedRule?.status === 'active', 'Operating rule save contract failed')
  const ruleRetry = await call(session.access_token, 'tools/call', { name: 'save_operating_rule', arguments: ruleArgs })
  assert(ruleRetry.body?.result?.structuredContent?.data?.rule?.id === savedRule.id, 'Operating rule idempotent retry failed')
  const ruleAfter = await call(session.access_token, 'tools/call', {
    name: 'list_operating_rules', arguments: { workflow_key: 'reconciliation' },
  })
  assert(ruleAfter.body?.result?.structuredContent?.data?.rules?.[0]?.body === ruleArgs.body, 'Operating rule could not be read back')
  const ruleArchived = await call(session.access_token, 'tools/call', {
    name: 'archive_operating_rule', arguments: {
      schema_version: 1, rule_id: savedRule.id, expected_version: 1,
      idempotency_key: crypto.randomUUID(), reason: 'Finish contract lifecycle.',
    },
  })
  assert(ruleArchived.body?.result?.structuredContent?.data?.rule?.status === 'archived', 'Operating rule archive contract failed')

  const todoArgs = {
    schema_version: 1, bundle_id: null, expected_version: null, idempotency_key: crypto.randomUUID(),
    title: 'Contract session outcomes', summary: 'Four results saved as one bundle.', tags: ['contract', 'contract'],
    items: ['Read data', 'Checked fields', 'Saved rule', 'Recorded result'].map((title, index) => ({
      kind: 'general', sort_order: index, title, status: 'done', result: `${title} completed.`, performed_at: new Date().toISOString(),
    })),
    remove_item_ids: [], rule_ids: [savedRule.id], decision_ids: null, verification_ids: null,
  }
  const todoSaved = await call(session.access_token, 'tools/call', { name: 'save_todo_bundle', arguments: todoArgs })
  const savedTodo = todoSaved.body?.result?.structuredContent?.data
  assert(savedTodo?.status === 'completed' && savedTodo?.items?.length === 4, 'ToDo bundle save contract failed')
  const todoRetry = await call(session.access_token, 'tools/call', { name: 'save_todo_bundle', arguments: todoArgs })
  assert(todoRetry.body?.result?.structuredContent?.data?.id === savedTodo.id, 'ToDo bundle idempotent retry failed')
  const todoList = await call(session.access_token, 'tools/call', { name: 'list_todo_bundles', arguments: { filter: 'completed' } })
  assert(todoList.body?.result?.structuredContent?.data?.items?.some((item) => item.id === savedTodo.id), 'ToDo bundle list contract failed')
  const todoDetail = await call(session.access_token, 'tools/call', { name: 'get_todo_bundle', arguments: { bundle_id: savedTodo.id } })
  assert(todoDetail.body?.result?.structuredContent?.data?.rules?.[0]?.id === savedRule.id, 'ToDo bundle rule snapshot contract failed')

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
  const noteKey = crypto.randomUUID()
  const noteArgs = { schema_version: 1, entity_type: 'holding', entity_id: holding.id, expected_note: null, note: 'Contract note', idempotency_key: noteKey }
  const noteSaved = await call(session.access_token, 'tools/call', { name: 'update_entity_note', arguments: noteArgs })
  assert(noteSaved.body?.result?.structuredContent?.data?.note === 'Contract note', 'Holding note update contract failed')
  const noteRetry = await call(session.access_token, 'tools/call', { name: 'update_entity_note', arguments: noteArgs })
  assert(noteRetry.body?.result?.structuredContent?.data?.note === 'Contract note', 'Holding note retry contract failed')
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
  assert(verified.body?.result?.structuredContent?.data?.note === 'Contract test', 'Holding verification did not return its note')
  const integrity = await call(session.access_token, 'tools/call', { name: 'get_holding_integrity', arguments: { holding_id: holding.id } })
  assert(integrity.body?.result?.structuredContent?.data?.last_verification?.note === 'Contract test', 'Holding integrity did not return the latest note')
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

  console.log('OAuth and token MCP initialize/discovery/authentication, workflow guides, product feedback, policy save/read, daily briefing save/read, cursor pages, financial retry/conflict recovery, auth denial, and validation contracts passed.')
} finally {
  if (userId) {
    await fetch(`${baseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    })
  }
}
