import { describe, expect, it, vi } from 'vitest'

import {
  fetchInvestmentDecision,
  fetchInvestmentDecisionPage,
  fetchActionTimeline,
  fetchActivityReports,
  fetchLinkedTodoTaskIds,
  fetchInvestmentDecisions,
  fetchPortfolioTask,
  fetchPortfolioTaskPage,
  fetchPortfolioTasks,
  fetchTodoBundle,
  fetchTodoBundlePage,
  saveTodoBundle,
} from './data'

describe('decision and task data adapters', () => {
  it('lists decisions and tasks with explicit filters', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: [], error: null })) }

    await fetchInvestmentDecisions(supabase, { limit: 10, before: '2026-09-21T00:00:00Z' })
    await fetchPortfolioTasks(supabase, { state: 'open', limit: 5 })

    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'app_list_investment_decisions', {
      input_limit: 10,
      input_before: '2026-09-21T00:00:00Z',
    })
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'app_list_portfolio_tasks', {
      input_state: 'open',
      input_limit: 5,
      input_before: null,
    })
  })

  it('loads details and rejects inaccessible records', async () => {
    const found = { rpc: vi.fn(async () => ({ data: { id: 'record-1' }, error: null })) }
    await expect(fetchInvestmentDecision(found, 'record-1')).resolves.toEqual({ id: 'record-1' })
    await expect(fetchPortfolioTask(found, 'record-1')).resolves.toEqual({ id: 'record-1' })

    const missing = { rpc: vi.fn(async () => ({ data: null, error: null })) }
    await expect(fetchInvestmentDecision(missing, 'missing')).rejects.toThrow('접근할 수 없습니다')
    await expect(fetchPortfolioTask(missing, 'missing')).rejects.toThrow('접근할 수 없습니다')
  })

  it('uses feature-gated DTOs for a selected friend', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: [], error: null })) }
    await fetchInvestmentDecisions(supabase, { ownerUserId: 'owner-1' })
    await fetchPortfolioTasks(supabase, { ownerUserId: 'owner-1' })
    expect(supabase.rpc.mock.calls[0][0]).toBe('app_list_investment_decisions_for_owner')
    expect(supabase.rpc.mock.calls[1][0]).toBe('app_list_portfolio_tasks_for_owner')
  })

  it('passes filters and opaque cursors to owner-aware keyset pages', async () => {
    const cursor = { updated_at: '2026-09-21T00:00:00Z', id: crypto.randomUUID() }
    const supabase = {
      rpc: vi.fn()
        .mockResolvedValueOnce({ data: { items: [{ id: 'task' }], next_cursor: cursor }, error: null })
        .mockResolvedValueOnce({ data: { items: [{ id: 'decision' }], next_cursor: null }, error: null }),
    }

    await expect(fetchPortfolioTaskPage(supabase, { cursor, filter: 'paused', ownerUserId: 'owner' }))
      .resolves.toEqual({ items: [{ id: 'task' }], nextCursor: cursor })
    await expect(fetchInvestmentDecisionPage(supabase, { filter: 'all' }))
      .resolves.toEqual({ items: [{ id: 'decision' }], nextCursor: null })
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'app_list_portfolio_task_page', {
      input_cursor: cursor,
      input_filter: 'paused',
      input_limit: 20,
      input_owner_user_id: 'owner',
    })
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'app_list_investment_decision_page', {
      input_cursor: null,
      input_filter: 'all',
      input_limit: 20,
      input_owner_user_id: null,
    })
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

  it('lists saved activity reports with their freshness state', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: { items: [{ id: 'report', needs_regeneration: true }], next_cursor: null }, error: null })) }
    await expect(fetchActivityReports(supabase)).resolves.toEqual({ items: [{ id: 'report', needs_regeneration: true }], nextCursor: null })
    expect(supabase.rpc).toHaveBeenCalledWith('app_list_activity_reports', { input_limit: 10, input_cursor: null })
  })
})

describe('ToDo bundle data adapters', () => {
  it('pages, reads, and saves a multi-item bundle with explicit removal semantics', async () => {
    const cursor = { updated_at: '2026-09-22T00:00:00Z', id: crypto.randomUUID() }
    const supabase = { rpc: vi.fn()
      .mockResolvedValueOnce({ data: { items: [{ id: 'bundle' }], next_cursor: cursor }, error: null })
      .mockResolvedValueOnce({ data: { id: 'bundle', items: [] }, error: null })
      .mockResolvedValueOnce({ data: { id: 'bundle', items: [{ id: 'item' }] }, error: null }) }
    await expect(fetchTodoBundlePage(supabase, { filter: 'completed' })).resolves.toEqual({ items: [{ id: 'bundle' }], nextCursor: cursor })
    await expect(fetchTodoBundle(supabase, 'bundle')).resolves.toMatchObject({ id: 'bundle' })
    await saveTodoBundle(supabase, {
      id: 'bundle', expectedVersion: 1, idempotencyKey: 'key', title: ' 묶음 ', summary: '', tags: ['확인'],
      items: [{ id: 'item', kind: 'general', title: '확인', status: 'done', sort_order: 0 }], removeItemIds: [],
    })
    expect(supabase.rpc).toHaveBeenLastCalledWith('app_save_todo_bundle', expect.objectContaining({
      input_bundle_id: 'bundle', input_expected_version: 1, input_title: '묶음', input_summary: null,
      input_items: expect.any(Array), input_remove_item_ids: [], input_rule_ids: null,
    }))
  })

  it('reads task membership separately so linked tasks are not duplicated in the legacy list', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: ['task-1'], error: null }) }
    await expect(fetchLinkedTodoTaskIds(supabase)).resolves.toEqual(['task-1'])
    expect(supabase.rpc).toHaveBeenCalledWith('app_list_todo_linked_task_ids', undefined)
  })
})
