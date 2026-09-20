async function rpc(supabase, name, params) {
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw error
  return data
}

export async function fetchInvestmentDecisions(supabase, { limit = 20, before = null } = {}) {
  const data = await rpc(supabase, 'app_list_investment_decisions', {
    input_limit: limit,
    input_before: before,
  })
  return Array.isArray(data) ? data : []
}

export async function fetchInvestmentDecision(supabase, decisionId) {
  const data = await rpc(supabase, 'app_get_investment_decision', {
    input_decision_id: decisionId,
  })
  if (!data) throw new Error('판단 기록을 찾을 수 없거나 접근할 수 없습니다.')
  return data
}

export async function fetchPortfolioTasks(supabase, { state = null, limit = 20, before = null } = {}) {
  const data = await rpc(supabase, 'app_list_portfolio_tasks', {
    input_state: state,
    input_limit: limit,
    input_before: before,
  })
  return Array.isArray(data) ? data : []
}

export async function fetchPortfolioTask(supabase, taskId) {
  const data = await rpc(supabase, 'app_get_portfolio_task', {
    input_task_id: taskId,
  })
  if (!data) throw new Error('할 일을 찾을 수 없거나 접근할 수 없습니다.')
  return data
}
