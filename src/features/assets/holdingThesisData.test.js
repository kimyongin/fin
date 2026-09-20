import { describe, expect, it, vi } from 'vitest'
import { fetchHoldingTheses, saveHoldingThesis } from './holdingThesisData'

describe('holding thesis data', () => {
  it('lists current owner theses', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: [{ id: 'one' }], error: null })) }
    await expect(fetchHoldingTheses(supabase)).resolves.toEqual([{ id: 'one' }])
    expect(supabase.rpc).toHaveBeenCalledWith('app_list_holding_theses')
  })

  it('saves one explicitly scoped versioned thesis', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: { thesis: { version: 2 } }, error: null })) }
    await expect(saveHoldingThesis(supabase, {
      instrumentId: '7', accountId: '9', expectedVersion: 1,
      idempotencyKey: 'key', changeReason: '  조건 변경  ',
      patch: { reason_text: '계속 보유' },
    })).resolves.toEqual({ version: 2 })
    expect(supabase.rpc).toHaveBeenCalledWith('app_save_holding_thesis', {
      input_instrument_id: 7,
      input_account_id: 9,
      input_expected_version: 1,
      input_idempotency_key: 'key',
      input_patch: { reason_text: '계속 보유' },
      input_change_reason: '조건 변경',
      input_authored_via: 'app',
    })
  })
})
