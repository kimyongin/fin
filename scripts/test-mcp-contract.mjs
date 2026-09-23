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
  const discoveredNames = new Set(listed.body.result.tools.map((tool) => tool.name))
  for (const currentTool of ['list_principles','save_principle','list_private_holding_notes','save_private_holding_note']) {
    assert(discoveredNames.has(currentTool), `${currentTool} was not advertised`)
  }
  for (const legacyTool of ['get_news_state','get_investment_policy','save_investment_policy','get_holding_thesis','save_holding_thesis','link_task_to_holding_thesis']) {
    assert(!discoveredNames.has(legacyTool), `${legacyTool} remained in new-session discovery`)
  }
  for (const retiredTool of ['preview_trade_reversal','reverse_trade_entry']) {
    assert(!discoveredNames.has(retiredTool), `${retiredTool} remained in MCP discovery`)
  }
  const guideDefinition = listed.body?.result?.tools?.find((tool) => tool.name === 'get_workflow_guide')
  assert(guideDefinition?.inputSchema?.properties?.topic?.enum?.length === 9, 'Workflow guide topics were not advertised')

  for (const topic of guideDefinition.inputSchema.properties.topic.enum) {
    const guideResult = await call(session.access_token, 'tools/call', { name: 'get_workflow_guide', arguments: { topic } })
    const guide = guideResult.body?.result?.structuredContent?.data
    assert(guideResult.body?.result?.isError === false && guide?.topic === topic && guide?.revision && guide?.steps?.length, `Workflow guide call failed for ${topic}`)
  }
  const unknownGuide = await call(session.access_token, 'tools/call', { name: 'get_workflow_guide', arguments: { topic: 'unknown' } })
  assert(unknownGuide.body?.result?.structuredContent?.error?.code === 'validation_error', 'Unknown workflow guide topic did not return validation_error')

  const profile = await call(session.access_token, 'tools/call', { name: 'get_profile', arguments: {} })
  assert(profile.response.ok && profile.body?.result?.isError === false, 'Authenticated MCP tools/call failed')

  const initialPrinciples = await call(session.access_token, 'tools/call', { name: 'list_principles', arguments: {} })
  assert(initialPrinciples.body?.result?.structuredContent?.data?.items?.length === 0, 'New MCP user unexpectedly has principles')
  const principleArgs = {
    schema_version: 1, principle_id: crypto.randomUUID(), expected_row_id: null,
    kind: 'investment', body: 'Contract-approved long-term rule', scope: null, end: false,
  }
  const savedPrinciple = await call(session.access_token, 'tools/call', { name: 'save_principle', arguments: principleArgs })
  assert(savedPrinciple.body?.result?.structuredContent?.data?.body === principleArgs.body, 'MCP principle save failed')
  const listedPrinciples = await call(session.access_token, 'tools/call', { name: 'list_principles', arguments: {} })
  assert(listedPrinciples.body?.result?.structuredContent?.data?.items?.some((item) => item.principle_id === principleArgs.principle_id), 'MCP principle readback failed')
  const privateNotes = await call(session.access_token, 'tools/call', { name: 'list_private_holding_notes', arguments: {} })
  assert(privateNotes.body?.result?.structuredContent?.data?.items?.length === 0, 'New MCP user unexpectedly has private holding notes')

  const reportDateParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((part) => [part.type, part.value]))
  const reportDate = `${reportDateParts.year}-${reportDateParts.month}-${reportDateParts.day}`
  const reportContext = await call(session.access_token, 'tools/call', { name: 'get_activity_report_context', arguments: { period_start: reportDate, period_end: reportDate, timezone: 'Asia/Seoul', limit: 200, cursor: null } })
  assert(reportContext.body?.result?.structuredContent?.data?.next_cursor === null, 'Activity report context contract failed')
  const reportSaved = await call(session.access_token, 'tools/call', { name: 'record_manual_activity', arguments: {
    schema_version: 1, idempotency_key: crypto.randomUUID(), title: 'Contract activity retrospective',
    note: `Period: ${reportDate}`, result: 'Reviewed the complete period source.', conclusion: null,
    occurred_at: null, timezone: 'Asia/Seoul', instrument_id: null, account_id: null,
    category: 'retrospective', context: { scope: `${reportDate} ~ ${reportDate}` },
  } })
  assert(reportSaved.body?.result?.structuredContent?.data?.record_kind === 'retrospective', 'Retrospective activity save contract failed')

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

  const policyPrincipleArgs = {
    schema_version: 1, principle_id: crypto.randomUUID(), expected_row_id: null,
    kind: 'prohibition', body: 'Do not infer missing preferences.', end: false,
  }
  const policySaved = await call(session.access_token, 'tools/call', {
    name: 'save_principle', arguments: policyPrincipleArgs,
  })
  assert(policySaved.body?.result?.structuredContent?.data?.body === policyPrincipleArgs.body,
    'Personal principle save contract failed')
  const policyAfter = await call(session.access_token, 'tools/call', {
    name: 'list_principles', arguments: {},
  })
  assert(policyAfter.body?.result?.structuredContent?.data?.items?.some((item) => item.body === policyPrincipleArgs.body),
    'Personal principle could not be read back')

  const operationPrincipleArgs = {
    schema_version: 1, principle_id: crypto.randomUUID(), expected_row_id: null,
    kind: 'operation', scope: 'reconciliation', end: false,
    body: 'For this brokerage export, distinguish acquisition and valuation amounts.',
  }
  const operationSaved = await call(session.access_token, 'tools/call', {
    name: 'save_principle', arguments: operationPrincipleArgs,
  })
  assert(operationSaved.body?.result?.structuredContent?.data?.body === operationPrincipleArgs.body,
    'Operating principle save contract failed')
  const operationAfter = await call(session.access_token, 'tools/call', {
    name: 'list_principles', arguments: {},
  })
  assert(operationAfter.body?.result?.structuredContent?.data?.items?.some((item) =>
    item.principle_id === operationPrincipleArgs.principle_id && item.kind === 'operation' && item.scope === 'reconciliation'),
  'Operating principle could not be read back')

  const taskArgs = {
    schema_version: 1, task_id: null, expected_version: null, idempotency_key: crypto.randomUUID(),
    title: 'Contract follow-up', subject: { kind: 'portfolio' }, due_date: null, timezone: 'Asia/Seoul',
    trigger_text: 'Next review', change_reason: null, recurrence_kind: 'none', recurrence_start_on: null,
  }
  const taskSaved = await call(session.access_token, 'tools/call', { name: 'save_general_task', arguments: taskArgs })
  const savedTask = taskSaved.body?.result?.structuredContent?.data
  assert(savedTask?.kind === 'general' && savedTask?.status === 'open', 'General task save contract failed')
  const taskRetry = await call(session.access_token, 'tools/call', { name: 'save_general_task', arguments: taskArgs })
  assert(taskRetry.body?.result?.structuredContent?.data?.id === savedTask.id, 'General task idempotent retry failed')
  const retiredLink = await call(session.access_token, 'tools/call', {
    name: 'save_general_task',
    arguments: { ...taskArgs, idempotency_key: crypto.randomUUID(), origin_activity_id: crypto.randomUUID() },
  })
  assert(retiredLink.body?.result?.isError === true, 'Retired follow-up link must fail instead of silently creating an unrelated task')

  const context = await call(session.access_token, 'tools/call', {
    name: 'get_daily_context',
    arguments: { schema_version: 1, timezone: 'Asia/Seoul' },
  })
  const contextData = context.body?.result?.structuredContent?.data
  assert(context.body?.result?.isError === false && contextData?.as_of && !contextData?.context_id, 'Read-only daily context contract failed')
  assert(Array.isArray(contextData?.recent_reviews) && Array.isArray(contextData?.recent_decisions), 'Daily context activity lists contract failed')
  assert(contextData?.open_tasks?.some((item) => item.id === savedTask.id), 'Daily context unified task contract failed')

  const saved = await call(session.access_token, 'tools/call', {
    name: 'record_manual_activity',
    arguments: {
      schema_version: 1,
      idempotency_key: crypto.randomUUID(),
      title: 'Contract test review', note: 'External research was intentionally omitted.',
      result: 'No researched change was asserted.', conclusion: 'Insufficient data.',
      occurred_at: null, timezone: 'Asia/Seoul', instrument_id: null, account_id: null,
      category: 'review', context: { status: 'insufficient_data', coverage_status: 'failed', scope: 'portfolio' },
    },
  })
  const savedData = saved.body?.result?.structuredContent?.data
  assert(saved.body?.result?.isError === false && savedData?.id && savedData?.record_kind === 'review', `Review activity save contract failed: ${JSON.stringify(saved.body?.result?.structuredContent?.error ?? savedData)}`)

  const briefingPage = await call(session.access_token, 'tools/call', {
    name: 'list_review_activities', arguments: { limit: 1, cursor: null },
  })
  assert(briefingPage.body?.result?.structuredContent?.data?.items?.[0]?.id === savedData.id, 'Saved review activity cursor page contract failed')
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
  const correctionVersion = correctionPreview.body?.result?.structuredContent?.data?.holding_state_version
  assert(correctionVersion === holding.state_version, 'Holding correction estimate contract failed')

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
    name: 'reconcile_holding', arguments: { schema_version: 1, holding_id: holding.id, values: { quantity: '2', avg_price: '100' }, reason: 'Contract test correction', effective_on: new Date().toISOString().slice(0, 10), confirmed_fields: [], expected_version: correctionVersion, idempotency_key: crypto.randomUUID() },
  })
  assert(stale.body?.result?.structuredContent?.error?.code === 'version_conflict', 'Stale correction estimate returned the wrong recovery contract')
  const keyConflict = await call(session.access_token, 'tools/call', {
    name: 'verify_holdings', arguments: { ...verificationArgs, expected_version: holding.state_version + 1, fields: ['avg_price'] },
  })
  assert(keyConflict.body?.result?.structuredContent?.error?.code === 'idempotency_conflict', 'Idempotency key conflict returned the wrong recovery contract')

  const invalid = await call(session.access_token, 'tools/call', { name: 'log_completed_trade', arguments: {} })
  const toolError = invalid.body?.result?.structuredContent?.error
  assert(invalid.response.ok && invalid.body?.result?.isError === true, 'Invalid tool input did not return an MCP tool error')
  assert(toolError?.code === 'validation_error' && toolError?.retryable === false, 'Invalid tool input returned the wrong recovery contract')
  assert(typeof toolError?.request_id === 'string' && toolError.request_id.length > 20, 'Tool error did not include a request ID')

  console.log('OAuth and token MCP initialize/discovery/authentication, workflow guides, product feedback, policy save/read, review activity save/read, cursor pages, financial retry/conflict recovery, auth denial, and validation contracts passed.')
} finally {
  if (userId) {
    await fetch(`${baseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    })
  }
}
