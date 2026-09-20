import { describe, expect, it, vi } from 'vitest'

import { fetchDailyBriefing, fetchDailyBriefings } from './data'

describe('daily review data adapter', () => {
  it('lists briefing summaries with a bounded cursor request', async () => {
    const supabase = {
      rpc: vi.fn(async () => ({ data: [{ id: 'briefing-1' }], error: null })),
    }

    const result = await fetchDailyBriefings(supabase, { limit: 12, before: '2026-09-21T00:00:00Z' })

    expect(supabase.rpc).toHaveBeenCalledWith('app_list_daily_briefings', {
      input_limit: 12,
      input_before: '2026-09-21T00:00:00Z',
    })
    expect(result).toEqual([{ id: 'briefing-1' }])
  })

  it('loads one complete briefing aggregate', async () => {
    const supabase = {
      rpc: vi.fn(async () => ({ data: { id: 'briefing-1', evidence: [] }, error: null })),
    }

    await expect(fetchDailyBriefing(supabase, 'briefing-1')).resolves.toMatchObject({ id: 'briefing-1' })
    expect(supabase.rpc).toHaveBeenCalledWith('app_get_daily_briefing', {
      input_briefing_id: 'briefing-1',
    })
  })

  it('does not treat an inaccessible briefing as an empty result', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: null, error: null })) }

    await expect(fetchDailyBriefing(supabase, 'missing')).rejects.toThrow('접근할 수 없습니다')
  })
})
