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
