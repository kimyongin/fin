import { describe, expect, it, vi } from 'vitest'
import { deleteMyProductFeedback, getMyProductFeedback, updateMyProductFeedback } from './data'

describe('owner feedback data adapter', () => {
  it('reads, corrects, and deletes the exact selected item at its current version', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { id: 'item', version: 2 }, error: null }) }
    await getMyProductFeedback(supabase, 'item')
    expect(supabase.rpc).toHaveBeenCalledWith('app_get_my_product_feedback', { input_feedback_id: 'item' })
    await updateMyProductFeedback(supabase, { id: 'item', expectedVersion: 1, body: 'corrected' })
    expect(supabase.rpc).toHaveBeenCalledWith('app_update_my_product_feedback', {
      input_feedback_id: 'item', input_expected_version: 1, input_body: 'corrected',
    })
    await deleteMyProductFeedback(supabase, { id: 'item', expectedVersion: 2 })
    expect(supabase.rpc).toHaveBeenCalledWith('app_delete_my_product_feedback', {
      input_feedback_id: 'item', input_expected_version: 2,
    })
  })
})
