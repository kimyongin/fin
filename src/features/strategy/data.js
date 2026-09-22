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

export async function fetchInvestmentPolicy(supabase) {
  const { data, error } = await supabase.rpc('app_get_investment_policy')
  if (error) throw error
  return data?.profile ?? null
}

export async function fetchPrinciples(supabase, { onDate = null, includeEnded = false } = {}) {
  const { data, error } = await supabase.rpc('app_list_principles', {
    input_on: onDate,
    input_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul',
    input_include_ended: includeEnded,
  })
  if (error) throw error
  return data?.items ?? []
}

export async function savePrinciple(supabase, { principleId, expectedRowId = null, kind, body, scope = null, end = false }) {
  const { data, error } = await supabase.rpc('app_save_principle', {
    input_principle_id: principleId,
    input_expected_row_id: expectedRowId,
    input_kind: kind,
    input_body: body.trim(),
    input_scope: scope?.trim() || null,
    input_end: end,
  })
  if (error) throw error
  return data
}

export async function saveInvestmentPolicy(supabase, {
  expectedVersion,
  idempotencyKey,
  patch,
  changeReason,
}) {
  const { data, error } = await supabase.rpc('app_save_investment_policy', {
    input_expected_version: expectedVersion,
    input_idempotency_key: idempotencyKey,
    input_patch: patch,
    input_change_reason: changeReason,
    input_authored_via: 'app',
  })
  if (error) throw error
  return data?.profile ?? null
}

export async function fetchOperatingRules(supabase, workflowKey = null, includeArchived = false) {
  const { data, error } = await supabase.rpc('app_list_operating_rules', {
    input_workflow_key: workflowKey,
    input_include_archived: includeArchived,
  })
  if (error) throw error
  return data?.rules ?? []
}

export async function saveOperatingRule(supabase, rule) {
  const { data, error } = await supabase.rpc('app_save_operating_rule', {
    input_rule_id: rule.id ?? null,
    input_expected_version: rule.expectedVersion ?? null,
    input_idempotency_key: rule.idempotencyKey,
    input_title: rule.title.trim(),
    input_workflow_key: rule.workflowKey,
    input_applicability: rule.applicability.trim(),
    input_body: rule.body.trim(),
    input_change_reason: rule.changeReason.trim(),
    input_authored_via: 'app',
  })
  if (error) throw error
  return data?.rule
}

export async function archiveOperatingRule(supabase, rule) {
  const { data, error } = await supabase.rpc('app_archive_operating_rule', {
    input_rule_id: rule.id,
    input_expected_version: rule.expectedVersion,
    input_idempotency_key: rule.idempotencyKey,
    input_reason: rule.reason.trim(),
    input_authored_via: 'app',
  })
  if (error) throw error
  return data?.rule
}
