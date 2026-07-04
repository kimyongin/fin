import { useEffect, useMemo, useRef, useState } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const allTabs = [
  { id: 'overview', label: '자산' },
  { id: 'settings', label: '설정' },
]
const assetViewOptions = [
  { id: 'tags', label: '태그 기준' },
  { id: 'accounts', label: '계좌 기준' },
  { id: 'instruments', label: '종목 기준' },
]

const chartPalette = ['#db6a21', '#26c6da', '#7dd3fc', '#f97316', '#84cc16', '#facc15', '#fb7185']
const tagColorOptions = [
  { value: 'orange', label: 'Orange' },
  { value: 'cyan', label: 'Cyan' },
  { value: 'blue', label: 'Blue' },
  { value: 'lime', label: 'Lime' },
  { value: 'amber', label: 'Amber' },
  { value: 'rose', label: 'Rose' },
  { value: 'violet', label: 'Violet' },
  { value: 'slate', label: 'Slate' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'info', label: 'Info' },
  { value: 'success', label: 'Success' },
  { value: 'warning', label: 'Warning' },
  { value: 'danger', label: 'Danger' },
]
const tabIds = new Set(allTabs.map((tab) => tab.id))
const tagColorMap = {
  orange: '#ff8a00',
  cyan: '#26c6da',
  blue: '#7dd3fc',
  lime: '#84cc16',
  amber: '#f59e0b',
  rose: '#fb7185',
  violet: '#a78bfa',
  slate: '#94a3b8',
  neutral: '#8a8e96',
  info: '#26c6da',
  success: '#7cb342',
  warning: '#f59e0b',
  danger: '#ef4444',
}

const KRW = new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0,
})

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

const JPY = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  currencyDisplay: 'narrowSymbol',
  maximumFractionDigits: 0,
})

const comparablePriceMetricTickers = new Set([
  'AUD',
  'CAD',
  'CHF',
  'CNY',
  'EUR',
  'GBP',
  'HKD',
  'JPY',
  'KRW',
  'SGD',
  'USD',
])

function formatKrw(value) {
  return Number.isFinite(value) ? KRW.format(Math.round(value)) : '-'
}

function formatMoney(value, currency = 'KRW') {
  if (!Number.isFinite(value)) return '-'
  if (currency === 'JPY') return JPY.format(Math.round(value))
  if (currency === 'USD') return USD.format(value)
  return formatKrw(value)
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '-'
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return '-'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

function returnToneClass(value) {
  if (value > 0) return 'text-red-400'
  if (value < 0) return 'text-blue-300'
  return 'text-[var(--muted-ink)]'
}

function formatNumber(value) {
  return Number.isFinite(value)
    ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })
    : '-'
}

function formattedValueWithConversion(nativeValue, currency, krwValue = null) {
  if (!Number.isFinite(nativeValue)) return '-'
  const converted =
    currency !== 'KRW' && Number.isFinite(krwValue) ? ` (${formatKrw(krwValue)} 환산)` : ''
  return `${formatMoney(nativeValue, currency)}${converted}`
}

function hasComparablePriceMetrics(item) {
  if (!item) return true
  const instrumentType = item.instrument_type ?? item.instruments?.instrument_type ?? ''
  const ticker = String(item.ticker ?? '').toUpperCase()
  if ((instrumentType === 'cash' || instrumentType === 'other') && comparablePriceMetricTickers.has(ticker)) {
    return false
  }
  return true
}

