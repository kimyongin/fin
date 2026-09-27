import { businessDate } from '../../lib/businessDate'

async function rpc(supabase, name, params) {
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw error
  return data
}

export async function fetchPortfolioTask(supabase, taskId, ownerUserId = null) {
  const data = await rpc(supabase, ownerUserId ? 'app_get_general_task_for_owner' : 'app_get_general_task', {
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

export async function fetchActivity(supabase, activityId, ownerUserId = null) {
  const data = await rpc(supabase, 'app_get_activity_market_ticker', {
    input_activity_id: activityId,
    input_owner_user_id: ownerUserId,
  })
  if (!data) throw new Error('활동 기록을 찾을 수 없거나 접근할 수 없습니다.')
  return data
}

export async function fetchActivityTags(supabase, query = null) {
  const data = await rpc(supabase, 'app_list_activity_tags', { input_query: query })
  return Array.isArray(data) ? data : []
}

export async function saveActivityTag(supabase, tag) {
  return rpc(supabase, 'app_save_activity_tag', {
    input_tag_id: tag.id ?? null,
    input_expected_version: tag.version ?? null,
    input_idempotency_key: tag.idempotencyKey,
    input_name: tag.name.trim(),
  })
}

export async function deleteActivityTag(supabase, tag) {
  return rpc(supabase, 'app_delete_activity_tag', {
    input_tag_id: tag.id,
    input_expected_version: tag.version,
    input_idempotency_key: tag.idempotencyKey,
  })
}

export async function setActivityTags(supabase, activity, tagIds) {
  return rpc(supabase, 'app_set_activity_tags', {
    input_activity_id: activity.id,
    input_expected_version: activity.version,
    input_tag_ids: tagIds,
    input_idempotency_key: crypto.randomUUID(),
  })
}

export async function setGeneralTaskTags(supabase, task, tagIds) {
  return rpc(supabase, 'app_set_general_task_tags', {
    input_task_id: task.id,
    input_expected_version: task.version,
    input_tag_ids: tagIds,
    input_idempotency_key: crypto.randomUUID(),
  })
}

export async function searchActivities(supabase, {
  cursor = null,
  from = null,
  instrumentTicker = null,
  limit = 30,
  ownerUserId = null,
  query = null,
  state = 'all',
  tagIds = [],
  tagMatch = 'any',
  timezone = 'Asia/Seoul',
  to = null,
} = {}) {
  const body = {
    owner_user_id: ownerUserId,
    query: query?.trim() || null,
    from: from || null,
    to: to || null,
    record_state: state,
    instrument_ticker: instrumentTicker,
    tag_ids: tagIds,
    tag_match: tagMatch,
    limit,
    cursor,
    timezone,
  }
  if (supabase.functions?.invoke) {
    const { data, error } = await supabase.functions.invoke('activity-search', { body })
    if (!error && data) return {
      ...normalizePage(data),
      semanticStatus: data.semantic_status ?? 'unavailable',
      searchMode: data.search_mode ?? (body.query
        ? (['active', 'indexing'].includes(data.semantic_status) ? 'hybrid' : 'keyword') : 'browse'),
      fallbackReason: data.fallback_reason ?? null,
      embeddingModel: data.embedding_model ?? null,
      semanticThreshold: data.semantic_threshold ?? null,
      indexStatus: data.index_status ?? 'unknown',
    }
  }
  if (cursor?.mode === 'hybrid') throw new Error('유사도 검색의 다음 페이지를 불러오지 못했습니다. 다시 시도하거나 새로 검색해 주세요.')
  const data = await rpc(supabase, 'app_search_activities_ticker', {
    input_owner_user_id: ownerUserId,
    input_query: query?.trim() || null,
    input_from: from || null,
    input_to: to || null,
    input_record_state: state,
    input_instrument_ticker: instrumentTicker,
    input_tag_ids: tagIds,
    input_tag_match: tagMatch,
    input_limit: limit,
    input_cursor: cursor,
    input_timezone: timezone,
  })
  return {
    ...normalizePage(data),
    items: (Array.isArray(data?.items) ? data.items : []).map((item) => ({
      ...item, matched_by: body.query ? ['keyword'] : [], semantic_score: null,
    })),
    semanticStatus: body.query ? 'unavailable' : 'not_requested',
    searchMode: body.query ? 'keyword' : 'browse',
    fallbackReason: body.query ? 'search_service_unavailable' : null,
    embeddingModel: null, semanticThreshold: null, indexStatus: 'not_checked',
  }
}

export async function saveGeneralTask(supabase, task) {
  const creating = task.id == null
  return rpc(supabase, creating ? 'app_create_general_task_with_tags' : 'app_save_general_task_detail', {
    ...(creating ? { input_tag_ids: task.tagIds ?? [] } : { input_task_id: task.id, input_expected_version: task.expectedVersion ?? null, input_tag_ids: task.tagIds ?? [] }),
    input_idempotency_key: task.idempotencyKey,
    input_payload: {
      title: task.title.trim(),
      subject: task.subject ?? { kind: 'portfolio' },
      due_date: task.dueDate || null,
      timezone: task.timezone ?? 'Asia/Seoul',
      trigger_text: task.triggerText?.trim() || null,
      recurrence_kind: task.recurrenceKind ?? 'none',
      recurrence_start_on: task.recurrenceKind !== 'none' ? (task.recurrenceStartOn || task.dueDate || businessDate(undefined, task.timezone ?? 'Asia/Seoul')) : null,
      recurrence_weekdays: task.recurrenceKind === 'weekly' ? (task.recurrenceWeekdays ?? []) : [],
      recurrence_time: task.recurrenceTime || null,
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

export async function deleteGeneralTask(supabase, task, idempotencyKey) {
  return rpc(supabase, 'app_delete_general_task', {
    input_task_id: task.id,
    input_expected_version: task.version,
    input_idempotency_key: idempotencyKey,
  })
}

export async function recordManualActivity(supabase, activity) {
  return rpc(supabase, 'app_create_activity_market_ticker_with_tags', {
    input_idempotency_key: activity.idempotencyKey,
    input_tag_ids: activity.tagIds ?? [],
    input_payload: {
      title: activity.title.trim(),
      body: activity.body?.trim() || null,
      occurred_at: activity.occurredAt || null,
      timezone: activity.timezone ?? 'Asia/Seoul',
      task_id: activity.taskId ?? null,
      instrument_ticker: activity.instrumentTicker ?? null,
      authored_via: 'app',
    },
  })
}

export async function updateActivity(supabase, activity, patch) {
  return rpc(supabase, 'app_save_activity_market_ticker_detail', {
    input_activity_id: activity.id,
    input_expected_version: activity.version,
    input_idempotency_key: crypto.randomUUID(),
    input_patch: patch,
    input_tag_ids: null,
    input_authored_via: 'app',
  })
}

export async function saveActivityDetail(supabase, activity, patch, tagIds, idempotencyKey) {
  return rpc(supabase, 'app_save_activity_market_ticker_detail', {
    input_activity_id: activity.id,
    input_expected_version: activity.version,
    input_idempotency_key: idempotencyKey,
    input_patch: patch,
    input_tag_ids: tagIds,
    input_authored_via: 'app',
  })
}

export async function deleteActivity(supabase, activity) {
  return rpc(supabase, 'app_delete_activity', {
    input_activity_id: activity.id,
    input_expected_version: activity.version,
  })
}
