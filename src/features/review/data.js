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
  // Shared decision DTOs intentionally omit their source briefing. Do not infer a
  // relationship for viewers when the owner has not explicitly exposed it.
  if (ownerUserId) return []

  const { data: decisions, error } = await supabase.rpc('app_list_investment_decisions', {
    input_limit: 50,
    input_before: null,
  })
  if (error) throw error

  const matching = (Array.isArray(decisions) ? decisions : [])
    .filter((decision) => decision.source_briefing_id === briefingId)
    .slice(0, 10)
  const details = await Promise.all(matching.map(async (decision) => {
    const { data, error: detailError } = await supabase.rpc('app_get_investment_decision', {
      input_decision_id: decision.id,
    })
    if (detailError) throw detailError
    return data
  }))

  return [...new Map(details
    .flatMap((decision) => decision?.tasks ?? [])
    .map((task) => [task.id, task])).values()].slice(0, 3)
}