function authRedirectTo() {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

function tabFromHash() {
  if (typeof window === 'undefined') return 'overview'
  const hash = window.location.hash.replace(/^#/, '').trim()
  if (hash === 'accounts' || hash === 'instruments') return 'overview'
  return tabIds.has(hash) ? hash : 'overview'
}

function assetViewFromHash() {
  if (typeof window === 'undefined') return 'tags'
  const hash = window.location.hash.replace(/^#/, '').trim()
  return hash === 'accounts' || hash === 'instruments' ? hash : 'tags'
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function normalizeTickerInput(value) {
  return String(value ?? '').trim().toUpperCase()
}

function createViewerProfileDraft(profile = null) {
  return {
    public_name: profile?.public_name ?? '',
    sharing_enabled: Boolean(profile?.sharing_enabled),
    viewer_password: '',
    viewer_password_updated_at: profile?.viewer_password_updated_at ?? null,
  }
}

function createGuestUnlockDraft() {
  return {
    public_name: '',
    viewer_password: '',
  }
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isViewerSchemaMissingError(error) {
  const code = error?.code ?? ''
  const message = `${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`
  const mentionsViewerSchema =
    /profiles/i.test(message) ||
    /viewer_sessions/i.test(message) ||
    /set_viewer_profile/i.test(message) ||
    /unlock_viewer_access/i.test(message) ||
    /get_active_viewer_access/i.test(message)

  return (
    ((code === '42P01' || code === '42883') && mentionsViewerSchema) ||
    ((/schema cache/i.test(message) ||
      /Could not find the table/i.test(message) ||
      /Could not find the function/i.test(message)) &&
      mentionsViewerSchema)
  )
}

function formatSupabaseError(error, fallback) {
  const message = error?.message ?? fallback
  return error?.code ? `${message} (${error.code})` : message
}

async function formatFunctionInvokeError(error, fallback) {
  const response = error?.context
  if (response && typeof response.text === 'function') {
    try {
      const rawBody = await response.text()
      if (rawBody) {
        try {
          const parsed = JSON.parse(rawBody)
          if (parsed?.error) return parsed.error
          if (parsed?.message) return parsed.message
        } catch {
          return rawBody
        }
      }
    } catch {
      // ignore parse failures and fall back below
    }
  }

  return formatSupabaseError(error, fallback)
}

function resolveTagColor(color, fallback) {
  if (!color) return fallback
  return tagColorMap[color] ?? color
}

function latestPrices(rows) {
  const seen = new Set()
  const result = []
  for (const row of rows) {
    if (row.source === 'holiday' || seen.has(row.ticker)) continue
    seen.add(row.ticker)
    result.push(row)
  }
  return result
}

function fxTickerForCurrency(currency) {
  if (!currency || currency === 'KRW') return null
  return `${currency}KRW=X`
}

function nativeToKrw(value, currency, latestPriceByTicker) {
  if (!Number.isFinite(value)) return 0
  const fxTicker = fxTickerForCurrency(currency)
  if (!fxTicker) return value
  const fxRate = latestPriceByTicker.get(fxTicker)?.close_price
  return Number.isFinite(fxRate) ? value * fxRate : 0
}

function effectiveKrwValue(row, latestPriceByTicker) {
  if (Number.isFinite(row?.market_value_krw)) return row.market_value_krw
  if (!Number.isFinite(row?.market_value_native)) return 0
  return nativeToKrw(row.market_value_native, row?.currency, latestPriceByTicker)
}

function matchesTagFilter(ticker, selectedTagId, tagMapByTicker) {
  if (selectedTagId === 'all') return true
  const tag = tagMapByTicker.get(ticker)
  if (selectedTagId === 'untagged') return !tag?.id
  return String(tag?.id ?? '') === selectedTagId
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function App() {
  const [session, setSession] = useState(null)
  const [authStatus, setAuthStatus] = useState('loading')
  const [activeTab, setActiveTab] = useState(() => tabFromHash())
  const [assetView, setAssetView] = useState(() => assetViewFromHash())
  const [loginMode, setLoginMode] = useState('owner')
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [accountModal, setAccountModal] = useState(null)
  const [accountSaving, setAccountSaving] = useState(false)
  const [accountError, setAccountError] = useState('')
  const [instrumentModal, setInstrumentModal] = useState(null)
  const [instrumentSaving, setInstrumentSaving] = useState(false)
  const [instrumentError, setInstrumentError] = useState('')
  const [holdingModal, setHoldingModal] = useState(null)
  const [holdingSaving, setHoldingSaving] = useState(false)
  const [holdingError, setHoldingError] = useState('')
  const [holdingLookupSaving, setHoldingLookupSaving] = useState(false)
  const [holdingLookupError, setHoldingLookupError] = useState('')
  const [holdingLookupResult, setHoldingLookupResult] = useState(null)
  const [tagModal, setTagModal] = useState(null)
  const [tagSaving, setTagSaving] = useState(false)
  const [tagError, setTagError] = useState('')
  const [syncingPrices, setSyncingPrices] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [viewerProfileSchemaReady, setViewerProfileSchemaReady] = useState(true)
  const [viewerProfileSaving, setViewerProfileSaving] = useState(false)
  const [viewerProfileError, setViewerProfileError] = useState('')
  const [viewerProfileMessage, setViewerProfileMessage] = useState('')
  const [viewerProfile, setViewerProfile] = useState(() => createViewerProfileDraft())
  const [viewerProfileDraft, setViewerProfileDraft] = useState(() => createViewerProfileDraft())
  const [guestUnlockDraft, setGuestUnlockDraft] = useState(() => createGuestUnlockDraft())
  const [guestUnlockSaving, setGuestUnlockSaving] = useState(false)
  const [guestUnlockError, setGuestUnlockError] = useState('')
  const [viewContext, setViewContext] = useState({
    mode: 'owner',
    ownerUserId: null,
    ownerPublicName: '',
  })
  const [accountTagFilter, setAccountTagFilter] = useState('all')
  const [instrumentTagFilter, setInstrumentTagFilter] = useState('all')
  const [state, setState] = useState({
    accounts: [],
    holdings: [],
    positions: [],
    instruments: [],
    tags: [],
    instrumentTags: [],
    prices: [],
  })
  const [loadError, setLoadError] = useState('')
  const menuRef = useRef(null)
  const isAnonymousSession = Boolean(session?.user?.is_anonymous)
  const canEdit = viewContext.mode === 'owner' && !isAnonymousSession
  const tabs = useMemo(
    () => allTabs.filter((tab) => canEdit || tab.id !== 'settings'),
    [canEdit],
  )

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthStatus('missing-config')
      return
    }

    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setAuthStatus(data.session ? 'signed-in' : 'signed-out')
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      setSession(nextSession)
      setAuthStatus(nextSession ? 'signed-in' : 'signed-out')
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return

    function handleClick(event) {
      if (!menuRef.current?.contains(event.target)) {
        setMenuOpen(false)
      }
    }

    function handleKeydown(event) {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeydown)
    }
  }, [menuOpen])

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#/, '').trim()
      const nextTab = tabFromHash()
      if (hash === 'accounts' || hash === 'instruments') {
        setAssetView(hash)
      }
      setActiveTab((current) => (current === nextTab ? current : nextTab))
    }

    window.addEventListener('hashchange', handleHashChange)
    handleHashChange()

    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [])

  useEffect(() => {
    const nextHash = `#${activeTab}`
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash)
    }
  }, [activeTab])

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab('overview')
    }
  }, [activeTab, tabs])

  async function refreshState() {
    setLoadError('')
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

    setState({
      accounts: results[0].data ?? [],
      holdings: results[1].data ?? [],
      positions: [],
      instruments: results[2].data ?? [],
      tags: results[3].data ?? [],
      instrumentTags: results[4].data ?? [],
      prices: latestPrices(results[5].data ?? []),
    })
  }

  async function loadActiveViewerAccess() {
    const { data, error } = await supabase.rpc('get_active_viewer_access')

    if (error) {
      if (isViewerSchemaMissingError(error)) {
        setViewerProfileSchemaReady(false)
        return null
      }
      throw error
    }

    return Array.isArray(data) ? data[0] ?? null : data
  }

  async function loadViewerProfile() {
    setViewerProfileError('')
    setViewerProfileMessage('')

    const { data, error } = await supabase
      .from('profiles')
      .select('public_name, sharing_enabled, viewer_password_updated_at')
      .limit(1)

    if (error) {
      if (isViewerSchemaMissingError(error)) {
        setViewerProfileSchemaReady(false)
        setViewerProfile(createViewerProfileDraft())
        setViewerProfileDraft(createViewerProfileDraft())
        return
      }
      throw error
    }

    setViewerProfileSchemaReady(true)
    const nextProfile = createViewerProfileDraft(Array.isArray(data) ? data[0] ?? null : data)
    setViewerProfile(nextProfile)
    setViewerProfileDraft(nextProfile)
  }

  useEffect(() => {
    if (!session) {
      setViewContext({
        mode: 'owner',
        ownerUserId: null,
        ownerPublicName: '',
      })
      setState({
        accounts: [],
        holdings: [],
        positions: [],
        instruments: [],
        tags: [],
        instrumentTags: [],
        prices: [],
      })
      setViewerProfile(createViewerProfileDraft())
      setViewerProfileDraft(createViewerProfileDraft())
      return
    }

    let cancelled = false

    async function bootstrapSession() {
      setLoadError('')

      if (session.user?.is_anonymous) {
        setViewerProfile(createViewerProfileDraft())
        setViewerProfileDraft(createViewerProfileDraft())
        const access = await loadActiveViewerAccess()
        if (cancelled) return

        if (!access?.owner_user_id) {
          setGuestUnlockError('')
          setViewContext({
            mode: 'guest',
            ownerUserId: null,
            ownerPublicName: '',
          })
          setState({
            accounts: [],
            holdings: [],
            positions: [],
            instruments: [],
            tags: [],
            instrumentTags: [],
            prices: [],
          })
          return
        }

        setViewContext({
          mode: 'shared',
          ownerUserId: access.owner_user_id,
          ownerPublicName: access.owner_public_name ?? '',
        })
        await refreshState()
        return
      }

      setViewContext({
        mode: 'owner',
        ownerUserId: session.user.id,
        ownerPublicName: '',
      })
      await Promise.all([refreshState(), loadViewerProfile()])
    }

    bootstrapSession().catch((error) => {
      if (!cancelled) {
        setLoadError(error.message ?? String(error))
      }
    })

    return () => {
      cancelled = true
    }
  }, [session])

  const latestPriceByTicker = useMemo(() => {
    return new Map(state.prices.map((row) => [row.ticker, row]))
  }, [state.prices])

  const computedPositions = useMemo(() => {
    const instrumentByTicker = new Map(state.instruments.map((instrument) => [instrument.ticker, instrument]))

    return state.holdings.map((holding) => {
      const instrument = holding.instruments ?? instrumentByTicker.get(holding.ticker) ?? null
      const latestPrice = latestPriceByTicker.get(holding.ticker)?.close_price
      const fallbackPrice = Number.isFinite(holding.avg_price) ? holding.avg_price : 0
      const marketPrice = Number.isFinite(latestPrice) ? latestPrice : fallbackPrice
      const quantity = Number(holding.quantity ?? 0)
      const avgPrice = Number(holding.avg_price ?? 0)
      const marketValueNative = quantity * marketPrice
      const costBasisNative = quantity * (Number.isFinite(avgPrice) ? avgPrice : 0)
      const marketValueKrw = nativeToKrw(marketValueNative, instrument?.currency ?? 'KRW', latestPriceByTicker)
      const costBasisKrw = nativeToKrw(costBasisNative, instrument?.currency ?? 'KRW', latestPriceByTicker)
      const priceChangePercent =
        Number.isFinite(latestPrice) && Number.isFinite(avgPrice) && avgPrice > 0
          ? ((latestPrice - avgPrice) / avgPrice) * 100
          : null

      return {
        ...holding,
        display_name: instrument?.display_name ?? holding.ticker,
        currency: instrument?.currency ?? 'KRW',
        instrument_type: instrument?.instrument_type ?? null,
        quantity,
        avgCost: Number.isFinite(avgPrice) ? avgPrice : null,
        cost_basis_native: costBasisNative,
        cost_basis_krw: costBasisKrw,
        latestPrice: Number.isFinite(latestPrice) ? latestPrice : null,
        market_value_native: marketValueNative,
        market_value_krw: marketValueKrw,
        priceChangePercent,
      }
    })
  }, [state.holdings, state.instruments, latestPriceByTicker])

  const totalValue = useMemo(
    () => computedPositions.reduce((sum, row) => sum + effectiveKrwValue(row, latestPriceByTicker), 0),
    [computedPositions, latestPriceByTicker],
  )

  const tagMapByTicker = useMemo(() => {
    const map = new Map()
    for (const row of state.instrumentTags) {
      if (!map.has(row.ticker) && row.tags) {
        map.set(row.ticker, row.tags)
      }
    }
    return map
  }, [state.instrumentTags])

  const holdingsByAccountId = useMemo(() => {
    const map = new Map()
    for (const row of computedPositions) {
      const items = map.get(row.account_id) ?? []
      items.push(row)
      map.set(row.account_id, items)
    }
    return map
  }, [computedPositions])

  const holdingsByTicker = useMemo(() => {
    const map = new Map()
    for (const row of computedPositions) {
      const items = map.get(row.ticker) ?? []
      items.push(row)
      map.set(row.ticker, items)
    }
    return map
  }, [computedPositions])

  const accountById = useMemo(() => {
    return new Map(state.accounts.map((account) => [account.id, account]))
  }, [state.accounts])

  const accountCards = useMemo(() => {
    return state.accounts
      .map((account) => {
        const rows = computedPositions.filter((pos) => pos.account_id === account.id)
        const marketValueKrw = rows.reduce(
          (sum, row) => sum + effectiveKrwValue(row, latestPriceByTicker),
          0,
        )
        const costBasisKrw = rows.reduce((sum, row) => sum + (row.cost_basis_krw ?? 0), 0)
        return {
          ...account,
          count: rows.length,
          market_value_krw: marketValueKrw,
          returnPercent:
            costBasisKrw > 0 ? ((marketValueKrw - costBasisKrw) / costBasisKrw) * 100 : null,
        }
      })
      .sort((a, b) => b.market_value_krw - a.market_value_krw)
  }, [state.accounts, computedPositions, latestPriceByTicker])

  const filteredAccountCards = useMemo(() => {
    if (accountTagFilter === 'all') return accountCards
    return accountCards.filter((account) => {
      const holdings = holdingsByAccountId.get(account.id) ?? []
      return holdings.some((holding) =>
        matchesTagFilter(holding.ticker, accountTagFilter, tagMapByTicker),
      )
    })
  }, [accountCards, accountTagFilter, holdingsByAccountId, tagMapByTicker])

  const instrumentRows = useMemo(() => {
    const aggregated = new Map()
    for (const pos of computedPositions) {
      const current = aggregated.get(pos.ticker) ?? {
        ticker: pos.ticker,
        display_name: pos.display_name,
        currency: pos.currency,
        quantity: 0,
        cost_basis_native: 0,
        market_value_native: 0,
        market_value_krw: 0,
        accounts: new Set(),
      }
      current.quantity += pos.quantity ?? 0
      current.cost_basis_native += (pos.quantity ?? 0) * (Number(pos.avg_price) || 0)
      current.market_value_native += pos.market_value_native ?? 0
      current.market_value_krw += effectiveKrwValue(pos, latestPriceByTicker)
      if (pos.account_id) current.accounts.add(pos.account_id)
      aggregated.set(pos.ticker, current)
    }

    return state.instruments
      .filter((item) => item.instrument_type !== 'fx')
      .map((instrument) => {
        const position = aggregated.get(instrument.ticker)
        const latestPrice = latestPriceByTicker.get(instrument.ticker)
        const tag = tagMapByTicker.get(instrument.ticker)
        const quantity = position?.quantity ?? 0
        const avgCost = quantity > 0 ? (position?.cost_basis_native ?? 0) / quantity : null
        const priceChangePercent =
          Number.isFinite(latestPrice?.close_price) && Number.isFinite(avgCost) && avgCost > 0
            ? ((latestPrice.close_price - avgCost) / avgCost) * 100
            : null
        return {
          ...instrument,
          tagId: tag?.id ? String(tag.id) : '',
          tagName: tag?.name ?? '태그 없음',
          quantity,
          avgCost,
          cost_basis_native: position?.cost_basis_native ?? 0,
          priceChangePercent,
          market_value_native: position?.market_value_native ?? 0,
          market_value_krw: position?.market_value_krw ?? 0,
          accountCount: position?.accounts.size ?? 0,
          latestPrice: latestPrice?.close_price ?? null,
          latestPriceDate: latestPrice?.price_date ?? '',
        }
      })
      .sort((a, b) => b.market_value_krw - a.market_value_krw || a.display_name.localeCompare(b.display_name))
  }, [state.instruments, computedPositions, latestPriceByTicker, tagMapByTicker])

  const filteredInstrumentRows = useMemo(() => {
    if (instrumentTagFilter === 'all') return instrumentRows
    if (instrumentTagFilter === 'untagged') {
      return instrumentRows.filter((instrument) =>
        matchesTagFilter(instrument.ticker, instrumentTagFilter, tagMapByTicker),
      )
    }
    return instrumentRows.filter((instrument) =>
      matchesTagFilter(instrument.ticker, instrumentTagFilter, tagMapByTicker),
    )
  }, [instrumentRows, instrumentTagFilter, tagMapByTicker])

  const tagCards = useMemo(() => {
    const rows = instrumentRows.filter((row) => (row.market_value_krw ?? 0) > 0)
    const byTag = new Map()
    for (const row of rows) {
      const tag = tagMapByTicker.get(row.ticker) ?? {
        id: 'untagged',
        name: '태그 없음',
        color: '#8a8e96',
      }
      const current = byTag.get(tag.id) ?? {
        ...tag,
        value: 0,
        costBasisKrw: 0,
        holdings: [],
      }
      current.value += row.market_value_krw ?? 0
      current.costBasisKrw += nativeToKrw(
        row.cost_basis_native ?? 0,
        row.currency,
        latestPriceByTicker,
      )
      current.holdings.push(row)
      byTag.set(tag.id, current)
    }

    return [...byTag.values()]
      .map((tag, index) => ({
        ...tag,
        color: resolveTagColor(tag.color, chartPalette[index % chartPalette.length]),
        returnPercent:
          tag.costBasisKrw > 0 ? ((tag.value - tag.costBasisKrw) / tag.costBasisKrw) * 100 : null,
        holdings: tag.holdings.sort((a, b) => b.market_value_krw - a.market_value_krw),
      }))
      .sort((a, b) => b.value - a.value)
  }, [instrumentRows, tagMapByTicker, latestPriceByTicker])

  const chartSlices = useMemo(() => {
    if (!totalValue) return []

    let cursor = 0
    return tagCards.map((tag, index) => {
      const value = Math.min((tag.value / totalValue) * 100, 100)
      const start = cursor
      const end = cursor + value
      cursor = end
      return {
        ...tag,
        start,
        end,
        color: tag.color || chartPalette[index % chartPalette.length],
      }
    })
  }, [tagCards, totalValue])

  const chartGradient = useMemo(() => {
    if (!chartSlices.length) return 'conic-gradient(#e7ddd2 0% 100%)'
    return `conic-gradient(${chartSlices
      .map((slice) => `${slice.color} ${slice.start}% ${slice.end}%`)
      .join(', ')})`
  }, [chartSlices])

  async function handleCopyMarkdown() {
    const lines = tagCards.flatMap((tag) => {
      const percent = totalValue > 0 ? (tag.value / totalValue) * 100 : NaN
      return [
        `## ${tag.name} · ${formatPercent(percent)}`,
        `${formatKrw(tag.value)} · ${tag.holdings.length}개 통합 종목 · 평균단가 대비 ${formatSignedPercent(tag.returnPercent)}`,
        '',
        ...tag.holdings.flatMap((holding) => {
          const holdingPercent =
            totalValue > 0 ? (holding.market_value_krw / totalValue) * 100 : NaN
          const converted =
            holding.currency !== 'KRW'
              ? ` (${formatKrw(holding.market_value_krw)} 환산)`
              : ''
          return [
            `### ${holding.ticker} · ${formatPercent(holdingPercent)} · ${formatSignedPercent(holding.priceChangePercent)}`,
            holding.display_name ?? holding.ticker,
            `${formatMoney(holding.market_value_native, holding.currency)}${converted}`,
            '',
          ]
        }),
      ]
    })

    await writeClipboard(lines.join('\n').trim())
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  function openAccountModal(account = null) {
    if (!canEdit) return
    setAccountError('')
    setAccountModal({
      id: account?.id ?? null,
      name: account?.name ?? '',
      broker: account?.broker ?? '',
      note: account?.note ?? '',
    })
  }

  function openInstrumentModal(instrument = null) {
    if (!canEdit) return
    const latestPrice = instrument?.ticker ? latestPriceByTicker.get(instrument.ticker) : null
    const tagId = instrument?.ticker ? tagMapByTicker.get(instrument.ticker)?.id ?? '' : ''
    setInstrumentError('')
    setInstrumentModal({
      id: instrument?.id ?? null,
      ticker: instrument?.ticker ?? '',
      display_name: instrument?.display_name ?? '',
      currency: instrument?.currency ?? 'KRW',
      instrument_type: instrument?.instrument_type ?? 'etf',
      price: latestPrice?.close_price?.toString?.() ?? '',
      price_date: latestPrice?.price_date ?? today(),
      tag_id: tagId ? String(tagId) : '',
      linked_account_id: '',
    })
  }

  function openHoldingModal({ holding = null, accountId = null, ticker = '' } = {}) {
    if (!canEdit) return
    setHoldingError('')
    setHoldingLookupError('')
    const initialTicker = normalizeTickerInput(holding?.ticker ?? ticker ?? '')
    const initialInstrument =
      state.instruments.find((item) => item.ticker === initialTicker) ?? holding?.instruments ?? null
    const initialLatestPrice = initialTicker ? latestPriceByTicker.get(initialTicker) : null
    setHoldingLookupResult(
      initialTicker
        ? {
            ticker: initialTicker,
            display_name: initialInstrument?.display_name ?? initialTicker,
            currency: initialInstrument?.currency ?? 'KRW',
            instrument_type: initialInstrument?.instrument_type ?? 'stock',
            price: Number.isFinite(initialLatestPrice?.close_price) ? initialLatestPrice.close_price : null,
            price_date: initialLatestPrice?.price_date ?? today(),
            source: initialInstrument ? 'existing' : 'manual',
          }
        : null,
    )
    setHoldingModal({
      id: holding?.id ?? null,
      account_id: String(holding?.account_id ?? accountId ?? ''),
      ticker: initialTicker,
      quantity: holding?.quantity?.toString?.() ?? '',
      avg_price: holding?.avg_price?.toString?.() ?? '',
      note: holding?.note ?? '',
    })
  }

  function openTagModal(tag = null) {
    if (!canEdit) return
    setTagError('')
    setTagModal({
      id: tag?.id ?? null,
      name: tag?.name ?? '',
      color: tag?.color ?? 'neutral',
      sort_order: String(tag?.sort_order ?? state.tags.length),
    })
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: authRedirectTo(),
      },
    })
  }

  async function signOut() {
    setGuestUnlockError('')
    setGuestUnlockDraft(createGuestUnlockDraft())
    setViewContext({
      mode: 'owner',
      ownerUserId: null,
      ownerPublicName: '',
    })
    await supabase.auth.signOut()
  }

  async function handleGuestUnlock() {
    setGuestUnlockSaving(true)
    setGuestUnlockError('')

    try {
      let nextSession = session

      if (!nextSession) {
        const { data, error } = await supabase.auth.signInAnonymously()
        if (error) throw error
        nextSession = data.session
        setSession(data.session ?? null)
        setAuthStatus(data.session ? 'signed-in' : 'signed-out')
      }

      if (!nextSession) {
        throw new Error('게스트 세션을 시작하지 못했습니다.')
      }

      const { data, error } = await supabase.rpc('unlock_viewer_access', {
        input_public_name: guestUnlockDraft.public_name,
        input_viewer_password: guestUnlockDraft.viewer_password,
      })

      if (error) throw error

      const access = Array.isArray(data) ? data[0] : data
      setViewContext({
        mode: 'shared',
        ownerUserId: access?.owner_user_id ?? null,
        ownerPublicName: access?.owner_public_name ?? guestUnlockDraft.public_name.trim(),
      })
      await refreshState()
      setGuestUnlockDraft(createGuestUnlockDraft())
    } catch (error) {
      if (error.code === 'anonymous_provider_disabled') {
        setGuestUnlockError(
          '친구 보기를 사용하려면 Supabase Auth의 anonymous sign-ins를 활성화해야 합니다.',
        )
      } else {
        setGuestUnlockError(formatSupabaseError(error, '공유 보기를 시작하지 못했습니다.'))
      }
    } finally {
      setGuestUnlockSaving(false)
    }
  }

  async function handleSaveAccount() {
    if (!canEdit) return
    if (!accountModal) return

    const payload = {
      name: accountModal.name.trim(),
      broker: accountModal.broker.trim() || null,
      note: accountModal.note.trim() || null,
      is_active: true,
    }

    if (!payload.name) {
      setAccountError('계좌명을 입력해주세요.')
      return
    }

    setAccountSaving(true)
    setAccountError('')
    const query = accountModal.id
      ? supabase.from('accounts').update(payload).eq('id', accountModal.id)
      : supabase.from('accounts').insert(payload)
    const { error } = await query
    setAccountSaving(false)

    if (error) {
      setAccountError(error.message)
      return
    }

    await refreshState()
    setAccountModal(null)
  }

  async function handleDeleteAccount() {
    if (!canEdit) return
    if (!accountModal?.id) return

    const holdingCount = holdingsByAccountId.get(accountModal.id)?.length ?? 0
    if (holdingCount > 0) {
      setAccountError('보유 종목이 있는 계좌는 아직 삭제할 수 없습니다. 먼저 보유를 정리해주세요.')
      return
    }

    if (!window.confirm('이 계좌를 삭제할까요?')) return

    setAccountSaving(true)
    setAccountError('')
    const { error } = await supabase.from('accounts').delete().eq('id', accountModal.id)
    setAccountSaving(false)

    if (error) {
      setAccountError(error.message)
      return
    }

    await refreshState()
    setAccountModal(null)
  }

  async function handleSaveInstrument() {
    if (!canEdit) return
    if (!instrumentModal) return
    const linkedAccountId = Number(instrumentModal.linked_account_id)
    const shouldOpenHoldingAfterSave = !instrumentModal.id && Number.isFinite(linkedAccountId) && linkedAccountId > 0

    const tickerValue = instrumentModal.ticker.trim()
    const payload = {
      ticker: tickerValue,
      display_name: instrumentModal.display_name.trim(),
      currency: instrumentModal.currency,
      instrument_type: instrumentModal.instrument_type,
      price_source: 'yfinance',
    }

    if (!payload.ticker || !payload.display_name) {
      setInstrumentError('티커와 종목명을 입력해주세요.')
      return
    }

    setInstrumentSaving(true)
    setInstrumentError('')
    const query = instrumentModal.id
      ? supabase.from('instruments').update(payload).eq('id', instrumentModal.id)
      : supabase.from('instruments').insert(payload)
    const { error } = await query

    if (error) {
      setInstrumentSaving(false)
      setInstrumentError(error.message)
      return
    }

    const priceValue = Number(instrumentModal.price)
    if (Number.isFinite(priceValue) && priceValue > 0) {
      const { error: priceError } = await supabase
        .from('holding_prices_daily')
        .upsert(
          {
            ticker: tickerValue,
            price_date: instrumentModal.price_date || today(),
            close_price: priceValue,
            source: 'manual',
          },
          { onConflict: 'user_id,ticker,price_date' },
        )
      if (priceError) {
        setInstrumentSaving(false)
        setInstrumentError(priceError.message)
        return
      }
    }

    const { error: deleteTagError } = await supabase
      .from('instrument_tags')
      .delete()
      .eq('ticker', tickerValue)
    if (deleteTagError) {
      setInstrumentSaving(false)
      setInstrumentError(deleteTagError.message)
      return
    }

    const tagId = Number(instrumentModal.tag_id)
    if (Number.isFinite(tagId) && tagId > 0) {
      const { error: tagError } = await supabase.from('instrument_tags').insert({
        ticker: tickerValue,
        tag_id: tagId,
      })
      if (tagError) {
        setInstrumentSaving(false)
        setInstrumentError(tagError.message)
        return
      }
    }

    setInstrumentSaving(false)
    await refreshState()
    setInstrumentModal(null)
    if (shouldOpenHoldingAfterSave) {
      openHoldingModal({ accountId: linkedAccountId, ticker: tickerValue })
    }
  }

  async function handleDeleteInstrument() {
    if (!canEdit) return
    if (!instrumentModal?.id || !instrumentModal?.ticker) return

    const holdingCount = holdingsByTicker.get(instrumentModal.ticker)?.length ?? 0
    if (holdingCount > 0) {
      setInstrumentError('보유 종목이 연결된 종목은 삭제할 수 없습니다. 먼저 보유를 정리해주세요.')
      return
    }

    if (!window.confirm('이 종목을 삭제할까요?')) return

    setInstrumentSaving(true)
    setInstrumentError('')
    const { error: tagError } = await supabase
      .from('instrument_tags')
      .delete()
      .eq('ticker', instrumentModal.ticker)
    if (tagError) {
      setInstrumentSaving(false)
      setInstrumentError(tagError.message)
      return
    }

    const { error } = await supabase.from('instruments').delete().eq('id', instrumentModal.id)
    setInstrumentSaving(false)
    if (error) {
      setInstrumentError(error.message)
      return
    }

    await refreshState()
    setInstrumentModal(null)
  }

  async function handleLookupHoldingTicker() {
    if (!canEdit) return
    if (!holdingModal) return

    const ticker = normalizeTickerInput(holdingModal.ticker)
    if (!ticker) {
      setHoldingLookupResult(null)
      setHoldingLookupError('티커를 먼저 입력해 주세요.')
      return
    }

    const existingInstrument = state.instruments.find((item) => item.ticker === ticker) ?? null
    const existingLatestPrice = latestPriceByTicker.get(ticker)
    if (existingInstrument) {
      setHoldingLookupError('')
      setHoldingLookupResult({
        ticker,
        display_name: existingInstrument.display_name ?? ticker,
        currency: existingInstrument.currency ?? 'KRW',
        instrument_type: existingInstrument.instrument_type ?? 'stock',
        price: Number.isFinite(existingLatestPrice?.close_price) ? existingLatestPrice.close_price : null,
        price_date: existingLatestPrice?.price_date ?? today(),
        source: 'existing',
      })
      setHoldingModal((current) => (current ? { ...current, ticker } : current))
      return
    }

    setHoldingLookupSaving(true)
    setHoldingLookupError('')
    setHoldingLookupResult(null)

    try {
      const { data, error } = await supabase.functions.invoke('lookup-ticker', {
        body: { ticker },
      })
      if (error) throw error
      if (!data?.ticker) {
        throw new Error('조회된 종목 정보가 없습니다.')
      }

      await refreshState()
      setHoldingLookupResult(data)
      setHoldingModal((current) => (current ? { ...current, ticker } : current))
    } catch (error) {
      setHoldingLookupError(await formatFunctionInvokeError(error, '티커 조회에 실패했습니다.'))
    } finally {
      setHoldingLookupSaving(false)
    }
  }

  async function handleSaveHolding() {
    if (!canEdit) return
    if (!holdingModal) return

    const normalizedTicker = normalizeTickerInput(holdingModal.ticker)
    const payload = {
      account_id: Number(holdingModal.account_id),
      ticker: normalizedTicker,
      quantity: Number(holdingModal.quantity),
      avg_price: Number(holdingModal.avg_price),
      note: holdingModal.note.trim() || null,
    }

    if (
      !payload.account_id ||
      !payload.ticker ||
      !Number.isFinite(payload.quantity) ||
      !Number.isFinite(payload.avg_price)
    ) {
      setHoldingError('계좌, 종목, 수량, 평균 단가를 입력해주세요.')
      return
    }

    setHoldingSaving(true)
    setHoldingError('')
    try {
      const existingInstrument = state.instruments.find((item) => item.ticker === normalizedTicker) ?? null
      if (!existingInstrument) {
        if (!holdingLookupResult || holdingLookupResult.ticker !== normalizedTicker) {
          throw new Error('새 티커는 먼저 조회한 뒤 추가해 주세요.')
        }
        await refreshState()
      }

      const query = holdingModal.id
        ? supabase.from('holdings').update(payload).eq('id', holdingModal.id)
        : supabase.from('holdings').upsert(payload, { onConflict: 'account_id,ticker' })
      const { error } = await query
      if (error) throw error

      await refreshState()
      setHoldingModal(null)
      setHoldingLookupResult(null)
      setHoldingLookupError('')
    } catch (error) {
      setHoldingError(error.message ?? '보유 저장에 실패했습니다.')
    } finally {
      setHoldingSaving(false)
    }
  }

  async function handleDeleteHolding() {
    if (!canEdit) return
    if (!holdingModal?.id) return
    if (!window.confirm('이 보유 항목을 삭제할까요?')) return

    setHoldingSaving(true)
    setHoldingError('')
    const { error } = await supabase.from('holdings').delete().eq('id', holdingModal.id)
    setHoldingSaving(false)

    if (error) {
      setHoldingError(error.message)
      return
    }

    await refreshState()
    setHoldingModal(null)
  }

  async function handleSaveTag() {
    if (!canEdit) return
    if (!tagModal) return

    const payload = {
      name: tagModal.name.trim(),
      color: tagModal.color,
      sort_order: Number(tagModal.sort_order) || 0,
    }
    if (!payload.name) {
      setTagError('태그명을 입력해주세요.')
      return
    }

    setTagSaving(true)
    setTagError('')
    const query = tagModal.id
      ? supabase.from('tags').update(payload).eq('id', tagModal.id)
      : supabase.from('tags').insert(payload)
    const { error } = await query
    setTagSaving(false)
    if (error) {
      setTagError(error.message)
      return
    }

    await refreshState()
    setTagModal(null)
  }

  async function handleSyncPrices() {
    if (!canEdit) return
    setSyncingPrices(true)
    setSyncMessage('')
    try {
      const { error } = await supabase.functions.invoke('sync-prices', { body: {} })
      if (error) throw error
      await refreshState()
      setSyncMessage('가격 동기화를 완료했습니다.')
    } catch (error) {
      setSyncMessage(error.message ?? '가격 동기화에 실패했습니다.')
    } finally {
      setSyncingPrices(false)
    }
  }

  async function handleSaveViewerProfile() {
    if (!canEdit) return
    setViewerProfileSaving(true)
    setViewerProfileError('')
    setViewerProfileMessage('')

    try {
      const trimmedPublicName = viewerProfileDraft.public_name.trim()
      const trimmedPassword = viewerProfileDraft.viewer_password.trim()

      if (viewerProfileDraft.sharing_enabled && !trimmedPublicName) {
        throw new Error('공개 이름은 공유 활성화 시 필수입니다.')
      }

      if (trimmedPassword && trimmedPassword.length < 4) {
        throw new Error('보기 전용 비밀번호는 4자 이상이어야 합니다.')
      }

      if (
        viewerProfileDraft.sharing_enabled &&
        !trimmedPassword &&
        !viewerProfile.viewer_password_updated_at
      ) {
        throw new Error('공유를 켜려면 보기 전용 비밀번호를 먼저 입력해주세요.')
      }

      const payload = {
        user_id: session.user.id,
        public_name: trimmedPublicName || null,
        public_name_normalized: trimmedPublicName ? trimmedPublicName.toLowerCase() : null,
        sharing_enabled: Boolean(viewerProfileDraft.sharing_enabled),
      }

      if (trimmedPassword) {
        payload.viewer_password_hash = await sha256Hex(trimmedPassword)
        payload.viewer_password_updated_at = new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'user_id' })
        .select('public_name, sharing_enabled, viewer_password_updated_at')
        .limit(1)

      if (error) throw error

      const nextProfile = createViewerProfileDraft(Array.isArray(data) ? data[0] : data)
      setViewerProfileSchemaReady(true)
      setViewerProfile(nextProfile)
      setViewerProfileDraft(nextProfile)
      setViewerProfileMessage(
        viewerProfileDraft.viewer_password
          ? '공유 보기 설정을 저장했고, 기존 보기 세션도 새 비밀번호 기준으로 갱신됩니다.'
          : '공유 보기 설정을 저장했습니다.',
      )
    } catch (error) {
      if (isViewerSchemaMissingError(error)) {
        setViewerProfileSchemaReady(false)
        setViewerProfileError(
          formatSupabaseError(error, '공유 보기 설정을 불러오는 중 데이터베이스 오류가 발생했습니다.'),
        )
      } else {
        setViewerProfileError(error.message ?? '공유 보기 설정을 저장하지 못했습니다.')
      }
    } finally {
      setViewerProfileSaving(false)
    }
  }

  if (authStatus === 'loading') {
    return <CenteredMessage title="로딩 중" body="세션을 확인하고 있습니다." />
  }

  if (authStatus === 'missing-config') {
    return (
      <CenteredMessage
        title="Supabase 설정이 필요합니다"
        body="VITE_SUPABASE_URL과 VITE_SUPABASE_ANON_KEY를 설정해주세요."
      />
    )
  }

  if (!session) {
    return (
      <LoginScreen
        guestUnlockDraft={guestUnlockDraft}
        guestUnlockError={guestUnlockError}
        guestUnlockSaving={guestUnlockSaving}
        loginMode={loginMode}
        onGuestUnlock={handleGuestUnlock}
        onGuestUnlockChange={(field, value) => {
          setGuestUnlockError('')
          setGuestUnlockDraft((current) => ({ ...current, [field]: value }))
        }}
        onLoginModeChange={setLoginMode}
        onSignInWithGoogle={signInWithGoogle}
      />
    )
  }

  if (isAnonymousSession && viewContext.mode === 'guest') {
    return (
      <GuestUnlockScreen
        guestUnlockDraft={guestUnlockDraft}
        guestUnlockError={guestUnlockError}
        guestUnlockSaving={guestUnlockSaving}
        onExit={signOut}
        onGuestUnlock={handleGuestUnlock}
        onGuestUnlockChange={(field, value) => {
          setGuestUnlockError('')
          setGuestUnlockDraft((current) => ({ ...current, [field]: value }))
        }}
      />
    )
  }

  

  const pageTitle = activeTab === 'overview' ? '자산' : '설정'

  return (
    <main className="min-h-screen px-4 py-5 text-[var(--ink)] sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="relative mb-6" ref={menuRef}>
          <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] pb-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
                {viewContext.mode === 'shared' ? 'Shared View' : 'Portfolio'}
              </p>
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold">{pageTitle}</h1>
                {viewContext.mode === 'shared' && (
                  <p className="mt-1 text-sm text-[var(--muted-ink)]">
                    {`${viewContext.ownerPublicName || '공유 포트폴리오'} 읽기 전용 보기`}
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                aria-expanded={menuOpen}
                aria-label="메뉴 열기"
                className="inline-flex h-12 w-12 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink)]"
                onClick={() => setMenuOpen((open) => !open)}
                type="button"
              >
                <span className="h-0.5 w-4 rounded-full bg-current" />
                <span className="h-0.5 w-4 rounded-full bg-current" />
                <span className="h-0.5 w-4 rounded-full bg-current" />
              </button>
            </div>
          </div>
          {menuOpen && (
            <nav className="absolute right-0 top-[calc(100%+10px)] z-10 grid min-w-40 gap-1 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] p-1.5 shadow-2xl shadow-black/40 backdrop-blur">
              {tabs.map((tab) => (
                <button
                  className={`rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                    activeTab === tab.id
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--muted-ink)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'
                  }`}
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id)
                    setMenuOpen(false)
                  }}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
              <button
                className="rounded-xl px-3 py-2.5 text-left text-sm font-medium text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                onClick={signOut}
                type="button"
              >
                로그아웃
              </button>
            </nav>
          )}
        </header>

        {loadError && (
          <div className="mt-6 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
            {loadError}
          </div>
        )}

        {activeTab === 'overview' && (
          <AssetsPage
            accountTagFilter={accountTagFilter}
            accountById={accountById}
            accounts={filteredAccountCards}
            assetView={assetView}
            canEdit={canEdit}
            copied={copied}
            holdingsByAccountId={holdingsByAccountId}
            holdingsByTicker={holdingsByTicker}
            instrumentTagFilter={instrumentTagFilter}
            instruments={filteredInstrumentRows}
            onAssetViewChange={setAssetView}
            onCopy={handleCopyMarkdown}
            onCreateAccount={() => openAccountModal()}
            onCreateHolding={(ticker) => openHoldingModal({ ticker })}
            onCreateInstrument={() => openInstrumentModal()}
            onCreateHoldingForAccount={(accountId) => openHoldingModal({ accountId })}
            onEditAccount={(account) => openAccountModal(account)}
            onEditHolding={(holding) => openHoldingModal({ holding })}
            onEditInstrument={(instrument) => openInstrumentModal(instrument)}
            onAccountTagFilterChange={setAccountTagFilter}
            onInstrumentTagFilterChange={setInstrumentTagFilter}
            pieGradient={chartGradient}
            slices={chartSlices}
            tagCards={tagCards}
            tagMapByTicker={tagMapByTicker}
            tags={state.tags}
            totalValue={totalValue}
          />
        )}
        {activeTab === 'settings' && (
          <SettingsPage
            onCreateTag={() => openTagModal()}
            onEditTag={(tag) => openTagModal(tag)}
            onSyncPrices={handleSyncPrices}
            onViewerProfileChange={(field, value) => {
              setViewerProfileError('')
              setViewerProfileMessage('')
              setViewerProfileDraft((current) => ({ ...current, [field]: value }))
            }}
            onViewerProfileSave={handleSaveViewerProfile}
            syncingPrices={syncingPrices}
            syncMessage={syncMessage}
            tags={state.tags}
            viewerProfile={viewerProfile}
            viewerProfileDraft={viewerProfileDraft}
            viewerProfileError={viewerProfileError}
            viewerProfileMessage={viewerProfileMessage}
            viewerProfileSaving={viewerProfileSaving}
            viewerProfileSchemaReady={viewerProfileSchemaReady}
          />
        )}

        {accountModal && (
          <AccountEditorModal
            accountError={accountError}
            accountSaving={accountSaving}
            draft={accountModal}
            onChange={(field, value) => {
              setAccountError('')
              setAccountModal((current) => ({ ...current, [field]: value }))
            }}
            onClose={() => {
              if (!accountSaving) {
                setAccountError('')
                setAccountModal(null)
              }
            }}
            onDelete={handleDeleteAccount}
            onSave={handleSaveAccount}
          />
        )}

        {instrumentModal && (
          <InstrumentEditorModal
            accounts={state.accounts}
            draft={instrumentModal}
            instrumentError={instrumentError}
            instrumentSaving={instrumentSaving}
            onChange={(field, value) => {
              setInstrumentError('')
              setInstrumentModal((current) => ({ ...current, [field]: value }))
            }}
            onClose={() => {
              if (!instrumentSaving) {
                setInstrumentError('')
                setInstrumentModal(null)
              }
            }}
            onDelete={handleDeleteInstrument}
            onSave={handleSaveInstrument}
            tags={state.tags}
          />
        )}

        {holdingModal && (
          <HoldingEditorModal
            accounts={state.accounts}
            draft={holdingModal}
            holdingError={holdingError}
            holdingLookupError={holdingLookupError}
            holdingLookupResult={holdingLookupResult}
            holdingLookupSaving={holdingLookupSaving}
            holdingSaving={holdingSaving}
            instruments={state.instruments.filter((item) => item.instrument_type !== 'fx')}
            onChange={(field, value) => {
              setHoldingError('')
              setHoldingLookupError('')
              if (field === 'ticker') {
                setHoldingLookupResult((current) =>
                  current?.ticker === normalizeTickerInput(value) ? current : null,
                )
              }
              setHoldingModal((current) => ({ ...current, [field]: value }))
            }}
            onClose={() => {
              if (!holdingSaving) {
                setHoldingError('')
                setHoldingLookupError('')
                setHoldingLookupResult(null)
                setHoldingModal(null)
              }
            }}
            onLookupTicker={handleLookupHoldingTicker}
            onDelete={handleDeleteHolding}
            onSave={handleSaveHolding}
          />
        )}

        {tagModal && (
          <TagEditorModal
            draft={tagModal}
            onChange={(field, value) => {
              setTagError('')
              setTagModal((current) => ({ ...current, [field]: value }))
            }}
            onClose={() => {
              if (!tagSaving) {
                setTagError('')
                setTagModal(null)
              }
            }}
            onSave={handleSaveTag}
            tagError={tagError}
            tagSaving={tagSaving}
          />
        )}
      </div>
    </main>
  )
}

