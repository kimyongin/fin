export async function fetchDailyBriefings(supabase, { limit = 20, before = null } = {}) {
  const { data, error } = await supabase.rpc('app_list_daily_briefings', {
    input_limit: limit,
    input_before: before,
  })
  if (error) throw error
  return Array.isArray(data) ? data : []
}

export async function fetchDailyBriefing(supabase, briefingId) {
  const { data, error } = await supabase.rpc('app_get_daily_briefing', {
    input_briefing_id: briefingId,
  })
  if (error) throw error
  if (!data) throw new Error('브리핑을 찾을 수 없거나 접근할 수 없습니다.')
  return data
}
