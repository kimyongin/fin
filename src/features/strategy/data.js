import { DEFAULT_BUSINESS_TIMEZONE } from '../../lib/businessDate'

export function createEmptyStrategyState() {
  return { configured: false, targets: [] }
}

export async function fetchStrategyState(supabase, ownerUserId = null) {
  const { data, error } = await supabase.rpc('app_get_strategy_state', {
    input_owner_user_id: ownerUserId,
  })
  if (error) throw error
  return { ...createEmptyStrategyState(), ...(data ?? {}) }
}

export async function saveAllocationTargets(supabase, { targets, expectedTargets }) {
  const { data, error } = await supabase.rpc('app_save_allocation_targets', {
    input_targets: targets,
    input_expected_targets: expectedTargets,
  })
  if (error) throw error
  return { ...createEmptyStrategyState(), ...(data ?? {}) }
}

export async function fetchPrinciples(supabase, { onDate = null, includeEnded = false } = {}) {
  const { data, error } = await supabase.rpc('app_list_principles', {
    input_on: onDate,
    input_timezone: DEFAULT_BUSINESS_TIMEZONE,
    input_include_ended: includeEnded,
  })
  if (error) throw error
  return data?.items ?? []
}

export async function fetchPrincipleChanges(supabase, { cursor = null, limit = 20 } = {}) {
  const { data, error } = await supabase.rpc('app_list_principle_changes', {
    input_limit: limit,
    input_cursor: cursor,
  })
  if (error) throw error
  return { items: data?.items ?? [], nextCursor: data?.next_cursor ?? null }
}

export async function savePrinciple(supabase, { principleId, expectedRowId = null, body, changeNote = null, end = false }) {
  const { data, error } = await supabase.rpc('app_save_principle', {
    input_principle_id: principleId,
    input_expected_row_id: expectedRowId,
    input_body: body,
    input_change_note: changeNote?.trim() || null,
    input_end: end,
  })
  if (error) throw error
  return data
}
