import { describe, expect, it, vi } from 'vitest'

import { fetchReviewActivities } from './data'

describe('saved review activity adapter', () => {
  it('reads owner-aware review activities with a stable cursor', async () => {
    const cursor = { occurred_at: '2026-09-21T00:00:00Z', id: 4 }
    const supabase = { rpc: vi.fn(async () => ({ data: { items: [{ id: 3, title: '점검' }], next_cursor: cursor }, error: null })) }
    await expect(fetchReviewActivities(supabase, { ownerUserId: 'owner-1', limit: 12, cursor }))
      .resolves.toEqual({ items: [{ id: 3, title: '점검' }], nextCursor: cursor })
    expect(supabase.rpc).toHaveBeenCalledWith('app_list_narrative_activities', {
      input_kind: 'review', input_owner_user_id: 'owner-1', input_limit: 12, input_cursor: cursor,
    })
  })

  it('surfaces read failures instead of showing an empty review', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: null, error: new Error('offline') })) }
    await expect(fetchReviewActivities(supabase)).rejects.toThrow('offline')
  })
})
