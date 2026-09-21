export async function fetchDailyBriefings(supabase, { limit = 20, before = null, ownerUserId = null } = {}) {
  const { data, error } = await supabase.rpc(ownerUserId ? 'app_list_daily_briefings_for_owner' : 'app_list_daily_briefings', {
    ...(ownerUserId ? { input_owner_user_id: ownerUserId } : {}),
    input_limit: limit,
    input_before: before,
  })
  if (error) throw error
  return Array.isArray(data) ? data : []
}

export async function fetchDailyBriefing(supabase, briefingId, ownerUserId = null) {
  const { data, error } = await supabase.rpc(ownerUserId ? 'app_get_daily_briefing_for_owner' : 'app_get_daily_briefing', {
    ...(ownerUserId ? { input_owner_user_id: ownerUserId } : {}),
    input_briefing_id: briefingId,
  })
  if (error) throw error
  if (!data) throw new Error('브리핑을 찾을 수 없거나 접근할 수 없습니다.')
  return data
}

export async function fetchDailyBriefingPage(supabase, { cursor = null, limit = 20, ownerUserId = null } = {}) {
  const { data, error } = await supabase.rpc('app_list_daily_briefing_page', {
    input_cursor: cursor,
    input_limit: limit,
    input_owner_user_id: ownerUserId,
  })
  if (error) throw error
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.next_cursor ?? null,
  }
}

export async function fetchBriefingRelatedTasks(supabase, briefingId, ownerUserId = null) {
  const { data, error } = await supabase.rpc('app_list_briefing_related_tasks', {
    input_briefing_id: briefingId,
    input_owner_user_id: ownerUserId,
    input_limit: 3,
  })
  if (error) throw error
  if (data?.status === 'forbidden') throw new Error('연결된 과제의 공유 권한이 없습니다.')
  if (data?.status === 'not_found') throw new Error('브리핑을 찾을 수 없거나 접근할 수 없습니다.')
  return Array.isArray(data?.items) ? data.items : []
}
