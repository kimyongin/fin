export function createEmptyPortfolioState() {
  return {
    accounts: [],
    holdings: [],
    positions: [],
    instruments: [],
    tags: [],
    instrumentTags: [],
    prices: [],
  }
}

export function createOwnerViewContext(ownerUserId = null) {
  return {
    mode: 'owner',
    ownerUserId,
    ownerPublicName: '',
  }
}

export async function fetchPortfolioState(supabase, ownerUserId = null) {
  const { data, error } = await supabase.rpc('app_get_portfolio_state', {
    input_owner_user_id: ownerUserId,
  })
  if (error) {
    const isLegacyRpc = ownerUserId === null && (error.code === '42883' || error.code === 'PGRST202')
    if (!isLegacyRpc) throw error

    const legacyResult = await supabase.rpc('app_get_portfolio_state')
    if (legacyResult.error) throw legacyResult.error
    return {
      ...createEmptyPortfolioState(),
      ...(legacyResult.data ?? {}),
    }
  }

  return {
    ...createEmptyPortfolioState(),
    ...(data ?? {}),
  }
}

export async function fetchFriends(supabase) {
  const { data, error } = await supabase.rpc('list_friends')
  if (error) throw error
  return data ?? []
}

export async function fetchActiveViewerAccess(supabase) {
  const { data, error } = await supabase.rpc('get_active_viewer_access')
  if (error) throw error
  return Array.isArray(data) ? data[0] ?? null : data
}

export async function fetchViewerProfile(supabase) {
  const { data, error } = await supabase
    .from('profiles')
    .select('public_name, sharing_enabled, viewer_password_updated_at')
    .limit(1)

  if (error) throw error
  return Array.isArray(data) ? data[0] ?? null : data
}
