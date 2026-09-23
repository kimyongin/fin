import { describe, expect, it, vi } from 'vitest'

import { fetchPrincipleChanges, fetchPrinciples, savePrinciple } from './data'

describe('principle revision data adapter', () => {
  it('pages real changes using the server cursor', async () => {
    const cursor = { effective_at: '2026-09-23T00:00:00Z', id: 7 }
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { items: [{ id: 9, change_type: 'updated' }], next_cursor: cursor }, error: null }) }
    await expect(fetchPrincipleChanges(supabase)).resolves.toEqual({ items: [{ id: 9, change_type: 'updated' }], nextCursor: cursor })
    expect(supabase.rpc).toHaveBeenCalledWith('app_list_principle_changes', { input_limit: 20, input_cursor: null })
  })
  it('reads the current or a dated view without treating an error as empty', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { items: [{ body: '현금 유지' }] }, error: null }) }
    await expect(fetchPrinciples(supabase, { onDate: '2026-09-20' })).resolves.toEqual([{ body: '현금 유지' }])
    expect(supabase.rpc).toHaveBeenCalledWith('app_list_principles', expect.objectContaining({
      input_on: '2026-09-20', input_include_ended: false, input_timezone: 'Asia/Seoul',
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
