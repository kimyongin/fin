import { describe, expect, it, vi } from 'vitest'

import { archiveOperatingRule, fetchInvestmentPolicy, fetchOperatingRules, saveInvestmentPolicy, saveOperatingRule } from './data'

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
