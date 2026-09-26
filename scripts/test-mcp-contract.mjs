import { assertMutationRpcSignatures } from './deployment-rpc-contract.mjs'

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
const missing = required.filter((name) => !process.env[name])
if (missing.length) throw new Error(`Missing local MCP contract environment: ${missing.join(', ')}`)

const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, '')
const hostname = new URL(baseUrl).hostname
if (!['127.0.0.1', 'localhost'].includes(hostname)) throw new Error('MCP contract test only runs against local Supabase')

const anonKey = process.env.SUPABASE_ANON_KEY
const functionUrl = `${baseUrl}/functions/v1/portfolio-mcp-oauth`
const commonHeaders = { apikey: anonKey, 'Content-Type': 'application/json' }
const userIds = []

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

  const email = `mcp-contract-${crypto.randomUUID()}@example.com`
  const password = `Contract-${crypto.randomUUID()}`
  const createdUser = await fetch(`${baseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { ...commonHeaders, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  assert(createdUser.ok, `Local contract user creation failed (${createdUser.status})`)
  const createdUserData = await createdUser.json()
  userIds.push(createdUserData.id)
  const signup = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: commonHeaders, body: JSON.stringify({ email, password }),
  })
  assert(signup.ok, `Local contract sign-in failed (${signup.status})`)
  const session = await signup.json()
  assert(session.access_token && session.user?.id, 'Local contract sign-in returned no session')
  const userId = session.user.id
  const openApi = await fetch(`${baseUrl}/rest/v1/`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}`, Accept: 'application/openapi+json' },
  })
  assert(openApi.ok, 'Authenticated RPC discovery failed')
  assertMutationRpcSignatures(await openApi.json())

  const initialized = await call(session.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'contract-test', version: '1' } })
  assert(initialized.response.ok && initialized.body?.result?.protocolVersion === '2025-06-18', 'MCP initialize contract failed')

  const listed = await call(session.access_token, 'tools/list')
  assert(listed.response.ok && listed.body?.result?.tools?.some((tool) => tool.name === 'get_profile'), 'MCP tools/list contract failed')
  const discoveredNames = new Set(listed.body.result.tools.map((tool) => tool.name))
  const priceSyncTool = listed.body.result.tools.find((tool) => tool.name === 'sync_prices')
  assert(priceSyncTool?.annotations?.openWorldHint === true &&
    !Object.keys(priceSyncTool.inputSchema.properties).some((key) => ['price','close','rate','ticker','date_from','date_to'].includes(key)),
  'OAuth price sync must not accept arbitrary quote or date inputs')
  assert(discoveredNames.has('list_due_general_tasks'), 'Due task tool was not discovered')
  const dueTasks = await call(session.access_token, 'tools/call', { name: 'list_due_general_tasks', arguments: { limit: 10, offset: 0 } })
  assert(dueTasks.body?.result?.isError === false && Array.isArray(dueTasks.body?.result?.structuredContent?.data?.items), 'Due task MCP read failed')
  for (const currentTool of ['list_principles','save_principle','list_principle_changes','get_principle_row','correct_principle_row','delete_principle_row','get_portfolio_state','sync_prices','update_entity_note','save_account','delete_account','create_instrument','save_asset_detail','delete_holding','delete_instrument','save_asset_tag','delete_asset_tag','save_allocation_targets','get_my_product_feedback','update_my_product_feedback','delete_my_product_feedback','list_product_feedback_admin','update_product_feedback_admin','get_sharing_profile','save_sharing_profile','reset_sharing_profile','set_profile_avatar','list_friends','connect_friend','remove_friend','list_portfolio_viewers','get_shared_portfolio_state']) {
    assert(discoveredNames.has(currentTool), `${currentTool} was not advertised`)
  }
  for (const legacyTool of ['get_news_state','get_investment_policy','save_investment_policy','get_holding_thesis','save_holding_thesis','link_task_to_holding_thesis','list_private_holding_notes','save_private_holding_note']) {
    assert(!discoveredNames.has(legacyTool), `${legacyTool} remained in new-session discovery`)
  }
  for (const retiredTool of ['preview_trade_reversal','reverse_trade_entry']) {
    assert(!discoveredNames.has(retiredTool), `${retiredTool} remained in MCP discovery`)
  }
  const guideDefinition = listed.body?.result?.tools?.find((tool) => tool.name === 'get_workflow_guide')
  assert(guideDefinition?.inputSchema?.properties?.topic?.enum?.includes('assets'), 'Asset workflow guide was not advertised')

  for (const topic of guideDefinition.inputSchema.properties.topic.enum) {
    const guideResult = await call(session.access_token, 'tools/call', { name: 'get_workflow_guide', arguments: { topic } })
    const guide = guideResult.body?.result?.structuredContent?.data
    assert(guideResult.body?.result?.isError === false && guide?.topic === topic && guide?.revision && guide?.steps?.length, `Workflow guide call failed for ${topic}`)
  }
  const unknownGuide = await call(session.access_token, 'tools/call', { name: 'get_workflow_guide', arguments: { topic: 'unknown' } })
  assert(unknownGuide.body?.result?.structuredContent?.error?.code === 'validation_error', 'Unknown workflow guide topic did not return validation_error')

  const profile = await call(session.access_token, 'tools/call', { name: 'get_profile', arguments: {} })
  assert(profile.response.ok && profile.body?.result?.isError === false, 'Authenticated MCP tools/call failed')
  const initialSharing = await call(session.access_token, 'tools/call', { name: 'get_sharing_profile', arguments: {} })
  assert(initialSharing.body?.result?.structuredContent?.data?.sharing_enabled === false, 'Initial sharing profile read failed')
  const sharingName = `contract-${crypto.randomUUID().slice(0, 12)}`
  const sharingSaved = await call(session.access_token, 'tools/call', { name: 'save_sharing_profile', arguments: {
    schema_version: 1, public_name: sharingName, viewer_password: 'contract-secret', sharing_enabled: true,
  } })
  const safeSharing = sharingSaved.body?.result?.structuredContent?.data
  assert(safeSharing?.sharing_enabled === true && !JSON.stringify(safeSharing).includes('contract-secret') && !('viewer_password_hash' in safeSharing), 'Sharing save exposed credentials or failed')
  const profileHttp = await fetch(`${baseUrl}/rest/v1/rpc/app_get_sharing_profile`, {
    method: 'POST', headers: { ...commonHeaders, Authorization: `Bearer ${session.access_token}` }, body: '{}',
  })
  const profileHttpData = await profileHttp.json()
  assert(profileHttp.ok && profileHttpData.public_name === sharingName && !('viewer_password_hash' in profileHttpData), 'HTTP could not read MCP sharing write safely')
  const avatarSaved = await call(session.access_token, 'tools/call', { name: 'set_profile_avatar', arguments: { schema_version: 1, avatar_key: 'cherry' } })
  assert(avatarSaved.body?.result?.structuredContent?.data?.avatar_key === 'cherry', 'OAuth avatar update failed')

  const friendEmail = `mcp-friend-${crypto.randomUUID()}@example.com`
  const friendPassword = `Friend-${crypto.randomUUID()}`
  const friendCreated = await fetch(`${baseUrl}/auth/v1/admin/users`, {
    method: 'POST', headers: { ...commonHeaders, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ email: friendEmail, password: friendPassword, email_confirm: true }),
  })
  assert(friendCreated.ok, 'Local friend contract user creation failed')
  userIds.push((await friendCreated.json()).id)
  const friendLogin = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: commonHeaders, body: JSON.stringify({ email: friendEmail, password: friendPassword }),
  })
  assert(friendLogin.ok, 'Local friend contract sign-in failed')
  const friendSession = await friendLogin.json()
  const connected = await call(friendSession.access_token, 'tools/call', { name: 'connect_friend', arguments: {
    schema_version: 1, public_name: sharingName, viewer_password: 'contract-secret',
  } })
  assert(connected.body?.result?.isError === false, 'Friend could not connect over OAuth')
  const friendList = await call(friendSession.access_token, 'tools/call', { name: 'list_friends', arguments: {} })
  assert(friendList.body?.result?.structuredContent?.data?.some((item) => item.owner_user_id === session.user.id), 'Friend connection not listed')
  const friendPortfolio = await call(friendSession.access_token, 'tools/call', { name: 'get_shared_portfolio_state', arguments: { owner_user_id: session.user.id } })
  assert(friendPortfolio.body?.result?.isError === false, 'Friend could not read shared portfolio')
  const incoming = await call(session.access_token, 'tools/call', { name: 'list_portfolio_viewers', arguments: {} })
  assert(incoming.body?.result?.structuredContent?.data?.items?.some((item) => item.viewer_user_id === friendSession.user.id), 'Owner cannot read incoming connected friend')
  const resetSharing = await call(session.access_token, 'tools/call', { name: 'reset_sharing_profile', arguments: { schema_version: 1 } })
  assert(resetSharing.body?.result?.structuredContent?.data?.sharing_enabled === false, 'OAuth sharing reset failed')
  const friendAfterReset = await call(friendSession.access_token, 'tools/call', { name: 'get_shared_portfolio_state', arguments: { owner_user_id: session.user.id } })
  assert(friendAfterReset.body?.result?.isError === true, 'Old friend can still read after owner reset')
  const sharingReenabled = await call(session.access_token, 'tools/call', { name: 'save_sharing_profile', arguments: {
    schema_version: 1, public_name: sharingName, viewer_password: 'new-contract-secret', sharing_enabled: true,
  } })
  assert(sharingReenabled.body?.result?.structuredContent?.data?.sharing_enabled === true, 'Sharing could not be reenabled after reset')
  const reconnected = await call(friendSession.access_token, 'tools/call', { name: 'connect_friend', arguments: {
    schema_version: 1, public_name: sharingName, viewer_password: 'new-contract-secret',
  } })
  assert(reconnected.body?.result?.isError === false, 'Friend could not reconnect with new credentials')
  const reauthorized = await call(friendSession.access_token, 'tools/call', { name: 'connect_friend', arguments: {
    schema_version: 1, public_name: sharingName, viewer_password: 'new-contract-secret',
  } })
  assert(reauthorized.body?.result?.isError === false, 'Existing friend reauthentication failed')
  const removedFriend = await call(friendSession.access_token, 'tools/call', { name: 'remove_friend', arguments: {
    schema_version: 1, owner_user_id: session.user.id,
  } })
  assert(removedFriend.body?.result?.structuredContent?.data?.removed === true, 'Friend removal failed')
  const friendAfterRemoval = await call(friendSession.access_token, 'tools/call', { name: 'get_shared_portfolio_state', arguments: { owner_user_id: session.user.id } })
  assert(friendAfterRemoval.body?.result?.isError === true, 'Removed friend can still read')
  const emptyPriceSync = await call(session.access_token, 'tools/call', { name: 'sync_prices', arguments: { schema_version: 1 } })
  assert(emptyPriceSync.body?.result?.structuredContent?.data?.status === 'success' && emptyPriceSync.body.result.structuredContent.data.total_count === 0, 'OAuth price sync did not match empty web refresh')

  const initialPrinciples = await call(session.access_token, 'tools/call', { name: 'list_principles', arguments: {} })
  assert(initialPrinciples.body?.result?.structuredContent?.data?.items?.length === 0, 'New MCP user unexpectedly has principles')
  const activityTagSaved = await call(session.access_token, 'tools/call', { name: 'save_activity_tag', arguments: {
    schema_version: 1, tag_id: null, expected_version: null, idempotency_key: crypto.randomUUID(), name: 'Contract change',
  } })
  const activityTagId = activityTagSaved.body?.result?.structuredContent?.data?.id
  assert(activityTagId, 'Activity tag creation for domain saves failed')
  const activityTags = await call(session.access_token, 'tools/call', { name: 'list_activity_tags', arguments: { query: null } })
  assert(activityTags.body?.result?.structuredContent?.data?.some((tag) => tag.id === activityTagId), 'Activity tag lookup before domain save failed')
  const principleArgs = {
    schema_version: 1, principle_id: crypto.randomUUID(), expected_row_id: null,
    expected_body: null, expected_change_note: null,
    body: '## Long-term rule\nContract-approved long-term rule', change_note: 'Initial rule', activity_tag_ids: [activityTagId],
  }
  const savedPrinciple = await call(session.access_token, 'tools/call', { name: 'save_principle', arguments: principleArgs })
  assert(savedPrinciple.body?.result?.structuredContent?.data?.body === principleArgs.body, 'MCP principle save failed')
  const principleActivityId = savedPrinciple.body?.result?.structuredContent?.data?.activity_id
  const principleActivity = await call(session.access_token, 'tools/call', { name: 'get_activity', arguments: { activity_id: principleActivityId } })
  assert(principleActivityId && principleActivity.body?.result?.structuredContent?.data?.tags?.some((tag) => tag.id === activityTagId), 'MCP principle activity tag was not readable')
  const listedPrinciples = await call(session.access_token, 'tools/call', { name: 'list_principles', arguments: {} })
  assert(listedPrinciples.body?.result?.structuredContent?.data?.items?.some((item) => item.principle_id === principleArgs.principle_id), 'MCP principle readback failed')

  const reportDateParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((part) => [part.type, part.value]))
  const reportDate = `${reportDateParts.year}-${reportDateParts.month}-${reportDateParts.day}`
  const reportContext = await call(session.access_token, 'tools/call', { name: 'get_activity_report_context', arguments: { period_start: reportDate, period_end: reportDate, timezone: 'Asia/Seoul', limit: 200, cursor: null } })
  assert(reportContext.body?.result?.structuredContent?.data?.next_cursor === null, 'Activity report context contract failed')
  const reportSaved = await call(session.access_token, 'tools/call', { name: 'record_manual_activity', arguments: {
    schema_version: 1, idempotency_key: crypto.randomUUID(), title: 'Contract activity retrospective',
    body: `Period: ${reportDate}\n\nReviewed the complete period source.`,
    occurred_at: null, timezone: 'Asia/Seoul', task_id: null,
    instrument_id: null, tag_ids: [],
  } })
  assert(reportSaved.body?.result?.structuredContent?.data?.body?.includes(reportDate), 'Retrospective activity save contract failed')

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

  const feedbackDetail = await call(session.access_token, 'tools/call', { name: 'get_my_product_feedback', arguments: { feedback_id: feedbackData.id } })
  assert(feedbackDetail.body?.result?.structuredContent?.data?.body === feedbackArgs.body, 'MCP feedback detail failed')
  const feedbackUpdated = await call(session.access_token, 'tools/call', { name: 'update_my_product_feedback', arguments: {
    schema_version: 1, feedback_id: feedbackData.id, expected_version: feedbackData.version, body: 'Corrected product feedback.',
  } })
  assert(feedbackUpdated.body?.result?.structuredContent?.data?.body === 'Corrected product feedback.', 'MCP feedback correction failed')
  const adminDenied = await call(session.access_token, 'tools/call', { name: 'list_product_feedback_admin', arguments: {} })
  assert(adminDenied.body?.result?.isError === true, 'Non-admin could read feedback triage')
  await adminWrite('product_feedback_admins', 'POST', { user_id: userId })
  const adminPage = await call(session.access_token, 'tools/call', { name: 'list_product_feedback_admin', arguments: { limit: 10, cursor: null, status: null } })
  assert(adminPage.body?.result?.structuredContent?.data?.items?.some((item) => item.id === feedbackData.id), 'Allowlisted admin could not read triage queue')
  const adminUpdated = await call(session.access_token, 'tools/call', { name: 'update_product_feedback_admin', arguments: {
    schema_version: 1, feedback_id: feedbackData.id, expected_version: feedbackUpdated.body.result.structuredContent.data.version,
    status: 'reviewing', response: null, github_issue_url: null,
  } })
  const adminVersion = adminUpdated.body?.result?.structuredContent?.data?.version
  assert(adminVersion > feedbackUpdated.body.result.structuredContent.data.version, 'Allowlisted admin triage update failed')
  const feedbackDeleted = await call(session.access_token, 'tools/call', { name: 'delete_my_product_feedback', arguments: {
    schema_version: 1, feedback_id: feedbackData.id, expected_version: adminVersion,
  } })
  assert(feedbackDeleted.body?.result?.structuredContent?.data?.deleted === true, 'MCP feedback removal failed')
  const feedbackGone = await call(session.access_token, 'tools/call', { name: 'get_my_product_feedback', arguments: { feedback_id: feedbackData.id } })
  assert(feedbackGone.body?.result?.isError === true, 'Deleted feedback remained readable')
  const feedbackAfterDeleteRetry = await call(session.access_token, 'tools/call', { name: 'submit_product_feedback', arguments: feedbackArgs })
  assert(feedbackAfterDeleteRetry.body?.result?.isError === true, 'Old feedback submission retry resurrected deleted text')

  const tokenCreated = await fetch(`${baseUrl}/rest/v1/rpc/agent_create_token`, {
    method: 'POST',
    headers: { ...commonHeaders, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ input_name: 'retired', input_token_hash: '0'.repeat(64), input_token_prefix: 'retired' }),
  })
  assert(tokenCreated.status === 404, `Retired agent token issuance is still available (${tokenCreated.status})`)

  const policyPrincipleArgs = {
    schema_version: 1, principle_id: principleArgs.principle_id,
    expected_row_id: savedPrinciple.body.result.structuredContent.data.id,
    expected_body: principleArgs.body, expected_change_note: principleArgs.change_note,
    body: `${principleArgs.body}\n\nDo not infer missing preferences.`, change_note: 'Preference clarification',
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
    schema_version: 1, principle_id: principleArgs.principle_id,
    expected_row_id: policySaved.body.result.structuredContent.data.id,
    expected_body: policyPrincipleArgs.body, expected_change_note: policyPrincipleArgs.change_note,
    change_note: 'Reconciliation rule',
    body: `${policyPrincipleArgs.body}\n\n## Reconciliation\nFor this brokerage export, distinguish acquisition and valuation amounts.`,
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
    item.principle_id === operationPrincipleArgs.principle_id && item.body === operationPrincipleArgs.body),
  'Operating principle could not be read back')

  const principleHistory = await call(session.access_token, 'tools/call', {
    name: 'list_principle_changes', arguments: { limit: 2, cursor: null },
  })
  const historyData = principleHistory.body?.result?.structuredContent?.data
  assert(historyData?.items?.length === 2 && historyData?.next_cursor, 'Principle history pagination failed')
  const previousPage = await call(session.access_token, 'tools/call', {
    name: 'list_principle_changes', arguments: { limit: 2, cursor: historyData.next_cursor },
  })
  const firstRow = previousPage.body?.result?.structuredContent?.data?.items?.[0]
  assert(firstRow?.body === principleArgs.body, 'Older principle revision was not found')
  const oneRow = await call(session.access_token, 'tools/call', { name: 'get_principle_row', arguments: { row_id: firstRow.id } })
  assert(oneRow.body?.result?.structuredContent?.data?.body === principleArgs.body, 'Principle row lookup failed')
  const correctedRow = await call(session.access_token, 'tools/call', { name: 'correct_principle_row', arguments: {
    schema_version: 1, row_id: firstRow.id, expected_body: firstRow.body,
    expected_change_note: firstRow.change_note, body: 'Corrected initial rule', change_note: 'Correct typo',
  } })
  assert(correctedRow.body?.result?.structuredContent?.data?.body === 'Corrected initial rule', 'Principle row correction failed')
  const deletedRow = await call(session.access_token, 'tools/call', { name: 'delete_principle_row', arguments: {
    schema_version: 1, row_id: firstRow.id, expected_body: 'Corrected initial rule',
    expected_change_note: 'Correct typo', expected_current_row_id: operationSaved.body.result.structuredContent.data.id,
  } })
  assert(deletedRow.body?.result?.structuredContent?.data?.deleted_row_id === firstRow.id, 'Principle row deletion failed')
  const missingRow = await call(session.access_token, 'tools/call', { name: 'get_principle_row', arguments: { row_id: firstRow.id } })
  assert(missingRow.body?.result?.isError === true, 'Deleted principle row remained readable')

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
  assert(Array.isArray(contextData?.recent_activities), 'Daily context activity list contract failed')
  assert(contextData?.open_tasks?.some((item) => item.id === savedTask.id), 'Daily context unified task contract failed')

  const saved = await call(session.access_token, 'tools/call', {
    name: 'record_manual_activity',
    arguments: {
      schema_version: 1,
      idempotency_key: crypto.randomUUID(),
      title: 'Contract test review', body: 'External research was intentionally omitted. Insufficient data.',
      occurred_at: null, timezone: 'Asia/Seoul', task_id: savedTask.id,
      instrument_id: null, tag_ids: [],
    },
  })
  const savedData = saved.body?.result?.structuredContent?.data
  assert(saved.body?.result?.isError === false && savedData?.id && savedData?.body?.includes('Insufficient data.'), `Activity save contract failed: ${JSON.stringify(saved.body?.result?.structuredContent?.error ?? savedData)}`)
  const revised = await call(session.access_token, 'tools/call', { name: 'update_activity', arguments: {
    schema_version: 1, activity_id: savedData.id, expected_version: savedData.version,
    idempotency_key: crypto.randomUUID(), patch: { body: 'Corrected contract test body' }, tag_ids: [],
  } })
  assert(revised.body?.result?.structuredContent?.data?.body === 'Corrected contract test body', 'Atomic activity detail update failed')

  const briefingPage = await call(session.access_token, 'tools/call', {
    name: 'search_activities', arguments: { query: 'Contract test review', from: null, to: null, record_state: 'done', instrument_id: null, tag_ids: [], tag_match: 'any', limit: 1, cursor: null, timezone: 'Asia/Seoul' },
  })
  assert(briefingPage.body?.result?.structuredContent?.data?.items?.[0]?.activity_id === savedData.id, `Saved activity search contract failed: ${JSON.stringify(briefingPage.body?.result?.structuredContent ?? briefingPage.body)}`)
  const taskDeleteArgs = { schema_version: 1, task_id: savedTask.id, expected_version: savedTask.version, idempotency_key: crypto.randomUUID() }
  const deletedTask = await call(session.access_token, 'tools/call', { name: 'delete_general_task', arguments: taskDeleteArgs })
  assert(deletedTask.body?.result?.structuredContent?.data?.deleted === true, 'Task deletion contract failed')
  const deletedTaskRetry = await call(session.access_token, 'tools/call', { name: 'delete_general_task', arguments: taskDeleteArgs })
  assert(deletedTaskRetry.body?.result?.structuredContent?.data?.deleted === true, 'Task deletion retry failed')
  const retainedActivity = await call(session.access_token, 'tools/call', { name: 'get_activity', arguments: { activity_id: savedData.id } })
  assert(retainedActivity.body?.result?.structuredContent?.data?.task_id == null, 'Task deletion did not detach retained activity')
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
  const noteArgs = { schema_version: 1, entity_type: 'instrument', entity_id: instrument.id, expected_note: null, note: 'Contract note', idempotency_key: noteKey }
  const noteSaved = await call(session.access_token, 'tools/call', { name: 'update_entity_note', arguments: noteArgs })
  assert(noteSaved.body?.result?.structuredContent?.data?.note === 'Contract note', 'Instrument note update contract failed')
  const noteRetry = await call(session.access_token, 'tools/call', { name: 'update_entity_note', arguments: noteArgs })
  assert(noteRetry.body?.result?.structuredContent?.data?.note === 'Contract note', 'Instrument note retry contract failed')
  const correctionPreview = await call(session.access_token, 'tools/call', {
    name: 'preview_holding_reconciliation',
    arguments: { holding_id: holding.id, values: { quantity: '2', avg_price: '100' }, reason: 'Contract test correction', effective_on: new Date().toISOString().slice(0, 10) },
  })
  const correctionVersion = correctionPreview.body?.result?.structuredContent?.data?.holding_state_version
  assert(correctionVersion === holding.state_version, 'Holding correction estimate contract failed')

  await adminWrite(`holdings?id=eq.${holding.id}`, 'PATCH', { quantity: 3, avg_price: 100 })

  const stale = await call(session.access_token, 'tools/call', {
    name: 'reconcile_holding', arguments: { schema_version: 1, holding_id: holding.id, values: { quantity: '2', avg_price: '100' }, reason: 'Contract test correction', effective_on: new Date().toISOString().slice(0, 10), expected_version: correctionVersion, idempotency_key: crypto.randomUUID() },
  })
  assert(stale.body?.result?.structuredContent?.error?.code === 'version_conflict', 'Stale correction estimate returned the wrong recovery contract')
  const freshPreview = await call(session.access_token, 'tools/call', {
    name: 'preview_holding_reconciliation',
    arguments: { holding_id: holding.id, values: { quantity: '2', avg_price: '100' }, reason: 'Contract test correction', effective_on: new Date().toISOString().slice(0, 10) },
  })
  const correctionArgs = { schema_version: 1, holding_id: holding.id, values: { quantity: '2', avg_price: '100' }, reason: 'Contract test correction', effective_on: new Date().toISOString().slice(0, 10), expected_version: freshPreview.body?.result?.structuredContent?.data?.holding_state_version, idempotency_key: crypto.randomUUID() }
  const corrected = await call(session.access_token, 'tools/call', { name: 'reconcile_holding', arguments: correctionArgs })
  const correctionActivityId = corrected.body?.result?.structuredContent?.data?.activity_id
  assert(correctionActivityId, 'Holding correction contract failed')
  const correctionRetry = await call(session.access_token, 'tools/call', { name: 'reconcile_holding', arguments: correctionArgs })
  assert(correctionRetry.body?.result?.structuredContent?.data?.activity_id === correctionActivityId, 'Lost correction response retry did not return the original success')
  const keyConflict = await call(session.access_token, 'tools/call', {
    name: 'reconcile_holding', arguments: { ...correctionArgs, reason: 'Different correction' },
  })
  assert(keyConflict.body?.result?.structuredContent?.error?.code === 'idempotency_conflict', 'Idempotency key conflict returned the wrong recovery contract')

  const newAccount = await call(session.access_token, 'tools/call', { name: 'save_account', arguments: {
    schema_version: 1, account_id: null, name: 'MCP CRUD Account', broker: null, note: null,
  } })
  const newAccountId = newAccount.body?.result?.structuredContent?.data?.[0]?.account_id
  assert(newAccountId, 'OAuth account creation failed')
  const secondAccount = await call(session.access_token, 'tools/call', { name: 'save_account', arguments: {
    schema_version: 1, account_id: null, name: 'MCP CRUD Second Account', broker: null, note: null,
  } })
  const secondAccountId = secondAccount.body?.result?.structuredContent?.data?.[0]?.account_id
  assert(secondAccountId, 'OAuth second account creation failed')
  const savedTag = await call(session.access_token, 'tools/call', { name: 'save_asset_tag', arguments: {
    schema_version: 1, tag_id: null, name: 'MCP CRUD Tag', sort_order: 0,
  } })
  const tagId = savedTag.body?.result?.structuredContent?.data?.[0]?.tag_id
  assert(tagId, 'OAuth asset tag creation failed')
  const savedTargets = await call(session.access_token, 'tools/call', { name: 'save_allocation_targets', arguments: {
    schema_version: 1, targets: [{ tag_id: tagId, target_percentage: 100 }], expected_targets: [],
    change_note: 'Target review', activity_tag_ids: [activityTagId], idempotency_key: crypto.randomUUID(),
  } })
  assert(savedTargets.body?.result?.structuredContent?.data?.configured === true, 'OAuth allocation save failed')
  const allocationActivityId = savedTargets.body?.result?.structuredContent?.data?.activity_id
  const allocationActivity = await call(session.access_token, 'tools/call', { name: 'get_activity', arguments: { activity_id: allocationActivityId } })
  assert(allocationActivityId && allocationActivity.body?.result?.structuredContent?.data?.tags?.some((tag) => tag.id === activityTagId), 'MCP allocation activity tag was not readable')
  const blockedTagDelete = await call(session.access_token, 'tools/call', { name: 'delete_asset_tag', arguments: {
    schema_version: 1, tag_id: tagId,
  } })
  assert(blockedTagDelete.body?.result?.isError === true, 'Positive allocation target did not block tag deletion')
  const clearedTargets = await call(session.access_token, 'tools/call', { name: 'save_allocation_targets', arguments: {
    schema_version: 1, targets: [], expected_targets: [{ tag_id: tagId, target_percentage: 100 }],
  } })
  assert(clearedTargets.body?.result?.structuredContent?.data?.configured === false, 'OAuth allocation clear failed')
  const deletedTag = await call(session.access_token, 'tools/call', { name: 'delete_asset_tag', arguments: {
    schema_version: 1, tag_id: tagId,
  } })
  assert(deletedTag.body?.result?.isError === false, 'OAuth asset tag deletion failed')
  const newInstrument = await call(session.access_token, 'tools/call', { name: 'create_instrument', arguments: {
    schema_version: 1, ticker: 'MCP-CRUD-TEST', display_name: 'MCP CRUD Asset', currency: 'KRW', instrument_type: 'market', tag_id: null, note: null,
  } })
  const newInstrumentId = newInstrument.body?.result?.structuredContent?.data?.[0]?.instrument_id
  assert(newInstrumentId, 'OAuth instrument registration failed')
  const assetArgs = {
    schema_version: 1, instrument_id: newInstrumentId,
    expected: { display_name: 'MCP CRUD Asset', currency: 'KRW', instrument_type: 'market', note: null, tag_id: null },
    instrument: { display_name: 'MCP CRUD Asset', currency: 'KRW', instrument_type: 'market', note: null, tag_id: null },
    holdings: [{ id: null, account_id: newAccountId, quantity: '2', avg_price: '100' }],
    idempotency_key: crypto.randomUUID(), reason: 'Contract test current value', activity_tag_ids: [activityTagId],
  }
  const assetSaved = await call(session.access_token, 'tools/call', { name: 'save_asset_detail', arguments: assetArgs })
  const newHolding = assetSaved.body?.result?.structuredContent?.data?.holdings?.[0]
  assert(newHolding?.id && Number(newHolding.quantity) === 2, 'OAuth asset detail save failed')
  const assetActivityId = assetSaved.body?.result?.structuredContent?.data?.activity_id
  const assetActivity = await call(session.access_token, 'tools/call', { name: 'get_activity', arguments: { activity_id: assetActivityId } })
  assert(assetActivityId && assetActivity.body?.result?.structuredContent?.data?.tags?.some((tag) => tag.id === activityTagId), 'MCP asset activity tag was not readable')
  const assetRetried = await call(session.access_token, 'tools/call', { name: 'save_asset_detail', arguments: assetArgs })
  assert(assetRetried.body?.result?.structuredContent?.data?.holdings?.[0]?.id === newHolding.id, 'Asset detail retry duplicated a holding')
  const deleteHoldingArgs = { schema_version: 1, holding_id: newHolding.id, expected_version: newHolding.state_version, idempotency_key: crypto.randomUUID() }
  const holdingDeleted = await call(session.access_token, 'tools/call', { name: 'delete_holding', arguments: deleteHoldingArgs })
  assert(holdingDeleted.body?.result?.structuredContent?.data?.holding_id === newHolding.id, 'OAuth holding delete failed')
  const holdingDeleteRetry = await call(session.access_token, 'tools/call', { name: 'delete_holding', arguments: deleteHoldingArgs })
  assert(holdingDeleteRetry.body?.result?.structuredContent?.data?.holding_id === newHolding.id, 'Holding delete retry failed')
  const instrumentDeleted = await call(session.access_token, 'tools/call', { name: 'delete_instrument', arguments: { schema_version: 1, instrument_id: newInstrumentId } })
  assert(instrumentDeleted.body?.result?.structuredContent?.data?.[0]?.instrument_id === newInstrumentId, 'OAuth instrument delete failed')
  for (const variant of [
    { type: 'valuation', ticker: 'VALUATION:MCP-CRUD-TEST', holdings: [
      { id: null, account_id: newAccountId, purchase_amount: '100', valuation_amount: '120' },
      { id: null, account_id: secondAccountId, purchase_amount: '200', valuation_amount: '210' },
    ] },
    { type: 'cash', ticker: 'CASH:MCP-CRUD-TEST', holdings: [
      { id: null, account_id: newAccountId, valuation_amount: '500' },
    ] },
  ]) {
    const created = await call(session.access_token, 'tools/call', { name: 'create_instrument', arguments: {
      schema_version: 1, ticker: variant.ticker, display_name: `MCP ${variant.type}`, currency: 'KRW', instrument_type: variant.type, tag_id: null, note: null,
    } })
    const instrumentId = created.body?.result?.structuredContent?.data?.[0]?.instrument_id
    assert(instrumentId, `OAuth ${variant.type} instrument creation failed`)
    const currentFields = { display_name: `MCP ${variant.type}`, currency: 'KRW', instrument_type: variant.type, note: null, tag_id: null }
    const saved = await call(session.access_token, 'tools/call', { name: 'save_asset_detail', arguments: {
      schema_version: 1, instrument_id: instrumentId, expected: currentFields, instrument: currentFields,
      holdings: variant.holdings, idempotency_key: crypto.randomUUID(), reason: `Contract ${variant.type} balance`,
    } })
    const rows = saved.body?.result?.structuredContent?.data?.holdings
    assert(rows?.length === variant.holdings.length, `OAuth ${variant.type} holding save failed`)
    const httpState = await fetch(`${baseUrl}/rest/v1/rpc/app_get_portfolio_state`, {
      method: 'POST', headers: { ...commonHeaders, Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ input_owner_user_id: null }),
    })
    const httpData = await httpState.json()
    assert(httpState.ok && httpData.holdings.filter((item) => item.ticker === variant.ticker).length === variant.holdings.length,
      `HTTP could not read OAuth ${variant.type} holdings`)
    for (const row of rows) {
      const deleted = await call(session.access_token, 'tools/call', { name: 'delete_holding', arguments: {
        schema_version: 1, holding_id: row.id, expected_version: row.state_version, idempotency_key: crypto.randomUUID(),
      } })
      assert(deleted.body?.result?.isError === false, `OAuth ${variant.type} holding deletion failed`)
    }
    const deletedInstrument = await call(session.access_token, 'tools/call', { name: 'delete_instrument', arguments: { schema_version: 1, instrument_id: instrumentId } })
    assert(deletedInstrument.body?.result?.isError === false, `OAuth ${variant.type} instrument deletion failed`)
  }
  const accountDeleted = await call(session.access_token, 'tools/call', { name: 'delete_account', arguments: { schema_version: 1, account_id: newAccountId } })
  assert(accountDeleted.body?.result?.structuredContent?.data?.[0]?.account_id === newAccountId, 'OAuth account delete failed')
  const secondAccountDeleted = await call(session.access_token, 'tools/call', { name: 'delete_account', arguments: { schema_version: 1, account_id: secondAccountId } })
  assert(secondAccountDeleted.body?.result?.isError === false, 'OAuth second account delete failed')

  const invalid = await call(session.access_token, 'tools/call', { name: 'log_completed_trade', arguments: {} })
  const toolError = invalid.body?.result?.structuredContent?.error
  assert(invalid.response.ok && invalid.body?.result?.isError === true, 'Invalid tool input did not return an MCP tool error')
  assert(toolError?.code === 'validation_error' && toolError?.retryable === false, 'Invalid tool input returned the wrong recovery contract')
  assert(typeof toolError?.request_id === 'string' && toolError.request_id.length > 20, 'Tool error did not include a request ID')

  console.log('OAuth MCP initialize/discovery/authentication, sharing/friend reset boundaries, retired token issuance, workflow guides, product feedback, policy save/read, review activity save/read, cursor pages, financial retry/conflict recovery, auth denial, and validation contracts passed.')
} finally {
  for (const userId of userIds) {
    await fetch(`${baseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    })
  }
}
