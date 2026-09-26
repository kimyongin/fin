import { describe, expect, it, vi } from 'vitest'
import { deletePortfolioTag, fetchPortfolioState, fetchPortfolioViewers, fetchSharedFeatureAccess, markSharedPortfolioView, savePortfolioTag } from './data'

describe('portfolio tag mutations', () => {
  it('normalizes the tag save response for the shared manager', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: [{ tag_id: 7, name: '현금', sort_order: 2, activity_id: 9 }], error: null })) }
    await expect(savePortfolioTag(supabase, { name: '현금', sort_order: 2 })).resolves.toEqual({ id: 7, name: '현금', sort_order: 2 })
    expect(supabase.rpc).toHaveBeenCalledWith('app_save_tag', {
      input_name: '현금', input_request: null, input_sort_order: 2, input_source: 'user', input_tag_id: null,
    })
  })

  it('uses the owner-scoped delete RPC and exposes its failure', async () => {
    const failure = new Error('Move positive allocation target before deleting the tag')
    const supabase = { rpc: vi.fn(async () => ({ data: null, error: failure })) }
    await expect(deletePortfolioTag(supabase, { id: 7 })).rejects.toBe(failure)
    expect(supabase.rpc).toHaveBeenCalledWith('app_delete_tag', {
      input_request: null, input_source: 'user', input_tag_id: 7,
    })
  })
})

describe('fetchPortfolioState', () => {
  it('requests a selected friend portfolio by owner id', async () => {
    const supabase = {
      rpc: vi.fn(async () => ({ data: { accounts: [{ id: 1 }] }, error: null })),
    }

    const state = await fetchPortfolioState(supabase, 'friend-user-id')

    expect(supabase.rpc).toHaveBeenCalledWith('app_get_portfolio_state', {
      input_owner_user_id: 'friend-user-id',
    })
    expect(state.accounts).toEqual([{ id: 1 }])
  })

  it('falls back to the legacy owner RPC until the migration is applied', async () => {
    const supabase = {
      rpc: vi
        .fn()
        .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
        .mockResolvedValueOnce({ data: { accounts: [{ id: 2 }] }, error: null }),
    }

    const state = await fetchPortfolioState(supabase)

    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'app_get_portfolio_state', {
      input_owner_user_id: null,
    })
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'app_get_portfolio_state')
    expect(state.accounts).toEqual([{ id: 2 }])
  })
})

describe('fetchSharedFeatureAccess', () => {
  it('reads fail-closed effective features for a selected owner', async () => {
    const supabase = {
      rpc: vi.fn(async () => ({
        data: { owner_user_id: 'owner-1', relationship_access: true, features: { assets: true, activity: false } },
        error: null,
      })),
    }

    await expect(fetchSharedFeatureAccess(supabase, 'owner-1')).resolves.toEqual({
      ownerUserId: 'owner-1',
      relationshipAccess: true,
      features: { assets: true, activity: false },
    })
    expect(supabase.rpc).toHaveBeenCalledWith('app_get_shared_feature_access', {
      input_owner_user_id: 'owner-1',
    })
  })
})

describe('portfolio viewer access', () => {
  it('pages the owner-only viewer list without accepting an owner id', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: { items: [{ viewer_user_id: 'friend-1' }], next_offset: 100 }, error: null })) }
    await expect(fetchPortfolioViewers(supabase, 50)).resolves.toEqual({ items: [{ viewer_user_id: 'friend-1' }], nextOffset: 100 })
    expect(supabase.rpc).toHaveBeenCalledWith('app_list_portfolio_viewers', { input_limit: 50, input_offset: 50 })
  })

  it('marks a specific friend view only through the scoped RPC', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: '2026-09-26T00:00:00Z', error: null })) }
    await markSharedPortfolioView(supabase, 'owner-1')
    expect(supabase.rpc).toHaveBeenCalledWith('app_mark_shared_portfolio_view', { input_owner_user_id: 'owner-1' })
  })
})
