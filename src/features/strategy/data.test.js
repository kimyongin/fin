import { describe, expect, it, vi } from 'vitest'

import { archiveOperatingRule, fetchInvestmentPolicy, fetchOperatingRules, fetchPrinciples, saveInvestmentPolicy, saveOperatingRule, savePrinciple } from './data'

describe('principle revision data adapter', () => {
  it('reads the current or a dated view without treating an error as empty', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { items: [{ body: '현금 유지' }] }, error: null }) }
    await expect(fetchPrinciples(supabase, { onDate: '2026-09-20' })).resolves.toEqual([{ body: '현금 유지' }])
    expect(supabase.rpc).toHaveBeenCalledWith('app_list_principles', expect.objectContaining({
      input_on: '2026-09-20', input_include_ended: false,
    }))
    supabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('read failed') })
    await expect(fetchPrinciples(supabase)).rejects.toThrow('read failed')
  })

  it('appends one approved revision with a stable ID and expected row', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { id: 3 }, error: null }) }
    await expect(savePrinciple(supabase, { principleId: 'stable-id', expectedRowId: 2, kind: 'risk', body: ' 손실 제한 ' })).resolves.toEqual({ id: 3 })
    expect(supabase.rpc).toHaveBeenCalledWith('app_save_principle', {
      input_principle_id: 'stable-id', input_expected_row_id: 2, input_kind: 'risk',
      input_body: '손실 제한', input_scope: null, input_end: false,
    })
  })
})

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

describe('operating rule data adapter', () => {
  it('keeps an empty rule list distinct from an RPC error', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { rules: [] }, error: null }) }
    await expect(fetchOperatingRules(supabase, 'reconciliation')).resolves.toEqual([])
    expect(supabase.rpc).toHaveBeenCalledWith('app_list_operating_rules', {
      input_workflow_key: 'reconciliation', input_include_archived: false,
    })
  })

  it('maps save and archive contracts', async () => {
    const rule = { id: 'rule-id', version: 2 }
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { rule }, error: null }) }
    await saveOperatingRule(supabase, {
      id: null, expectedVersion: null, idempotencyKey: 'save-key', title: ' XLS 규칙 ',
      workflowKey: 'reconciliation', applicability: ' 미래에셋 XLS ', body: ' 매입금액을 사용 ', changeReason: ' 최초 저장 ',
    })
    expect(supabase.rpc).toHaveBeenCalledWith('app_save_operating_rule', expect.objectContaining({
      input_rule_id: null, input_title: 'XLS 규칙', input_authored_via: 'app',
    }))
    await expect(archiveOperatingRule(supabase, {
      id: 'rule-id', expectedVersion: 2, idempotencyKey: 'archive-key', reason: ' 더 이상 사용하지 않음 ',
    })).resolves.toEqual(rule)
    expect(supabase.rpc).toHaveBeenLastCalledWith('app_archive_operating_rule', expect.objectContaining({
      input_rule_id: 'rule-id', input_reason: '더 이상 사용하지 않음',
    }))
  })
})