function AssetsPage({
  accountTagFilter,
  accountById,
  accounts,
  assetView,
  canEdit,
  copied,
  holdingsByAccountId,
  holdingsByTicker,
  instrumentTagFilter,
  instruments,
  onAccountTagFilterChange,
  onAssetViewChange,
  onCopy,
  onCreateAccount,
  onCreateHolding,
  onCreateHoldingForAccount,
  onCreateInstrument,
  onEditAccount,
  onEditHolding,
  onEditInstrument,
  onInstrumentTagFilterChange,
  pieGradient,
  slices,
  tagCards,
  tagMapByTicker,
  tags,
  totalValue,
}) {
  const subviewAction =
    assetView === 'tags' ? (
      <button
        className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-white transition hover:brightness-95 sm:px-4 ${
          copied
            ? 'bg-[rgba(255,255,255,0.22)]'
            : 'bg-[var(--accent)]'
        }`}
        onClick={onCopy}
        type="button"
      >
        <CopyIcon />
        {copied ? '복사됨' : '복사'}
      </button>
    ) : assetView === 'accounts' ? (
      <TagActionToolbar
        buttonLabel={canEdit ? '계좌 추가' : ''}
        className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"
        onAction={canEdit ? onCreateAccount : undefined}
        onTagFilterChange={onAccountTagFilterChange}
        selectedTagId={accountTagFilter}
        selectClassName="w-full sm:w-44 lg:w-52"
        tags={tags}
      />
    ) : assetView === 'instruments' ? (
      <TagActionToolbar
        buttonLabel={canEdit ? '보유 추가' : ''}
        className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"
        onAction={canEdit ? () => onCreateHolding() : undefined}
        onTagFilterChange={onInstrumentTagFilterChange}
        selectedTagId={instrumentTagFilter}
        selectClassName="w-full sm:w-44 lg:w-52"
        tags={tags}
      />
    ) : null

  return (
    <section className="mt-8 grid gap-5">
      <div className="flex flex-col gap-3 border-b border-[var(--line)] pb-4 md:flex-row md:items-center md:justify-between">
        <div className="grid grid-cols-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-1">
          {assetViewOptions.map((option) => (
            <button
              className={`min-h-10 rounded-xl px-2 text-xs font-semibold transition sm:min-h-11 sm:px-3 sm:text-sm ${
                assetView === option.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--muted-ink)] hover:bg-[var(--surface-3)] hover:text-[var(--ink)]'
              }`}
              key={option.id}
              onClick={() => onAssetViewChange(option.id)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        {subviewAction}
      </div>

      {assetView === 'tags' && (
        <Overview
          cards={tagCards}
          pieGradient={pieGradient}
          slices={slices}
          totalValue={totalValue}
        />
      )}

      {assetView === 'accounts' && (
        <AccountsPage
          accounts={accounts}
          canEdit={canEdit}
          holdingsByAccountId={holdingsByAccountId}
          onCreateAccount={onCreateAccount}
          onCreateHolding={onCreateHoldingForAccount}
          onEditAccount={onEditAccount}
          onEditHolding={onEditHolding}
          onTagFilterChange={onAccountTagFilterChange}
          selectedTagId={accountTagFilter}
          tagMapByTicker={tagMapByTicker}
          tags={tags}
          totalValue={totalValue}
        />
      )}

      {assetView === 'instruments' && (
        <InstrumentsPage
          canEdit={canEdit}
          accountById={accountById}
          holdingsByTicker={holdingsByTicker}
          instruments={instruments}
          onCreateHolding={onCreateHolding}
          onCreateInstrument={onCreateInstrument}
          onEditHolding={onEditHolding}
          onEditInstrument={onEditInstrument}
          onTagFilterChange={onInstrumentTagFilterChange}
          selectedTagId={instrumentTagFilter}
          tags={tags}
          totalValue={totalValue}
        />
      )}
    </section>
  )
}

function Overview({ cards, pieGradient, slices, totalValue }) {
  if (!cards.length) {
    return (
      <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--shadow-soft)]">
        <h2 className="text-lg font-semibold">자산</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted-ink)]">
          아직 보유 항목이 없습니다. 계좌와 종목을 만든 뒤 보유 수량을 넣으면 태그 비중이
          여기서 보입니다.
        </p>
      </section>
    )
  }

  return (
    <section className="grid gap-3">
      <div className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-soft)]">
        <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:items-start">
          <div className="grid justify-items-center gap-4 lg:justify-items-start">
            <div className="flex aspect-square w-[clamp(220px,62vw,340px)] max-w-full items-center justify-center rounded-full bg-[var(--surface-2)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] lg:w-full">
              <div
                className="relative aspect-square w-[82%] rounded-full"
                style={{ backgroundImage: pieGradient }}
              >
                <div className="absolute inset-[16%] grid place-items-center rounded-full bg-[var(--panel)] text-center shadow-[0_10px_30px_rgba(0,0,0,0.28)]">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-ink)]">
                      Total
                    </div>
                    <div className="mt-1 text-sm font-semibold">{formatKrw(totalValue)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid min-w-0 gap-0">
            {cards.map((card) => {
              const percent = totalValue > 0 ? (card.value / totalValue) * 100 : NaN
              return (
                <div
                  className="border-b border-[var(--line)] py-3 last:border-b-0"
                  key={card.id}
                >
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 rounded-full"
                      style={{ backgroundColor: card.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-semibold text-[var(--ink)]">
                          {card.name}
                        </span>
                        <span className="shrink-0 text-sm font-semibold text-[var(--accent)]">
                          {formatPercent(percent)}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.05)]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            backgroundColor: card.color,
                            width: `${Math.max(0, Math.min(Number.isFinite(percent) ? percent : 0, 100))}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {cards.map((card) => (
          <article
            className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-soft)]"
            key={card.id}
          >
            <div className="relative border-b border-[var(--line)] bg-[rgba(255,255,255,0.045)] px-5 pb-5 pt-6 shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)]">
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1"
                style={{ backgroundColor: card.color }}
              />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ backgroundColor: card.color }}
                    />
                    <h2 className="text-base font-semibold">{card.name}</h2>
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted-ink)]">
                    {card.holdings.length}개 통합 종목
                  </p>
                </div>
                <strong className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-sm font-semibold text-[var(--accent)]">
                  {formatPercent(totalValue > 0 ? (card.value / totalValue) * 100 : NaN)}
                </strong>
              </div>

              <MetricSummary
                avgCostText="-"
                currentPriceText="-"
                returnPercent={card.returnPercent}
                valueText={formatKrw(card.value)}
              />
            </div>

            {!!card.holdings.length && (
              <div className="px-5 py-4">
                <CardSectionLabel count={card.holdings.length} label="종목 목록" />
                <div className="mt-2 divide-y divide-[var(--line)]">
                {card.holdings.map((holding) => (
                  <div className="py-3 first:pt-0 last:pb-0" key={holding.ticker}>
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-5">
                      <span className="font-semibold text-[var(--ink)]">
                        {holding.display_name ?? holding.ticker}
                      </span>
                      <span className="font-medium text-[var(--muted-ink)]">{holding.ticker}</span>
                    </div>
                    <MetricSummary
                      avgCostText={Number.isFinite(holding.avgCost)
                        ? formatMoney(holding.avgCost, holding.currency)
                        : '-'}
                      currentPriceText={holding.latestPrice != null
                        ? formatMoney(holding.latestPrice, holding.currency)
                        : '-'}
                      returnPercent={holding.priceChangePercent}
                      showPriceMetrics={hasComparablePriceMetrics(holding)}
                      valueText={formattedValueWithConversion(
                        holding.market_value_native,
                        holding.currency,
                        holding.market_value_krw,
                      )}
                    />
                  </div>
                ))}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

function MetricSummary({
  avgCostText = '-',
  currentPriceText = '-',
  returnPercent,
  showPriceMetrics = true,
  valueText,
}) {
  return (
    <div className="mt-2 grid gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm leading-5 text-[var(--muted-ink)]">평가금</span>
        <span className="text-sm font-semibold leading-5 text-[var(--ink)]">{valueText}</span>
      </div>
      {showPriceMetrics && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm leading-5 text-[var(--muted-ink)]">
          <MetricInline label="평균가" value={avgCostText} />
          <MetricInline
            accentText={formatSignedPercent(returnPercent)}
            accentToneClass={returnToneClass(returnPercent)}
            label="현재가"
            value={currentPriceText}
          />
        </div>
      )}
    </div>
  )
}

function MetricInline({ accentText = null, accentToneClass = '', label, value }) {
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap text-sm leading-5">
      <span className="text-[var(--muted-ink)]">{label}</span>{' '}
      <span className="font-semibold text-[var(--ink)]">{value}</span>
      {accentText && (
        <span className="ml-2 inline-flex items-baseline gap-1">
          <span className="text-[var(--muted-ink)]">등락</span>
          <span className={`font-semibold ${accentToneClass}`}>{accentText}</span>
        </span>
      )}
    </span>
  )
}

