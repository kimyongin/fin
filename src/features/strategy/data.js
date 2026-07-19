export function createEmptyStrategyState() {
  return { strategy: null, buckets: [] }
}

export async function fetchStrategyState(supabase, ownerUserId = null) {
  const { data, error } = await supabase.rpc('app_get_strategy_state', {
    input_owner_user_id: ownerUserId,
  })
  if (error) throw error
  return { ...createEmptyStrategyState(), ...(data ?? {}) }
}

export async function saveStrategy(supabase, draft) {
  const { data, error } = await supabase.rpc('app_save_strategy', {
    input_name: draft.name.trim(),
    input_monthly_contribution: Number(draft.monthly_contribution) || 0,
    input_review_day: Number(draft.review_day) || 1,
    input_drift_threshold: Number(draft.drift_threshold) || 5,
    input_buckets: draft.buckets.map((bucket, index) => ({
      name: bucket.name.trim(),
      target_percentage: Number(bucket.mode_targets?.neutral ?? bucket.target_percentage) || 0,
      mode_targets: {
        growth: Number(bucket.mode_targets?.growth ?? bucket.target_percentage) || 0,
        neutral: Number(bucket.mode_targets?.neutral ?? bucket.target_percentage) || 0,
        defensive: Number(bucket.mode_targets?.defensive ?? bucket.target_percentage) || 0,
      },
      sort_order: index,
      tag_ids: bucket.tag_ids.map(Number),
    })),
    input_mode: draft.mode,
    input_mode_reason: draft.mode_reason.trim(),
    input_principles: draft.principles,
  })
  if (error) throw error
  return { ...createEmptyStrategyState(), ...(data ?? {}) }
}
