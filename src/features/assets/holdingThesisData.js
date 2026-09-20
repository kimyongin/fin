export async function fetchHoldingTheses(supabase) {
  const { data, error } = await supabase.rpc('app_list_holding_theses')
  if (error) throw error
  return Array.isArray(data) ? data : []
}

export async function saveHoldingThesis(supabase, {
  accountId,
  changeReason,
  expectedVersion,
  idempotencyKey,
  instrumentId,
  patch,
}) {
  const { data, error } = await supabase.rpc('app_save_holding_thesis', {
    input_instrument_id: Number(instrumentId),
    input_account_id: accountId == null ? null : Number(accountId),
    input_expected_version: expectedVersion ?? null,
    input_idempotency_key: idempotencyKey,
    input_patch: patch,
    input_change_reason: changeReason.trim(),
    input_authored_via: 'app',
  })
  if (error) throw error
  return data?.thesis ?? null
}
