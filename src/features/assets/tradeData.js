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
export async function listTransactions(supabase) { const {data,error}=await supabase.rpc('app_list_transactions',{input_limit:50,input_before:null}); if(error)throw error; return Array.isArray(data)?data:[] }
export async function previewTradeReversal(supabase,tradeId,reason){const{data,error}=await supabase.rpc('app_preview_trade_reversal',{input_trade_id:tradeId,input_reason:reason.trim()});if(error)throw error;return data}
export async function confirmTradeReversal(supabase,previewId){const{data,error}=await supabase.rpc('app_reverse_trade_entry',{input_preview_id:previewId,input_idempotency_key:crypto.randomUUID(),input_authored_via:'app'});if(error)throw error;return data}
