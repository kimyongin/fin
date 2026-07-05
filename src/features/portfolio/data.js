import { latestPrices } from '../../lib/portfolioMath'

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

export async function fetchPortfolioState(supabase) {
  const results = await Promise.all([
    supabase.from('accounts').select('*').order('name'),
    supabase
      .from('holdings')
      .select('*, instruments(display_name, currency, instrument_type)')
      .order('account_id'),
    supabase.from('instruments').select('*').order('display_name'),
    supabase.from('tags').select('*').order('sort_order'),
    supabase.from('instrument_tags').select('ticker, tag_id, tags(id, name, color)'),
    supabase
      .from('holding_prices_daily')
      .select('ticker, price_date, close_price, source')
      .order('price_date', { ascending: false }),
  ])

  const failed = results.find((result) => result.error)
  if (failed) throw failed.error

  return {
    accounts: results[0].data ?? [],
    holdings: results[1].data ?? [],
    positions: [],
    instruments: results[2].data ?? [],
    tags: results[3].data ?? [],
    instrumentTags: results[4].data ?? [],
    prices: latestPrices(results[5].data ?? []),
  }
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
