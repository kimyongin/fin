import { describe, expect, it, vi } from 'vitest'

import {
  createActivityFollowUp,
  fetchActivity,
  fetchActivityTags,
  fetchDecisionActivities,
  fetchActionTimeline,
  fetchPortfolioTask,
  recordManualActivity,
  searchActivities,
  setActivityTags,
  updateActivity,
} from './data'

describe('decision and task data adapters', () => {
  it('pages decision activities through the feature-gated narrative read', async () => {
    const cursor = { occurred_at: '2026-09-23T00:00:00Z', id: 12 }
    const supabase = { rpc: vi.fn(async () => ({ data: { items: [{ id: 13 }], next_cursor: cursor }, error: null })) }
    await expect(fetchDecisionActivities(supabase, { ownerUserId: 'owner-1', limit: 5 }))
      .resolves.toEqual({ items: [{ id: 13 }], nextCursor: cursor })
    expect(supabase.rpc).toHaveBeenCalledWith('app_list_narrative_activities', {
      input_kind: 'decision', input_owner_user_id: 'owner-1', input_limit: 5, input_cursor: null,
    })
  })
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

  it('creates, reads, edits, and follows up one activity without exposing storage types', async () => {
    const supabase = { rpc: vi.fn(async (_name, params) => ({ data: { id: params.input_activity_id ?? 7, version: 1 }, error: null })) }
    const idempotencyKey = crypto.randomUUID()

    await recordManualActivity(supabase, { title: '실적 확인', result: '보유', conclusion: '유지', idempotencyKey })
    await fetchActivity(supabase, 7)
    await updateActivity(supabase, { id: 7, version: 1 }, { result: '다음 달 재확인' })
    await createActivityFollowUp(supabase, 7, { title: '다음 실적 확인', dueDate: '2026-10-23', idempotencyKey })

    expect(supabase.rpc.mock.calls[0]).toEqual(['app_create_activity', {
      input_idempotency_key: idempotencyKey,
      input_payload: {
        title: '실적 확인', note: null, result: '보유', conclusion: '유지', occurred_at: null,
        timezone: 'Asia/Seoul', instrument_id: null, account_id: null, category: 'general', context: null, authored_via: 'app',
      },
    }])
    expect(supabase.rpc.mock.calls[1]).toEqual(['app_get_activity', { input_activity_id: 7, input_owner_user_id: null }])
    expect(supabase.rpc.mock.calls[2][0]).toBe('app_update_activity')
    expect(supabase.rpc.mock.calls[2][1]).toMatchObject({ input_activity_id: 7, input_expected_version: 1, input_patch: { result: '다음 달 재확인' } })
    expect(supabase.rpc.mock.calls[3]).toEqual(['app_create_activity_follow_up', {
      input_origin_event_id: 7,
      input_idempotency_key: idempotencyKey,
      input_payload: {
        title: '다음 실적 확인', subject: { kind: 'portfolio' }, due_date: '2026-10-23', timezone: 'Asia/Seoul',
        trigger_text: null, recurrence_kind: 'none', recurrence_start_on: null, authored_via: 'app',
      },
    }])
  })

  it('keeps activity tags separate and passes combined search filters to the server', async () => {
    const tagId = crypto.randomUUID()
    const supabase = { rpc: vi.fn(async (name) => ({ data: name === 'app_list_activity_tags' ? [{ id: tagId, name: '실적' }] : { items: [], next_cursor: null }, error: null })) }
    await expect(fetchActivityTags(supabase)).resolves.toEqual([{ id: tagId, name: '실적' }])
    await setActivityTags(supabase, { id: 5, version: 2 }, [tagId])
    await searchActivities(supabase, { query: '보유 유지', state: 'done', conclusion: 'yes', tagIds: [tagId] })

    expect(supabase.rpc.mock.calls[1][0]).toBe('app_set_activity_tags')
    expect(supabase.rpc.mock.calls[1][1]).toMatchObject({ input_activity_id: 5, input_expected_version: 2, input_tag_ids: [tagId] })
    expect(supabase.rpc.mock.calls[2]).toEqual(['app_search_activities', {
      input_owner_user_id: null, input_query: '보유 유지', input_from: null, input_to: null,
      input_record_state: 'done', input_has_conclusion: true, input_instrument_id: null, input_account_id: null,
      input_tag_ids: [tagId], input_tag_match: 'all', input_limit: 30, input_cursor: null, input_timezone: 'Asia/Seoul',
    }])
  })
})
