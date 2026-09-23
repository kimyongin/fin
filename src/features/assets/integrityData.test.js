import { describe, expect, it, vi } from 'vitest'
import { confirmReconciliation, fetchHoldingIntegrity, previewReconciliation, verifyHolding } from './integrityData'
describe('holding integrity data', () => {
  it('keeps absolute values and confirmed fields distinct', async () => {
    const supabase={rpc:vi.fn(async()=>({data:{holding_state_version:2},error:null}))}
    await previewReconciliation(supabase,{holdingId:'2',values:{quantity:'25',avg_price:'68000'},reason:' 맞춤 ',effectiveOn:'2026-09-21',confirmedFields:['quantity']})
    expect(supabase.rpc).toHaveBeenCalledWith('app_preview_holding_reconciliation',expect.objectContaining({input_values:{quantity:'25',avg_price:'68000'},input_confirmed_fields:['quantity']}))
  })
  it('records verification without value mutation payload', async () => {
    const supabase={rpc:vi.fn(async()=>({data:{verification_id:'v'},error:null}))}
    await verifyHolding(supabase,{holdingId:2,expectedVersion:3,fields:['quantity'],verifiedOn:'2026-09-21',note:''},'stable-key')
    expect(supabase.rpc.mock.calls[0][1]).not.toHaveProperty('input_values')
    expect(supabase.rpc.mock.calls[0][1].input_idempotency_key).toBe('stable-key')
  })
  it('uses the caller-owned reconciliation idempotency key', async () => {
    const supabase={rpc:vi.fn(async()=>({data:{activity_id:1},error:null}))}
    await confirmReconciliation(supabase,{holdingId:2,values:{quantity:'25',avg_price:'68000'},reason:' 맞춤 ',effectiveOn:'2026-09-21',confirmedFields:['quantity']},{holding_state_version:3},'stable-key')
    expect(supabase.rpc).toHaveBeenCalledWith('app_apply_holding_correction',expect.objectContaining({input_expected_version:3,input_idempotency_key:'stable-key',input_reason:'맞춤'}))
  })
  it('reads the latest verification detail for the selected holding', async () => {
    const supabase={rpc:vi.fn(async()=>({data:{last_verification:{note:'수량 확인'}},error:null}))}
    await expect(fetchHoldingIntegrity(supabase,'2')).resolves.toEqual({last_verification:{note:'수량 확인'}})
    expect(supabase.rpc).toHaveBeenCalledWith('app_get_holding_integrity',{input_holding_id:2})
  })
})
