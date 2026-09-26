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

export async function clearAllocationTargets(supabase, expectedTargets) {
  const { data, error } = await supabase.rpc('app_clear_allocation_targets', {
    input_expected_targets: expectedTargets,
  })
  if (error) throw error
  return { ...createEmptyStrategyState(), ...(data ?? {}) }
}

export async function fetchPrinciples(supabase, { onDate = null, includeEnded = false, ownerUserId = null } = {}) {
  const { data, error } = await supabase.rpc('app_list_principles', {
    input_on: onDate,
    input_timezone: DEFAULT_BUSINESS_TIMEZONE,
    input_include_ended: includeEnded,
    input_owner_user_id: ownerUserId,
  })
  if (error) throw error
  return data?.items ?? []
}

export async function fetchPrincipleChanges(supabase, { cursor = null, limit = 20, ownerUserId = null } = {}) {
  const { data, error } = await supabase.rpc('app_list_principle_changes', {
    input_limit: limit,
    input_cursor: cursor,
    input_owner_user_id: ownerUserId,
  })
  if (error) throw error
  return { items: data?.items ?? [], nextCursor: data?.next_cursor ?? null }
}

export async function savePrinciple(supabase, { principleId, expectedRowId = null, expectedBody = null, expectedChangeNote = null, body, changeNote = null }) {
  const { data, error } = await supabase.rpc('app_save_principle_checked', {
    input_principle_id: principleId,
    input_expected_row_id: expectedRowId,
    input_expected_body: expectedBody,
    input_expected_change_note: expectedChangeNote,
    input_body: body,
    input_change_note: changeNote?.trim() || null,
  })
  if (error) throw error
  return data
}

export async function correctPrincipleRow(supabase, { rowId, expectedBody, expectedChangeNote, body, changeNote }) {
  const { data, error } = await supabase.rpc('app_correct_principle_row', {
    input_row_id: rowId,
    input_expected_body: expectedBody,
    input_expected_change_note: expectedChangeNote,
    input_body: body,
    input_change_note: changeNote?.trim() || null,
  })
  if (error) throw error
  return data
}

export async function deletePrincipleRow(supabase, { rowId, expectedBody, expectedChangeNote, expectedCurrentRowId }) {
  const { data, error } = await supabase.rpc('app_delete_principle_row', {
    input_row_id: rowId,
    input_expected_body: expectedBody,
    input_expected_change_note: expectedChangeNote,
    input_expected_current_row_id: expectedCurrentRowId,
  })
  if (error) throw error
  return data
}
