import { describe, expect, it, vi } from 'vitest'

import { fetchInvestmentPolicy, saveInvestmentPolicy } from './data'

describe('investment policy data adapter', () => {
  it('keeps a missing personal policy distinct from defaults', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: { profile: null, strategy: {} }, error: null })) }
    await expect(fetchInvestmentPolicy(supabase)).resolves.toBeNull()
    expect(supabase.rpc).toHaveBeenCalledWith('app_get_investment_policy')
  })

  it('saves an explicit patch with version and idempotency key', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: { profile: { version: 2 } }, error: null })) }
    await saveInvestmentPolicy(supabase, {
      expectedVersion: 1,
      idempotencyKey: 'policy-key',
      patch: { horizon_text: '10년 이상' },
      changeReason: '기간 수정',
    })
    expect(supabase.rpc).toHaveBeenCalledWith('app_save_investment_policy', {
      input_expected_version: 1,
      input_idempotency_key: 'policy-key',
      input_patch: { horizon_text: '10년 이상' },
      input_change_reason: '기간 수정',
      input_authored_via: 'app',
    })
  })
})
