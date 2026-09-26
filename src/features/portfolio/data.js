export function createEmptyPortfolioState() {
  return {
    accounts: [],
    holdings: [],
    positions: [],
    instruments: [],
    tags: [],
    instrumentTags: [],
    prices: [],
    valuation_quality: null,
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

export async function savePortfolioTag(supabase, tag) {
  const { data, error } = await supabase.rpc('app_save_tag', {
    input_name: tag.name,
    input_request: null,
    input_sort_order: tag.sort_order,
    input_source: 'user',
    input_tag_id: tag.id ? Number(tag.id) : null,
  })
  if (error) throw error
  const saved = Array.isArray(data) ? data[0] : data
  return { id: saved.tag_id, name: saved.name, sort_order: saved.sort_order }
}

export async function deletePortfolioTag(supabase, tag) {
  const { error } = await supabase.rpc('app_delete_tag', {
    input_request: null,
    input_source: 'user',
    input_tag_id: Number(tag.id),
  })
  if (error) throw error
}

export async function fetchFriends(supabase) {
  const { data, error } = await supabase.rpc('list_friends')
  if (error) throw error
  return data ?? []
}

export async function fetchPortfolioViewers(supabase, offset = 0) {
  const { data, error } = await supabase.rpc('app_list_portfolio_viewers', {
    input_limit: 50,
    input_offset: offset,
  })
  if (error) throw error
  return { items: data?.items ?? [], nextOffset: data?.next_offset ?? null }
}

export async function markSharedPortfolioView(supabase, ownerUserId) {
  const { error } = await supabase.rpc('app_mark_shared_portfolio_view', {
    input_owner_user_id: ownerUserId,
  })
  if (error) throw error
}

export async function fetchActiveViewerAccess(supabase) {
  const { data, error } = await supabase.rpc('get_active_viewer_access')
  if (error) throw error
  return Array.isArray(data) ? data[0] ?? null : data
}

export async function fetchSharedFeatureAccess(supabase, ownerUserId) {
  if (!ownerUserId) throw new Error('공유 포트폴리오 소유자가 필요합니다.')
  const { data, error } = await supabase.rpc('app_get_shared_feature_access', {
    input_owner_user_id: ownerUserId,
  })
  if (error) throw error
  return {
    ownerUserId: data?.owner_user_id ?? ownerUserId,
    relationshipAccess: Boolean(data?.relationship_access),
    features: data?.features ?? {},
  }
}

export async function fetchViewerProfile(supabase) {
  const { data, error } = await supabase.rpc('app_get_sharing_profile')
  if (error) throw error
  return data
}
