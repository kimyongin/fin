import { describe, expect, it, vi } from 'vitest'
import { fetchPortfolioState, fetchSharedFeatureAccess } from './data'

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
