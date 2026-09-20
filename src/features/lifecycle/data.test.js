import { describe, expect, it, vi } from 'vitest'

import {
  fetchInvestmentDecision,
  fetchInvestmentDecisions,
  fetchPortfolioTask,
  fetchPortfolioTasks,
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
})
