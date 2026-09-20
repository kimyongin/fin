export async function previewTrade(supabase, draft) {
  const { data, error } = await supabase.rpc('app_preview_trade_entry', {
    input_account_id: Number(draft.accountId),
    input_instrument_id: Number(draft.instrumentId),
    input_side: draft.side,
    input_quantity: draft.quantity,
    input_unit_price: draft.unitPrice,
    input_executed_on: draft.executedOn,
  })
  if (error) throw error
  return data
}

export async function confirmTrade(supabase, previewId, idempotencyKey) {
  const { data, error } = await supabase.rpc('app_log_completed_trade', {
    input_preview_id: previewId,
    input_idempotency_key: idempotencyKey,
    input_authored_via: 'app',
  })
  if (error) throw error
  return data
}
