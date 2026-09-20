export async function previewReconciliation(supabase, payload) {
  const { data, error } = await supabase.rpc('app_preview_holding_reconciliation', {
    input_holding_id: Number(payload.holdingId), input_values: payload.values,
    input_reason: payload.reason.trim(), input_effective_on: payload.effectiveOn,
    input_confirmed_fields: payload.confirmedFields,
  })
  if (error) throw error
  return data
}
export async function confirmReconciliation(supabase, previewId) {
  const { data, error } = await supabase.rpc('app_reconcile_holding', { input_preview_id: previewId, input_idempotency_key: crypto.randomUUID(), input_authored_via: 'app' })
  if (error) throw error
  return data
}
export async function verifyHolding(supabase, payload) {
  const { data, error } = await supabase.rpc('app_verify_holding', {
    input_holding_id: Number(payload.holdingId), input_expected_version: Number(payload.expectedVersion),
    input_fields: payload.fields, input_verified_on: payload.verifiedOn, input_note: payload.note.trim() || null,
    input_idempotency_key: crypto.randomUUID(), input_source: 'app',
  })
  if (error) throw error
  return data
}
