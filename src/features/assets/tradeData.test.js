import { describe, expect, it, vi } from 'vitest'
import { confirmTrade, previewTrade, previewTradeReversal } from './tradeData'

describe('trade data', () => {
  it('previews decimal inputs without client arithmetic', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: { preview_id: 'p' }, error: null })) }
    await previewTrade(supabase, { accountId: '2', instrumentId: '3', side: 'buy', quantity: '1.25', unitPrice: '70000', executedOn: '2026-09-21' })
    expect(supabase.rpc).toHaveBeenCalledWith('app_preview_trade_entry', expect.objectContaining({ input_quantity: '1.25', input_unit_price: '70000' }))
  })

  it('confirms only a server preview', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: { trade_id: 't' }, error: null })) }
    await confirmTrade(supabase, 'preview', 'key')
    expect(supabase.rpc).toHaveBeenCalledWith('app_log_completed_trade', { input_preview_id: 'preview', input_idempotency_key: 'key', input_authored_via: 'app' })
  })
  it('previews reversal by original trade id without creating an opposite side',async()=>{const supabase={rpc:vi.fn(async()=>({data:{preview_id:'r'},error:null}))};await previewTradeReversal(supabase,'trade',' 정정 ');expect(supabase.rpc).toHaveBeenCalledWith('app_preview_trade_reversal',{input_trade_id:'trade',input_reason:'정정'})})
})
