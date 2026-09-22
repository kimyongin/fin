async function rpc(supabase, name, params) {
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw error
  return data
}

export async function fetchInvestmentDecisions(supabase, { limit = 20, before = null, ownerUserId = null } = {}) {
  const data = await rpc(supabase, ownerUserId ? 'app_list_investment_decisions_for_owner' : 'app_list_investment_decisions', {
    ...(ownerUserId ? { input_owner_user_id: ownerUserId } : {}),
    input_limit: limit,
    input_before: before,
  })
  return Array.isArray(data) ? data : []
}

export async function fetchInvestmentDecision(supabase, decisionId, ownerUserId = null) {
  const data = await rpc(supabase, ownerUserId ? 'app_get_investment_decision_for_owner' : 'app_get_investment_decision', {
    ...(ownerUserId ? { input_owner_user_id: ownerUserId } : {}),
    input_decision_id: decisionId,
  })
  if (!data) throw new Error('판단 기록을 찾을 수 없거나 접근할 수 없습니다.')
  return data
}

export async function fetchPortfolioTasks(supabase, { state = null, limit = 20, before = null, ownerUserId = null } = {}) {
  const data = await rpc(supabase, ownerUserId ? 'app_list_portfolio_tasks_for_owner' : 'app_list_portfolio_tasks', {
    ...(ownerUserId ? { input_owner_user_id: ownerUserId } : {}),
    input_state: state,
    input_limit: limit,
    input_before: before,
  })
  return Array.isArray(data) ? data : []
}

export async function fetchPortfolioTask(supabase, taskId, ownerUserId = null) {
  const data = await rpc(supabase, ownerUserId ? 'app_get_portfolio_task_for_owner' : 'app_get_portfolio_task', {
    ...(ownerUserId ? { input_owner_user_id: ownerUserId } : {}),
    input_task_id: taskId,
  })
  if (!data) throw new Error('할 일을 찾을 수 없거나 접근할 수 없습니다.')
  return data
}

function normalizePage(data) {
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.next_cursor ?? null,
  }
}

export async function fetchInvestmentDecisionPage(supabase, {
  cursor = null,
  filter = 'current',
  limit = 20,
  ownerUserId = null,
} = {}) {
  return normalizePage(await rpc(supabase, 'app_list_investment_decision_page', {
    input_cursor: cursor,
    input_filter: filter,
    input_limit: limit,
    input_owner_user_id: ownerUserId,
  }))
}

export async function fetchPortfolioTaskPage(supabase, {
  cursor = null,
  filter = 'active',
  limit = 20,
  ownerUserId = null,
} = {}) {
  return normalizePage(await rpc(supabase, 'app_list_portfolio_task_page', {
    input_cursor: cursor,
    input_filter: filter,
    input_limit: limit,
    input_owner_user_id: ownerUserId,
  }))
}

export async function fetchTodoBundlePage(supabase, { cursor = null, filter = 'active', limit = 20 } = {}) {
  return normalizePage(await rpc(supabase, 'app_list_todo_bundles', {
    input_filter: filter,
    input_limit: limit,
    input_cursor: cursor,
  }))
}

export async function fetchTodoBundle(supabase, bundleId) {
  const data = await rpc(supabase, 'app_get_todo_bundle', { input_bundle_id: bundleId })
  if (!data) throw new Error('ToDo 묶음을 찾을 수 없거나 접근할 수 없습니다.')
  return data
}

export async function fetchLinkedTodoTaskIds(supabase) {
  const data = await rpc(supabase, 'app_list_todo_linked_task_ids')
  return Array.isArray(data) ? data : []
}

export async function saveTodoBundle(supabase, bundle) {
  return rpc(supabase, 'app_save_todo_bundle', {
    input_bundle_id: bundle.id ?? null,
    input_expected_version: bundle.expectedVersion ?? null,
    input_idempotency_key: bundle.idempotencyKey,
    input_title: bundle.title.trim(),
    input_summary: bundle.summary?.trim() || null,
    input_tags: bundle.tags ?? [],
    input_items: bundle.items ?? [],
    input_remove_item_ids: bundle.removeItemIds ?? [],
    input_rule_ids: bundle.ruleIds ?? null,
    input_decision_ids: bundle.decisionIds ?? null,
    input_verification_ids: bundle.verificationIds ?? null,
    input_authored_via: 'app',
  })
}
