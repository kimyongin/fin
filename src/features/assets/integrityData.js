export async function previewReconciliation(supabase, payload) {
  const { data, error } = await supabase.rpc('app_preview_holding_reconciliation', {
    input_holding_id: Number(payload.holdingId), input_values: payload.values,
    input_reason: payload.reason.trim(), input_effective_on: payload.effectiveOn,
    input_confirmed_fields: payload.confirmedFields,
  })
  if (error) throw error
  return data
}
export async function confirmReconciliation(supabase, draft, preview, idempotencyKey) {
  const { data, error } = await supabase.rpc('app_apply_holding_correction', {
    input_holding_id: Number(draft.holdingId), input_values: draft.values,
    input_reason: draft.reason.trim(), input_effective_on: draft.effectiveOn,
    input_confirmed_fields: draft.confirmedFields,
    input_expected_version: preview.holding_state_version,
    input_idempotency_key: idempotencyKey, input_authored_via: 'app',
  })
  if (error) throw error
  return data
}
export async function fetchHoldingIntegrity(supabase, holdingId) {
  const { data, error } = await supabase.rpc('app_get_holding_integrity', { input_holding_id: Number(holdingId) })
  if (error) throw error
  return data
}
export async function verifyHolding(supabase, payload, idempotencyKey) {
  const { data, error } = await supabase.rpc('app_verify_holding', {
    input_holding_id: Number(payload.holdingId), input_expected_version: Number(payload.expectedVersion),
    input_fields: payload.fields, input_verified_on: payload.verifiedOn, input_note: payload.note.trim() || null,
    input_idempotency_key: idempotencyKey, input_source: 'app',
  })
  if (error) throw error
  return data
}
