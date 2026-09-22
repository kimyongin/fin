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

export async function fetchGeneralTaskPage(supabase, { cursor = null, filter = 'active', limit = 20 } = {}) {
  return normalizePage(await rpc(supabase, 'app_list_general_task_page', {
    input_filter: filter,
    input_limit: limit,
    input_cursor: cursor,
  }))
}

export async function fetchActionTimeline(supabase, {
  cursor = null,
  filter = 'all',
  from = null,
  to = null,
  limit = 30,
  ownerUserId = null,
  timezone = 'Asia/Seoul',
} = {}) {
  const data = await rpc(supabase, 'app_list_action_timeline', {
    input_owner_user_id: ownerUserId,
    input_filter: filter,
    input_from: from,
    input_to: to,
    input_limit: limit,
    input_cursor: cursor,
    input_timezone: timezone,
  })
  return {
    pending: Array.isArray(data?.pending) ? data.pending : [],
    days: Array.isArray(data?.days) ? data.days : [],
    nextCursor: data?.next_cursor ?? null,
  }
}

export async function fetchActivityReports(supabase, { cursor = null, limit = 10 } = {}) {
  return normalizePage(await rpc(supabase, 'app_list_activity_reports', {
    input_limit: limit,
    input_cursor: cursor,
  }))
}

export async function fetchActivity(supabase, activityId, ownerUserId = null) {
  const data = await rpc(supabase, 'app_get_activity', {
    input_activity_id: activityId,
    input_owner_user_id: ownerUserId,
  })
  if (!data) throw new Error('활동 기록을 찾을 수 없거나 접근할 수 없습니다.')
  return data
}

export async function fetchGeneralTask(supabase, taskId) {
  const data = await rpc(supabase, 'app_get_general_task', { input_task_id: taskId })
  if (!data) throw new Error('일반 할 일을 찾을 수 없거나 접근할 수 없습니다.')
  return data
}

export async function saveGeneralTask(supabase, task) {
  return rpc(supabase, 'app_save_general_task', {
    input_task_id: task.id ?? null,
    input_expected_version: task.expectedVersion ?? null,
    input_idempotency_key: task.idempotencyKey,
    input_payload: {
      title: task.title.trim(),
      subject: task.subject ?? { kind: 'portfolio' },
      due_date: task.dueDate || null,
      timezone: task.timezone ?? 'Asia/Seoul',
      trigger_text: task.triggerText?.trim() || null,
      change_reason: task.changeReason?.trim() || null,
      recurrence_kind: task.recurrenceKind ?? 'none',
      recurrence_start_on: task.recurrenceKind === 'daily' ? (task.recurrenceStartOn || task.dueDate || new Date().toLocaleDateString('en-CA')) : null,
      authored_via: 'app',
    },
  })
}

export async function transitionGeneralTask(supabase, task, action, { result = null, reason = null, occurrenceOn = null } = {}) {
  return rpc(supabase, 'app_transition_general_task', {
    input_task_id: task.id,
    input_expected_version: task.version,
    input_action: action,
    input_result: result?.trim() || null,
    input_reason: reason?.trim() || null,
    input_occurrence_on: occurrenceOn,
    input_idempotency_key: crypto.randomUUID(),
    input_authored_via: 'app',
  })
}

export async function recordManualActivity(supabase, activity) {
  return rpc(supabase, 'app_create_activity', {
    input_idempotency_key: activity.idempotencyKey,
    input_payload: {
      title: activity.title.trim(),
      note: activity.note?.trim() || null,
      result: activity.result?.trim() || null,
      conclusion: activity.conclusion?.trim() || null,
      occurred_at: activity.occurredAt || null,
      timezone: activity.timezone ?? 'Asia/Seoul',
      instrument_id: activity.instrumentId ?? null,
      account_id: activity.accountId ?? null,
      authored_via: 'app',
    },
  })
}

export async function updateActivity(supabase, activity, patch) {
  return rpc(supabase, 'app_update_activity', {
    input_activity_id: activity.id,
    input_expected_version: activity.version,
    input_idempotency_key: crypto.randomUUID(),
    input_patch: patch,
    input_authored_via: 'app',
  })
}

export async function createActivityFollowUp(supabase, activityId, task) {
  return rpc(supabase, 'app_create_activity_follow_up', {
    input_origin_event_id: activityId,
    input_idempotency_key: task.idempotencyKey,
    input_payload: {
      title: task.title.trim(),
      subject: task.subject ?? { kind: 'portfolio' },
      due_date: task.dueDate || null,
      timezone: task.timezone ?? 'Asia/Seoul',
      trigger_text: task.triggerText?.trim() || null,
      recurrence_kind: task.recurrenceKind ?? 'none',
      recurrence_start_on: task.recurrenceKind === 'daily' ? task.recurrenceStartOn : null,
      authored_via: 'app',
    },
  })
}
