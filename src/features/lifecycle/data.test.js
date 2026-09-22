import { describe, expect, it, vi } from 'vitest'

import {
  fetchInvestmentDecision,
  fetchInvestmentDecisionPage,
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
})
