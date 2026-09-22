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
export async function listTransactionPage(supabase, { accountId = null, cursor = null, instrumentId = null, limit = 50 } = {}) {
  const { data, error } = await supabase.rpc('app_list_transaction_page', {
    input_account_id: accountId == null ? null : Number(accountId),
    input_cursor: cursor,
    input_instrument_id: instrumentId == null ? null : Number(instrumentId),
    input_limit: limit,
  })
  if (error) throw error
  return { items: Array.isArray(data?.items) ? data.items : [], nextCursor: data?.next_cursor ?? null }
}

export async function listTransactions(supabase, filters = {}) {
  return (await listTransactionPage(supabase, filters)).items
}
