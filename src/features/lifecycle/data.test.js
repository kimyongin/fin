import { describe, expect, it, vi } from 'vitest'

import {
  fetchActivity,
  fetchActivityTags,
  fetchActionTimeline,
  fetchPortfolioTask,
  recordManualActivity,
  searchActivities,
  setActivityTags,
  updateActivity,
} from './data'

describe('decision and task data adapters', () => {
  it('loads details and rejects inaccessible records', async () => {
    const found = { rpc: vi.fn(async () => ({ data: { id: 'record-1' }, error: null })) }
    await expect(fetchPortfolioTask(found, 'record-1')).resolves.toEqual({ id: 'record-1' })
    expect(found.rpc.mock.calls[0][0]).toBe('app_get_general_task')

    const missing = { rpc: vi.fn(async () => ({ data: null, error: null })) }
    await expect(fetchPortfolioTask(missing, 'missing')).rejects.toThrow('접근할 수 없습니다')
  })

  it('uses feature-gated DTOs for a selected friend', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: [], error: null })) }
    await fetchPortfolioTask(supabase, 'record-1', 'owner-1')
    expect(supabase.rpc.mock.calls[0][0]).toBe('app_get_general_task_for_owner')
  })

  it('reads the unified pending and performed action timeline with an opaque cursor', async () => {
    const cursor = { occurred_at: '2026-09-22T00:00:00Z', id: 42 }
    const supabase = { rpc: vi.fn(async () => ({ data: { pending: [{ id: 'task' }], days: [{ date: '2026-09-22', items: [] }], next_cursor: cursor }, error: null })) }
    await expect(fetchActionTimeline(supabase, { filter: 'done', from: '2026-09-01', ownerUserId: 'owner' })).resolves.toEqual({ pending: [{ id: 'task' }], days: [{ date: '2026-09-22', items: [] }], nextCursor: cursor })
    expect(supabase.rpc).toHaveBeenCalledWith('app_list_action_timeline', {
      input_owner_user_id: 'owner', input_filter: 'done', input_from: '2026-09-01', input_to: null,
      input_limit: 30, input_cursor: null, input_timezone: 'Asia/Seoul',
    })
  })

  it('creates, reads, and edits one activity without exposing storage types', async () => {
    const supabase = { rpc: vi.fn(async (_name, params) => ({ data: { id: params.input_activity_id ?? 7, version: 1 }, error: null })) }
    const idempotencyKey = crypto.randomUUID()

    await recordManualActivity(supabase, { title: '실적 확인', body: '보유\n\n유지', idempotencyKey })
    await fetchActivity(supabase, 7)
    await updateActivity(supabase, { id: 7, version: 1 }, { body: '다음 달 재확인' })

    expect(supabase.rpc.mock.calls[0]).toEqual(['app_create_activity_with_tags', {
      input_idempotency_key: idempotencyKey,
      input_tag_ids: [],
      input_payload: {
        title: '실적 확인', body: '보유\n\n유지', occurred_at: null,
        timezone: 'Asia/Seoul', task_id: null, holding_id: null, instrument_id: null, account_id: null, authored_via: 'app',
      },
    }])
    expect(supabase.rpc.mock.calls[1]).toEqual(['app_get_activity', { input_activity_id: 7, input_owner_user_id: null }])
    expect(supabase.rpc.mock.calls[2][0]).toBe('app_update_activity')
    expect(supabase.rpc.mock.calls[2][1]).toMatchObject({ input_activity_id: 7, input_expected_version: 1, input_patch: { body: '다음 달 재확인' } })
    expect(supabase.rpc).toHaveBeenCalledTimes(3)
  })

  it('keeps activity tags separate and passes combined search filters to the server', async () => {
    const tagId = crypto.randomUUID()
    const supabase = { rpc: vi.fn(async (name) => ({ data: name === 'app_list_activity_tags' ? [{ id: tagId, name: '실적' }] : { items: [], next_cursor: null }, error: null })) }
    await expect(fetchActivityTags(supabase)).resolves.toEqual([{ id: tagId, name: '실적' }])
    await setActivityTags(supabase, { id: 5, version: 2 }, [tagId])
    await searchActivities(supabase, { query: '보유 유지', state: 'done', tagIds: [tagId] })

    expect(supabase.rpc.mock.calls[1][0]).toBe('app_set_activity_tags')
    expect(supabase.rpc.mock.calls[1][1]).toMatchObject({ input_activity_id: 5, input_expected_version: 2, input_tag_ids: [tagId] })
    expect(supabase.rpc.mock.calls[2]).toEqual(['app_search_activities', {
      input_owner_user_id: null, input_query: '보유 유지', input_from: null, input_to: null,
      input_record_state: 'done', input_instrument_id: null, input_account_id: null, input_holding_id: null,
      input_tag_ids: [tagId], input_tag_match: 'any', input_limit: 30, input_cursor: null, input_timezone: 'Asia/Seoul',
    }])
  })
})
