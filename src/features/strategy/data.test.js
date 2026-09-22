import { describe, expect, it, vi } from 'vitest'

import { fetchPrinciples, savePrinciple } from './data'

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
