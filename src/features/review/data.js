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