function CardSectionLabel({ count, label }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] pb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="h-4 w-1 rounded-full bg-[var(--accent)]" />
        <span>{label}</span>
      </span>
      <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[var(--ink)]">
        {count}
      </span>
    </div>
  )
}

function TagActionToolbar({
  buttonLabel,
  className,
  onAction,
  onTagFilterChange,
  selectedTagId,
  selectClassName,
  tags,
}) {
  return (
    <div className={className}>
      <label className="min-w-0 flex-1 sm:flex-none">
        <span className="sr-only">태그 필터</span>
        <select
          className={`h-10 min-w-0 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.03)] px-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)] ${selectClassName}`}
          onChange={(event) => onTagFilterChange(event.target.value)}
          value={selectedTagId}
        >
          <option value="all">전체 태그</option>
          {tags.map((tag) => (
            <option key={tag.id} value={String(tag.id)}>
              {tag.name}
            </option>
          ))}
          <option value="untagged">태그 없음</option>
        </select>
      </label>
      {buttonLabel && onAction && (
        <button
          className="h-10 shrink-0 rounded-xl bg-[var(--accent)] px-3 text-sm font-semibold text-white transition hover:brightness-95 sm:px-4"
          onClick={onAction}
          type="button"
        >
          {buttonLabel}
        </button>
      )}
    </div>
  )
}

