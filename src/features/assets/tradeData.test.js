import { describe, expect, it, vi } from 'vitest'
import { confirmTrade, listTransactionPage, previewTrade } from './tradeData'

describe('trade data', () => {
  it('previews decimal inputs without client arithmetic', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: { holding_state_version: 2 }, error: null })) }
    await previewTrade(supabase, { accountId: '2', instrumentId: '3', side: 'buy', quantity: '1.25', unitPrice: '70000', executedOn: '2026-09-21' })
    expect(supabase.rpc).toHaveBeenCalledWith('app_preview_trade_entry', expect.objectContaining({ input_quantity: '1.25', input_unit_price: '70000' }))
  })

  it('records the exact previewed draft with a holding version guard', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: { activity_id: 1 }, error: null })) }
    await confirmTrade(supabase, { accountId: '2', instrumentId: '3', side: 'buy', quantity: '1.25', unitPrice: '70000', executedOn: '2026-09-21' }, { holding_id: 4, holding_state_version: 2 }, 'key')
    expect(supabase.rpc).toHaveBeenCalledWith('app_record_completed_trade', {
      input_account_id: 2, input_instrument_id: 3, input_side: 'buy', input_quantity: '1.25', input_unit_price: '70000', input_executed_on: '2026-09-21',
      input_expected_holding_id: 4, input_expected_version: 2, input_idempotency_key: 'key', input_authored_via: 'app',
    })
  })
  it('filters transaction pages on the server before applying the limit', async () => {
    const cursor = { created_at: '2026-09-21T00:00:00Z', id: '123' }
    const supabase = { rpc: vi.fn(async () => ({ data: { items: [{ id: 'trade' }], next_cursor: cursor }, error: null })) }
    await expect(listTransactionPage(supabase, { accountId: 2, instrumentId: 3, limit: 25 }))
      .resolves.toEqual({ items: [{ id: 'trade' }], nextCursor: cursor })
    expect(supabase.rpc).toHaveBeenCalledWith('app_list_transaction_page', {
      input_account_id: 2, input_cursor: null, input_instrument_id: 3, input_limit: 25,
    })
  })
})
