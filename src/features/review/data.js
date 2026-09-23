export async function fetchReviewActivities(supabase, { cursor = null, limit = 20, ownerUserId = null } = {}) {
  const { data, error } = await supabase.rpc('app_list_narrative_activities', {
    input_kind: 'review',
    input_owner_user_id: ownerUserId,
    input_limit: limit,
    input_cursor: cursor,
  })
  if (error) throw error
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.next_cursor ?? null,
  }
}