function AccountsPage({
  accounts,
  canEdit,
  holdingsByAccountId,
  onCreateAccount,
  onCreateHolding,
  onEditAccount,
  onEditHolding,
  onTagFilterChange,
  selectedTagId,
  tagMapByTicker,
  tags,
  totalValue,
}) {
  return (
    <section className="grid gap-3">
      {!accounts.length && (
        <div className="rounded-[24px] border border-[var(--line)] bg-[var(--panel)] p-5 text-sm leading-6 text-[var(--muted-ink)] shadow-[var(--shadow-soft)]">
          선택한 태그에 해당하는 계좌가 없습니다.
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {accounts.map((account) => {
          const allHoldings = holdingsByAccountId.get(account.id) ?? []
          const holdings = allHoldings.filter((holding) =>
            matchesTagFilter(holding.ticker, selectedTagId, tagMapByTicker),
          )
          return (
            <article
              className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-soft)]"
              key={account.id}
            >
            <div className="relative border-b border-[var(--line)] bg-[rgba(255,255,255,0.045)] px-5 pb-5 pt-6 shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)]">
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1 bg-[var(--accent)]"
              />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">{account.name}</h2>
                  <p className="mt-1 text-sm text-[var(--muted-ink)]">
                    {account.broker || '증권사 없음'} · {account.count}개 보유
                  </p>
                  {account.note && (
                    <p className="mt-2 text-sm text-[var(--muted-ink)]">{account.note}</p>
                  )}
                </div>
                {canEdit && (
                  <button
                    aria-label="계좌 편집"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                    onClick={() => onEditAccount(account)}
                    type="button"
                  >
                    <PencilIcon />
                  </button>
                )}
              </div>

              <MetricSummary
                avgCostText="-"
                currentPriceText="-"
                returnPercent={account.returnPercent}
                valueText={formatKrw(account.market_value_krw)}
              />
            </div>

            {!!holdings.length && (
              <div className="px-5 py-4">
                <CardSectionLabel count={holdings.length} label="보유 목록" />
                <div className="mt-2 divide-y divide-[var(--line)]">
                {holdings.map((holding) => (
                  <div className="py-3 first:pt-0 last:pb-0" key={holding.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-5">
                          <span className="font-semibold text-[var(--ink)]">
                            {holding.instruments?.display_name ?? holding.ticker}
                          </span>
                          <span className="font-medium text-[var(--muted-ink)]">{holding.ticker}</span>
                        </div>
                        <MetricSummary
                          avgCostText={Number.isFinite(holding.avgCost)
                            ? formatMoney(holding.avgCost, holding.currency)
                            : '-'}
                          currentPriceText={holding.latestPrice != null
                            ? formatMoney(holding.latestPrice, holding.currency)
                            : '-'}
                          returnPercent={holding.priceChangePercent}
                          showPriceMetrics={hasComparablePriceMetrics(holding)}
                          valueText={formattedValueWithConversion(
                            holding.market_value_native,
                            holding.currency,
                            holding.market_value_krw,
                          )}
                        />
                      </div>
                      {canEdit && (
                        <button
                          aria-label="보유 편집"
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] text-[var(--muted-ink)] transition hover:bg-[var(--panel)] hover:text-[var(--ink)]"
                          onClick={() => onEditHolding(holding)}
                          type="button"
                        >
                          <PencilIcon />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                </div>
              </div>
            )}

            {canEdit && (
              <div className="flex justify-end border-t border-[var(--line)] bg-[rgba(255,255,255,0.025)] px-5 py-3">
                <button
                  className="rounded-2xl border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                  onClick={() => onCreateHolding(account.id)}
                  type="button"
                >
                이 계좌에 보유 추가
                </button>
              </div>
            )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function InstrumentsPage({
  accountById,
  canEdit,
  holdingsByTicker,
  instruments,
  onCreateHolding,
  onCreateInstrument,
  onEditHolding,
  onEditInstrument,
  onTagFilterChange,
  selectedTagId,
  tags,
  totalValue,
}) {
  return (
    <section className="grid gap-3">
      {!instruments.length && (
        <div className="rounded-[24px] border border-[var(--line)] bg-[var(--panel)] p-5 text-sm leading-6 text-[var(--muted-ink)] shadow-[var(--shadow-soft)]">
          선택한 태그에 해당하는 종목이 없습니다.
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {instruments.map((instrument) => {
          const linkedHoldings = holdingsByTicker.get(instrument.ticker) ?? []
          return (
            <article
              className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-soft)]"
              key={instrument.ticker}
            >
            <div className="relative border-b border-[var(--line)] bg-[rgba(255,255,255,0.045)] px-5 pb-5 pt-6 shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)]">
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1 bg-[var(--accent)]"
              />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-[var(--line)] bg-[var(--surface-3)] px-2.5 py-1 text-xs font-semibold text-[var(--ink)]">
                      {instrument.ticker}
                    </span>
                    <span className="text-sm font-semibold text-[var(--accent)]">
                      {instrument.tagName}
                    </span>
                    <span className="text-sm text-[var(--muted-ink)]">{instrument.currency}</span>
                  </div>
                  <h2 className="mt-3 text-base font-semibold leading-6">{instrument.display_name}</h2>
                  <p className="mt-1 text-sm text-[var(--muted-ink)]">
                    {instrument.accountCount}개 계좌 · 수량 {formatNumber(instrument.quantity)}
                  </p>
                </div>
                {canEdit && (
                  <button
                    aria-label="종목 편집"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                    onClick={() => onEditInstrument(instrument)}
                    type="button"
                  >
                    <PencilIcon />
                  </button>
                )}
              </div>

              <MetricSummary
                avgCostText={Number.isFinite(instrument.avgCost)
                  ? formatMoney(instrument.avgCost, instrument.currency)
                  : '-'}
                currentPriceText={instrument.latestPrice != null
                  ? formatMoney(instrument.latestPrice, instrument.currency)
                  : '-'}
                returnPercent={instrument.priceChangePercent}
                showPriceMetrics={hasComparablePriceMetrics(instrument)}
                valueText={formattedValueWithConversion(
                  instrument.market_value_native,
                  instrument.currency,
                  instrument.market_value_krw,
                )}
              />
            </div>

            {!!linkedHoldings.length && (
              <div className="px-5 py-4">
                <CardSectionLabel count={linkedHoldings.length} label="계좌별 보유" />
                <div className="mt-2 divide-y divide-[var(--line)]">
                {linkedHoldings.map((holding) => {
                  const account = accountById.get(holding.account_id)
                  const accountName = account?.name ?? `계좌 ${holding.account_id}`
                  return (
                  <div className="py-3 first:pt-0 last:pb-0" key={holding.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-5">
                          <span className="font-semibold text-[var(--ink)]">{accountName}</span>
                          <span className="font-medium text-[var(--muted-ink)]">{holding.ticker}</span>
                        </div>
                        <MetricSummary
                          avgCostText={Number.isFinite(holding.avgCost)
                            ? formatMoney(holding.avgCost, holding.currency)
                            : '-'}
                          currentPriceText={holding.latestPrice != null
                            ? formatMoney(holding.latestPrice, holding.currency)
                            : '-'}
                          returnPercent={holding.priceChangePercent}
                          showPriceMetrics={hasComparablePriceMetrics(holding)}
                          valueText={formattedValueWithConversion(
                            holding.market_value_native,
                            holding.currency,
                            holding.market_value_krw,
                          )}
                        />
                      </div>
                      {canEdit && (
                        <button
                          aria-label="보유 편집"
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] text-[var(--muted-ink)] transition hover:bg-[var(--panel)] hover:text-[var(--ink)]"
                          onClick={() => onEditHolding(holding)}
                          type="button"
                        >
                          <PencilIcon />
                        </button>
                      )}
                    </div>
                  </div>
                  )
                })}
                </div>
              </div>
            )}

            {canEdit && (
              <div className="flex justify-end border-t border-[var(--line)] bg-[rgba(255,255,255,0.025)] px-5 py-3">
                <button
                  className="rounded-2xl border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                  onClick={() => onCreateHolding(instrument.ticker)}
                  type="button"
                >
                이 종목 보유 추가
                </button>
              </div>
            )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function SettingsPage({
  onCreateTag,
  onEditTag,
  onSyncPrices,
  onViewerProfileChange,
  onViewerProfileSave,
  syncingPrices,
  syncMessage,
  tags,
  viewerProfile,
  viewerProfileDraft,
  viewerProfileError,
  viewerProfileMessage,
  viewerProfileSaving,
  viewerProfileSchemaReady,
}) {
  return (
    <section className="mt-8 grid gap-5">
      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{'공유 보기'}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">
              {'친구가 공개 이름과 보기 전용 비밀번호로 내 포트폴리오를 읽기 전용으로 볼 수 있게 합니다.'}
            </p>
          </div>
          <button
            className="rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!viewerProfileSchemaReady || viewerProfileSaving}
            onClick={onViewerProfileSave}
            type="button"
          >
            {viewerProfileSaving ? '저장 중' : '공유 설정 저장'}
          </button>
        </div>

        {!viewerProfileSchemaReady ? (
          <div className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {'공유 보기 기능용 데이터베이스 마이그레이션이 아직 적용되지 않았습니다. Supabase migration 적용 후 다시 사용할 수 있어요.'}
          </div>
        ) : (
          <div className="mt-5 grid gap-4">
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
                {'공개 이름'}
              </span>
              <input
                className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
                onChange={(event) => onViewerProfileChange('public_name', event.target.value)}
                placeholder="예: yongin-portfolio"
                value={viewerProfileDraft.public_name}
              />
            </label>

            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
                {'보기 전용 비밀번호'}
              </span>
              <input
                className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
                onChange={(event) => onViewerProfileChange('viewer_password', event.target.value)}
                placeholder={
                  viewerProfile.viewer_password_updated_at ? '변경할 때만 입력' : '최소 4자 이상'
                }
                type="password"
                value={viewerProfileDraft.viewer_password}
              />
            </label>

            <label className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-[var(--ink)]">{'공유 보기 활성화'}</p>
                <p className="mt-1 text-sm text-[var(--muted-ink)]">
                  {'켜면 친구가 검색 이름과 비밀번호로 들어와서 자산/계좌/종목을 읽기 전용으로 볼 수 있습니다.'}
                </p>
              </div>
              <button
                aria-pressed={viewerProfileDraft.sharing_enabled}
                className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border transition ${
                  viewerProfileDraft.sharing_enabled
                    ? 'border-[var(--accent)] bg-[var(--accent)]'
                    : 'border-[var(--line)] bg-[var(--surface-3)]'
                }`}
                onClick={() =>
                  onViewerProfileChange('sharing_enabled', !viewerProfileDraft.sharing_enabled)
                }
                type="button"
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
                    viewerProfileDraft.sharing_enabled ? 'left-6' : 'left-1'
                  }`}
                />
              </button>
            </label>

            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--muted-ink)]">
              <p>
                {'현재 상태: '}
                <span className="font-semibold text-[var(--ink)]">
                  {viewerProfile.sharing_enabled ? '활성화됨' : '비활성화됨'}
                </span>
              </p>
              <p className="mt-2">
                {'저장 후에는 비밀번호를 다시 보여주지 않습니다. 바꾸고 싶을 때만 새 비밀번호를 입력하면 됩니다.'}
              </p>
            </div>
          </div>
        )}

        {viewerProfileError && (
          <div className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {viewerProfileError}
          </div>
        )}

        {viewerProfileMessage && (
          <div className="mt-4 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {viewerProfileMessage}
          </div>
        )}
      </article>

      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">가격 동기화</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">
              서버 함수에서 최신 가격을 가져와 보유 평가 금액을 갱신합니다.
            </p>
          </div>
          <button
            className="rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={syncingPrices}
            onClick={onSyncPrices}
            type="button"
          >
            {syncingPrices ? '동기화 중' : '가격 동기화'}
          </button>
        </div>
        {syncMessage && (
          <p className="mt-4 rounded-2xl bg-[var(--surface-2)] px-3 py-3 text-sm text-[var(--muted-ink)]">
            {syncMessage}
          </p>
        )}
      </article>

      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">태그 관리</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">
              종목 하나당 대표 태그 하나만 연결됩니다. 여기서 이름, 색상, 정렬 순서를 관리합니다.
            </p>
          </div>
          <button
            className="rounded-2xl border border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            onClick={onCreateTag}
            type="button"
          >
            태그 추가
          </button>
        </div>
        <div className="mt-4 grid gap-2">
          {tags.map((tag) => (
            <button
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-3 text-left transition hover:bg-[var(--surface-2)]"
              key={tag.id}
              onClick={() => onEditTag(tag)}
              type="button"
            >
              <span
                className="h-3.5 w-3.5 rounded-full"
                style={{ backgroundColor: tagColorMap[tag.color] ?? tag.color ?? '#8a8e96' }}
              />
              <span className="min-w-0 text-sm font-medium">{tag.name}</span>
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
                {tag.sort_order}
              </span>
            </button>
          ))}
        </div>
      </article>

      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
        <h2 className="text-lg font-semibold">가져오기</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">
          React 버전에서는 예전 CSV 일괄 가져오기 화면을 노출하지 않습니다. 핵심 워크플로우는
          계좌, 종목, 보유 수량을 직접 관리하는 흐름으로 단순화했습니다.
        </p>
      </article>
    </section>
  )
}

function LoginScreen({
  guestUnlockDraft,
  guestUnlockError,
  guestUnlockSaving,
  loginMode,
  onGuestUnlock,
  onGuestUnlockChange,
  onLoginModeChange,
  onSignInWithGoogle,
}) {
  return (
    <main className="min-h-screen px-5 py-8 text-[var(--ink)]">
      <section className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-sm content-center gap-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            Portfolio
          </p>
          <h1 className="mt-3 text-4xl font-semibold text-[var(--ink)]">{'포트폴리오'}</h1>
          <p className="mt-4 text-sm leading-6 text-[var(--muted-ink)]">
            {'여러 계좌에 흩어진 보유 종목을 한 화면에서 통합해서 보고, 태그 기준 비중까지 빠르게 확인합니다.'}
          </p>
        </div>

        <div className="grid gap-3 rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)]">
          <div className="flex rounded-2xl bg-[var(--surface-2)] p-1">
            <button
              className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${
                loginMode === 'owner' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted-ink)]'
              }`}
              onClick={() => onLoginModeChange('owner')}
              type="button"
            >
              {'내 계정'}
            </button>
            <button
              className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${
                loginMode === 'guest' ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted-ink)]'
              }`}
              onClick={() => onLoginModeChange('guest')}
              type="button"
            >
              {'친구 보기'}
            </button>
          </div>

          {loginMode === 'owner' ? (
            <button
              className="rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95"
              onClick={onSignInWithGoogle}
              type="button"
            >
              {'Google로 로그인'}
            </button>
          ) : (
            <GuestUnlockForm
              error={guestUnlockError}
              onChange={onGuestUnlockChange}
              onSubmit={onGuestUnlock}
              saving={guestUnlockSaving}
              value={guestUnlockDraft}
            />
          )}
        </div>
      </section>
    </main>
  )
}

function GuestUnlockScreen({
  guestUnlockDraft,
  guestUnlockError,
  guestUnlockSaving,
  onExit,
  onGuestUnlock,
  onGuestUnlockChange,
}) {
  return (
    <main className="min-h-screen px-5 py-8 text-[var(--ink)]">
      <section className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-sm content-center gap-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            Shared View
          </p>
          <h1 className="mt-3 text-4xl font-semibold text-[var(--ink)]">{'친구 포트폴리오 보기'}</h1>
          <p className="mt-4 text-sm leading-6 text-[var(--muted-ink)]">
            {'공개 이름과 보기 전용 비밀번호를 입력하면 읽기 전용으로 자산 현황을 볼 수 있어요.'}
          </p>
        </div>

        <div className="grid gap-3 rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)]">
          <GuestUnlockForm
            error={guestUnlockError}
            onChange={onGuestUnlockChange}
            onSubmit={onGuestUnlock}
            saving={guestUnlockSaving}
            value={guestUnlockDraft}
          />
          <button
            className="rounded-2xl border border-[var(--line)] px-4 py-3 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            onClick={onExit}
            type="button"
          >
            {'나가기'}
          </button>
        </div>
      </section>
    </main>
  )
}

function GuestUnlockForm({ error, onChange, onSubmit, saving, value }) {
  return (
    <div className="grid gap-3">
      <input
        className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
        onChange={(event) => onChange('public_name', event.target.value)}
        placeholder="공개 이름"
        value={value.public_name}
      />
      <input
        className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
        onChange={(event) => onChange('viewer_password', event.target.value)}
        placeholder="보기 전용 비밀번호"
        type="password"
        value={value.viewer_password}
      />
      {error && (
        <div className="rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}
      <button
        className="rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={saving}
        onClick={onSubmit}
        type="button"
      >
        {saving ? '입장 중' : '친구 포트폴리오 보기'}
      </button>
    </div>
  )
}

function CenteredMessage({ title, body }) {
  return (
    <main className="grid min-h-screen content-center px-5">
      <section className="mx-auto max-w-sm rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 text-[var(--ink)] shadow-[var(--shadow-soft)]">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted-ink)]">{body}</p>
      </section>
    </main>
  )
}

function AccountEditorModal({
  accountError,
  accountSaving,
  draft,
  onChange,
  onClose,
  onDelete,
  onSave,
}) {
  return (
    <ModalShell onClose={onClose} title={draft.id ? draft.name || '계좌 수정' : '계좌 추가'}>
      <div className="grid gap-4">
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            계좌명
          </span>
          <input
            className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('name', event.target.value)}
            value={draft.name}
          />
        </label>

        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            증권사
          </span>
          <input
            className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('broker', event.target.value)}
            value={draft.broker}
          />
        </label>

        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            메모
          </span>
          <textarea
            className="min-h-24 w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('note', event.target.value)}
            value={draft.note}
          />
        </label>

        {accountError && (
          <div className="rounded-2xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {accountError}
          </div>
        )}

        <ModalActions
          canDelete={!!draft.id}
          deleteLabel="계좌 삭제"
          disabled={accountSaving}
          onClose={onClose}
          onDelete={onDelete}
          onSave={onSave}
          saveLabel={accountSaving ? '저장 중' : '저장'}
        />
      </div>
    </ModalShell>
  )
}

function InstrumentEditorModal({
  accounts,
  draft,
  instrumentError,
  instrumentSaving,
  onChange,
  onClose,
  onDelete,
  onSave,
  tags,
}) {
  return (
    <ModalShell onClose={onClose} title={draft.id ? '종목 수정' : '종목 추가'}>
      <div className="grid gap-4">
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            티커
          </span>
          <input
            className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:bg-black/30"
            disabled={!!draft.id}
            onChange={(event) => onChange('ticker', event.target.value.trim().toUpperCase())}
            value={draft.ticker}
          />
        </label>

        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            종목명
          </span>
          <input
            className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('display_name', event.target.value)}
            value={draft.display_name}
          />
        </label>

        {!draft.id && (
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              보유 계좌
            </span>
            <select
              className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('linked_account_id', event.target.value)}
              value={draft.linked_account_id}
            >
              <option value="">나중에 연결</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              통화
            </span>
            <select
              className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('currency', event.target.value)}
              value={draft.currency}
            >
              {['KRW', 'USD', 'JPY'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              종류
            </span>
            <select
              className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('instrument_type', event.target.value)}
              value={draft.instrument_type}
            >
              {['stock', 'etf', 'fund', 'cash', 'other', 'fx'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              현재가
            </span>
            <input
              className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('price', event.target.value)}
              step="any"
              type="number"
              value={draft.price}
            />
          </label>

          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              가격일
            </span>
            <input
              className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('price_date', event.target.value)}
              type="date"
              value={draft.price_date}
            />
          </label>
        </div>

        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            대표 태그
          </span>
          <select
            className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('tag_id', event.target.value)}
            value={draft.tag_id}
          >
            <option value="">태그 없음</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>

        {instrumentError && (
          <div className="rounded-2xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {instrumentError}
          </div>
        )}

        <ModalActions
          canDelete={!!draft.id}
          deleteLabel="종목 삭제"
          disabled={instrumentSaving}
          onClose={onClose}
          onDelete={onDelete}
          onSave={onSave}
          saveLabel={instrumentSaving ? '저장 중' : '저장'}
        />
      </div>
    </ModalShell>
  )
}

function HoldingEditorModal({
  accounts,
  draft,
  holdingError,
  holdingLookupError,
  holdingLookupResult,
  holdingLookupSaving,
  holdingSaving,
  instruments,
  onChange,
  onClose,
  onLookupTicker,
  onDelete,
  onSave,
}) {
  const [tickerMenuOpen, setTickerMenuOpen] = useState(false)
  const tickerMenuRef = useRef(null)
  const suggestedInstruments = draft.ticker
    ? instruments
        .filter((instrument) => {
          const query = normalizeTickerInput(draft.ticker)
          const ticker = normalizeTickerInput(instrument.ticker)
          const name = normalizeTickerInput(instrument.display_name)
          return ticker.includes(query) || name.includes(query)
        })
        .slice(0, 6)
    : instruments.slice(0, 6)

  useEffect(() => {
    function handleClickOutside(event) {
      if (!tickerMenuRef.current?.contains(event.target)) {
        setTickerMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <ModalShell onClose={onClose} title={draft.id ? '보유 수정' : '보유 종목 추가'}>
      <div className="grid gap-4">
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            계좌
          </span>
          <select
            className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('account_id', event.target.value)}
            value={draft.account_id}
          >
            <option value="">계좌 선택</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            티커
          </span>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1" ref={tickerMenuRef}>
              <div className="flex min-w-0 items-center rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] pr-2 focus-within:border-[var(--accent)]">
                <input
                  className="min-w-0 flex-1 bg-transparent px-3 py-3 outline-none"
                  autoComplete="off"
                  onChange={(event) => {
                    onChange('ticker', normalizeTickerInput(event.target.value))
                    setTickerMenuOpen(true)
                  }}
                  onFocus={() => setTickerMenuOpen(true)}
                  placeholder="예: AAPL, 360750, JPYKRW=X"
                  value={draft.ticker}
                />
                <button
                  aria-label="티커 목록 열기"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                  onClick={() => setTickerMenuOpen((current) => !current)}
                  type="button"
                >
                  <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <path
                      d="m6 9 6 6 6-6"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.8"
                    />
                  </svg>
                </button>
              </div>
              {tickerMenuOpen && !!suggestedInstruments.length && (
                <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-2xl border border-[var(--line)] bg-[#1b1d23] shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
                  {suggestedInstruments.map((instrument) => (
                    <button
                      className="flex w-full items-center justify-between gap-3 border-b border-[var(--line)] px-3 py-2.5 text-left text-sm transition hover:bg-[var(--surface-3)] last:border-b-0"
                      key={instrument.ticker}
                      onClick={() => {
                        onChange('ticker', instrument.ticker)
                        setTickerMenuOpen(false)
                      }}
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-[var(--ink)]">
                          {instrument.display_name}
                        </span>
                        <span className="block truncate text-[var(--muted-ink)]">{instrument.ticker}</span>
                      </span>
                      <span className="shrink-0 text-xs font-medium text-[var(--muted-ink)]">
                        {instrument.currency}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className="shrink-0 rounded-2xl border border-[var(--line)] px-3 py-2.5 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={holdingSaving || holdingLookupSaving}
              onClick={onLookupTicker}
              type="button"
            >
              {holdingLookupSaving ? '조회 중' : '조회'}
            </button>
          </div>
        </div>

        {holdingLookupResult && (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold text-[var(--ink)]">{holdingLookupResult.display_name}</span>
              <span className="text-[var(--muted-ink)]">{holdingLookupResult.ticker}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--muted-ink)]">
              <span>통화 {holdingLookupResult.currency}</span>
              <span>종류 {holdingLookupResult.instrument_type}</span>
              {Number.isFinite(holdingLookupResult.price) && (
                <span>
                  현재가 {formatMoney(holdingLookupResult.price, holdingLookupResult.currency)}
                </span>
              )}
            </div>
          </div>
        )}

        {holdingLookupError && (
          <div className="rounded-2xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {holdingLookupError}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              수량
            </span>
            <input
              className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('quantity', event.target.value)}
              step="any"
              type="number"
              value={draft.quantity}
            />
          </label>

          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              평균 단가
            </span>
            <input
              className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('avg_price', event.target.value)}
              step="any"
              type="number"
              value={draft.avg_price}
            />
          </label>
        </div>

        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            메모
          </span>
          <textarea
            className="min-h-24 w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('note', event.target.value)}
            value={draft.note}
          />
        </label>

        {holdingError && (
          <div className="rounded-2xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {holdingError}
          </div>
        )}

        <ModalActions
          canDelete={!!draft.id}
          deleteLabel="보유 삭제"
          disabled={holdingSaving}
          onClose={onClose}
          onDelete={onDelete}
          onSave={onSave}
          saveLabel={holdingSaving ? '저장 중' : '저장'}
        />
      </div>
    </ModalShell>
  )
}

function TagEditorModal({ draft, onChange, onClose, onSave, tagError, tagSaving }) {
  return (
    <ModalShell onClose={onClose} title={draft.id ? '태그 수정' : '태그 추가'}>
      <div className="grid gap-4">
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            태그명
          </span>
          <input
            className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('name', event.target.value)}
            value={draft.name}
          />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              색상
            </span>
            <select
              className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('color', event.target.value)}
              value={draft.color}
            >
              {tagColorOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              순서
            </span>
            <input
              className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('sort_order', event.target.value)}
              type="number"
              value={draft.sort_order}
            />
          </label>
        </div>

        {tagError && (
          <div className="rounded-2xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {tagError}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            className="rounded-2xl border border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={tagSaving}
            onClick={onClose}
            type="button"
          >
            닫기
          </button>
          <button
            className="rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={tagSaving}
            onClick={onSave}
            type="button"
          >
            {tagSaving ? '저장 중' : '저장'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

function ModalActions({
  canDelete,
  deleteLabel,
  disabled,
  onClose,
  onDelete,
  onSave,
  saveLabel,
}) {
  return (
    <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap sm:justify-between">
      <div className="sm:flex-1">
        {canDelete && (
          <button
            className="w-full rounded-2xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-400 transition hover:bg-red-950/20 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            disabled={disabled}
            onClick={onDelete}
            type="button"
          >
            {deleteLabel}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:grid-cols-none">
        <button
          className="rounded-2xl border border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onClick={onClose}
          type="button"
        >
          닫기
        </button>
        <button
          className="rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onClick={onSave}
          type="button"
        >
          {saveLabel}
        </button>
      </div>
    </div>
  )
}

function ModalShell({ children, onClose, title }) {
  useEffect(() => {
    function handleKeydown(event) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-30 bg-[rgba(13,14,18,0.96)] sm:bg-[rgba(71,49,28,0.18)] sm:px-6 sm:py-8 sm:backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-2xl min-w-0 items-start justify-center sm:h-auto">
        <section className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-[var(--panel)] sm:h-auto sm:max-h-[calc(100vh-4rem)] sm:rounded-[30px] sm:border sm:border-[var(--line)] sm:shadow-[0_30px_70px_rgba(0,0,0,0.45)]">
          <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] bg-[var(--panel)] px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:border-b-0 sm:px-6 sm:pb-0 sm:pt-6">
            <h2 className="pt-1 text-xl font-semibold">{title}</h2>
            <button
              aria-label="닫기"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted-ink)] transition hover:text-[var(--ink)]"
              onClick={onClose}
              type="button"
            >
              <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                <path
                  d="M6 6l12 12M18 6 6 18"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.8"
                />
              </svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:max-h-[calc(100vh-10rem)] sm:flex-none sm:px-6 sm:pb-5 sm:pt-5">
            {children}
          </div>
        </section>
      </div>
    </div>
  )
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <rect height="10" rx="2" stroke="currentColor" strokeWidth="1.8" width="10" x="8" y="8" />
      <path
        d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
      <path
        d="M4 20h4l10-10a2 2 0 0 0-4-4L4 16v4Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path d="m12.5 7.5 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  )
}

export default App
