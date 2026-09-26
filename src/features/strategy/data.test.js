import { describe, expect, it, vi } from 'vitest'

import { clearAllocationTargets, correctPrincipleRow, deletePrincipleRow, fetchPrincipleChanges, fetchPrinciples, saveAllocationTargets, savePrinciple } from './data'

describe('principle revision data adapter', () => {
  it('pages real changes using the server cursor', async () => {
    const cursor = { effective_at: '2026-09-23T00:00:00Z', id: 7 }
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { items: [{ id: 9, change_type: 'updated' }], next_cursor: cursor }, error: null }) }
    await expect(fetchPrincipleChanges(supabase)).resolves.toEqual({ items: [{ id: 9, change_type: 'updated' }], nextCursor: cursor })
    expect(supabase.rpc).toHaveBeenCalledWith('app_list_principle_changes', { input_limit: 20, input_cursor: null, input_owner_user_id: null })
  })
  it('reads the current or a dated view without treating an error as empty', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { items: [{ body: '현금 유지' }] }, error: null }) }
    await expect(fetchPrinciples(supabase, { onDate: '2026-09-20' })).resolves.toEqual([{ body: '현금 유지' }])
    expect(supabase.rpc).toHaveBeenCalledWith('app_list_principles', expect.objectContaining({
      input_on: '2026-09-20', input_include_ended: false, input_timezone: 'Asia/Seoul', input_owner_user_id: null,
    }))
    supabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('read failed') })
    await expect(fetchPrinciples(supabase)).rejects.toThrow('read failed')
  })

  it('appends one approved revision with a stable ID and expected row', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { id: 3 }, error: null }) }
    await expect(savePrinciple(supabase, { principleId: 'stable-id', expectedRowId: 2, expectedBody: '현금 유지', expectedChangeNote: '첫 작성', body: ' 손실 제한 ', changeNote: ' 변경 ', activityTagIds: ['tag-id'] })).resolves.toEqual({ id: 3 })
    expect(supabase.rpc).toHaveBeenCalledWith('app_save_principle_with_activity', {
      input_principle_id: 'stable-id', input_expected_row_id: 2,
      input_expected_body: '현금 유지', input_expected_change_note: '첫 작성',
      input_body: ' 손실 제한 ', input_change_note: '변경', input_activity_tag_ids: ['tag-id'],
    })
  })

  it('sends the exact selected history row for correction and deletion', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { id: 2 }, error: null }) }
    await correctPrincipleRow(supabase, { rowId: 2, expectedBody: '이전 본문', expectedChangeNote: null, body: '고친 본문', changeNote: '정정' })
    expect(supabase.rpc).toHaveBeenCalledWith('app_correct_principle_row', {
      input_row_id: 2, input_expected_body: '이전 본문', input_expected_change_note: null,
      input_body: '고친 본문', input_change_note: '정정',
    })
    await deletePrincipleRow(supabase, { rowId: 2, expectedBody: '고친 본문', expectedChangeNote: '정정', expectedCurrentRowId: 3 })
    expect(supabase.rpc).toHaveBeenCalledWith('app_delete_principle_row', {
      input_row_id: 2, input_expected_body: '고친 본문', input_expected_change_note: '정정', input_expected_current_row_id: 3,
    })
  })
})

describe('allocation target data adapter', () => {
  it('sends the complete target set and expected current set to one RPC', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { configured: true, targets: [{ tag_id: 1, target_percentage: 100 }] }, error: null }) }
    const targets = [{ tag_id: 1, target_percentage: 100 }]
    await expect(saveAllocationTargets(supabase, { targets, expectedTargets: [], changeNote: '재배분', activityTagIds: ['tag-id'], idempotencyKey: 'retry-key' })).resolves.toEqual({ configured: true, targets })
    expect(supabase.rpc).toHaveBeenCalledWith('app_save_allocation_targets_with_activity', { input_targets: targets, input_expected_targets: [], input_change_note: '재배분', input_activity_tag_ids: ['tag-id'], input_idempotency_key: 'retry-key' })
  })
  it('clears the whole target set with the same concurrency guard', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { configured: false, targets: [] }, error: null }) }
    const expectedTargets = [{ tag_id: 1, target_percentage: 100 }]
    await expect(clearAllocationTargets(supabase, { expectedTargets, idempotencyKey: 'retry-key' })).resolves.toEqual({ configured: false, targets: [] })
    expect(supabase.rpc).toHaveBeenCalledWith('app_clear_allocation_targets_with_activity', { input_expected_targets: expectedTargets, input_change_note: null, input_activity_tag_ids: [], input_idempotency_key: 'retry-key' })
  })
})
