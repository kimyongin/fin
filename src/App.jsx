import { useEffect, useMemo, useRef, useState } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const allTabs = [
  { id: 'overview', label: '자산' },
  { id: 'accounts', label: '계좌' },
  { id: 'instruments', label: '종목' },
  { id: 'settings', label: '설정' },
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

function formatKrw(value) {
  return Number.isFinite(value) ? KRW.format(Math.round(value)) : '-'
}

function formatMoney(value, currency = 'KRW') {
  if (!Number.isFinite(value)) return '-'
  if (currency === 'USD') return USD.format(value)
  return formatKrw(value)
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '-'
}

function formatNumber(value) {
  return Number.isFinite(value)
    ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })
    : '-'
}

function authRedirectTo() {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

function tabFromHash() {
  if (typeof window === 'undefined') return 'overview'
  const hash = window.location.hash.replace(/^#/, '').trim()
  return tabIds.has(hash) ? hash : 'overview'
}

function today() {
  return new Date().toISOString().slice(0, 10)
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

function effectiveKrwValue(row, latestPriceByTicker) {
  if (Number.isFinite(row?.market_value_krw)) return row.market_value_krw
  if (!Number.isFinite(row?.market_value_native)) return 0
  const fxTicker = fxTickerForCurrency(row?.currency)
  if (!fxTicker) return row.market_value_native
  const fxRate = latestPriceByTicker.get(fxTicker)?.close_price
  return Number.isFinite(fxRate) ? row.market_value_native * fxRate : 0
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
      const nextTab = tabFromHash()
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
      const marketValueNative = quantity * marketPrice

      return {
        ...holding,
        display_name: instrument?.display_name ?? holding.ticker,
        currency: instrument?.currency ?? 'KRW',
        instrument_type: instrument?.instrument_type ?? null,
        quantity,
        market_value_native: marketValueNative,
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
    for (const row of state.holdings) {
      const items = map.get(row.account_id) ?? []
      items.push(row)
      map.set(row.account_id, items)
    }
    return map
  }, [state.holdings])

  const holdingsByTicker = useMemo(() => {
    const map = new Map()
    for (const row of state.holdings) {
      const items = map.get(row.ticker) ?? []
      items.push(row)
      map.set(row.ticker, items)
    }
    return map
  }, [state.holdings])

  const accountCards = useMemo(() => {
    return state.accounts
      .map((account) => {
        const rows = computedPositions.filter((pos) => pos.account_id === account.id)
        return {
          ...account,
          count: rows.length,
          market_value_krw: rows.reduce(
            (sum, row) => sum + effectiveKrwValue(row, latestPriceByTicker),
            0,
          ),
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
        market_value_native: 0,
        market_value_krw: 0,
        accounts: new Set(),
      }
      current.quantity += pos.quantity ?? 0
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
        return {
          ...instrument,
          tagId: tag?.id ? String(tag.id) : '',
          tagName: tag?.name ?? '태그 없음',
          quantity: position?.quantity ?? 0,
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
        holdings: [],
      }
      current.value += row.market_value_krw ?? 0
      current.holdings.push(row)
      byTag.set(tag.id, current)
    }

    return [...byTag.values()]
      .map((tag, index) => ({
        ...tag,
        color: resolveTagColor(tag.color, chartPalette[index % chartPalette.length]),
        holdings: tag.holdings.sort((a, b) => b.market_value_krw - a.market_value_krw),
      }))
      .sort((a, b) => b.value - a.value)
  }, [instrumentRows, tagMapByTicker])

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
        `${formatKrw(tag.value)} · ${tag.holdings.length}개 통합 종목`,
        '',
        ...tag.holdings.flatMap((holding) => {
          const holdingPercent =
            totalValue > 0 ? (holding.market_value_krw / totalValue) * 100 : NaN
          const converted =
            holding.currency !== 'KRW'
              ? ` (${formatKrw(holding.market_value_krw)} 환산)`
              : ''
          return [
            `### ${holding.ticker} · ${formatPercent(holdingPercent)}`,
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
    })
  }

  function openHoldingModal({ holding = null, accountId = null, ticker = '' } = {}) {
    if (!canEdit) return
    setHoldingError('')
    setHoldingModal({
      id: holding?.id ?? null,
      account_id: String(holding?.account_id ?? accountId ?? ''),
      ticker: holding?.ticker ?? ticker ?? '',
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

  async function handleSaveHolding() {
    if (!canEdit) return
    if (!holdingModal) return

    const payload = {
      account_id: Number(holdingModal.account_id),
      ticker: holdingModal.ticker,
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
    const query = holdingModal.id
      ? supabase.from('holdings').update(payload).eq('id', holdingModal.id)
      : supabase.from('holdings').upsert(payload, { onConflict: 'account_id,ticker' })
    const { error } = await query
    setHoldingSaving(false)

    if (error) {
      setHoldingError(error.message)
      return
    }

    await refreshState()
    setHoldingModal(null)
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

  

  const pageTitle =
    activeTab === 'overview'
      ? '자산'
      : activeTab === 'accounts'
        ? '계좌'
        : activeTab === 'instruments'
          ? '종목'
          : '설정'

  const headerAction =
    activeTab === 'accounts' ? (
      <TagActionToolbar
        buttonLabel="계좌 추가"
        className="hidden min-w-0 items-center gap-2 md:flex"
        onAction={() => openAccountModal()}
        onTagFilterChange={setAccountTagFilter}
        selectedTagId={accountTagFilter}
        selectClassName="w-44 lg:w-56"
        tags={state.tags}
      />
    ) : activeTab === 'instruments' ? (
      <TagActionToolbar
        buttonLabel="종목 추가"
        className="hidden min-w-0 items-center gap-2 md:flex"
        onAction={() => openInstrumentModal()}
        onTagFilterChange={setInstrumentTagFilter}
        selectedTagId={instrumentTagFilter}
        selectClassName="w-44 lg:w-56"
        tags={state.tags}
      />
    ) : null

  const readonlyHeaderAction =
    activeTab === 'accounts' ? (
      <TagActionToolbar
        buttonLabel=""
        className="hidden min-w-0 items-center gap-2 md:flex"
        onAction={undefined}
        onTagFilterChange={setAccountTagFilter}
        selectedTagId={accountTagFilter}
        selectClassName="w-44 lg:w-56"
        tags={state.tags}
      />
    ) : activeTab === 'instruments' ? (
      <TagActionToolbar
        buttonLabel=""
        className="hidden min-w-0 items-center gap-2 md:flex"
        onAction={undefined}
        onTagFilterChange={setInstrumentTagFilter}
        selectedTagId={instrumentTagFilter}
        selectClassName="w-44 lg:w-56"
        tags={state.tags}
      />
    ) : null

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
              {canEdit ? headerAction : readonlyHeaderAction}
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
          <Overview
            cards={tagCards}
            copied={copied}
            onCopy={handleCopyMarkdown}
            pieGradient={chartGradient}
            slices={chartSlices}
            totalValue={totalValue}
          />
        )}
        {activeTab === 'accounts' && (
          <AccountsPage
            accounts={filteredAccountCards}
            canEdit={canEdit}
            holdingsByAccountId={holdingsByAccountId}
            onCreateAccount={() => openAccountModal()}
            onCreateHolding={(accountId) => openHoldingModal({ accountId })}
            onEditAccount={(account) => openAccountModal(account)}
            onEditHolding={(holding) => openHoldingModal({ holding })}
            onTagFilterChange={setAccountTagFilter}
            selectedTagId={accountTagFilter}
            tagMapByTicker={tagMapByTicker}
            tags={state.tags}
            totalValue={totalValue}
          />
        )}
        {activeTab === 'instruments' && (
          <InstrumentsPage
            canEdit={canEdit}
            holdingsByTicker={holdingsByTicker}
            instruments={filteredInstrumentRows}
            onCreateHolding={(ticker) => openHoldingModal({ ticker })}
            onCreateInstrument={() => openInstrumentModal()}
            onEditHolding={(holding) => openHoldingModal({ holding })}
            onEditInstrument={(instrument) => openInstrumentModal(instrument)}
            onTagFilterChange={setInstrumentTagFilter}
            selectedTagId={instrumentTagFilter}
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
            holdingSaving={holdingSaving}
            instruments={state.instruments.filter((item) => item.instrument_type !== 'fx')}
            onChange={(field, value) => {
              setHoldingError('')
              setHoldingModal((current) => ({ ...current, [field]: value }))
            }}
            onClose={() => {
              if (!holdingSaving) {
                setHoldingError('')
                setHoldingModal(null)
              }
            }}
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

function Overview({ cards, copied, onCopy, pieGradient, slices, totalValue }) {
  if (!cards.length) {
    return (
      <section className="mt-8 rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--shadow-soft)]">
        <h2 className="text-lg font-semibold">자산</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted-ink)]">
          아직 보유 항목이 없습니다. 계좌와 종목을 만든 뒤 보유 수량을 넣으면 태그 비중이
          여기서 보입니다.
        </p>
      </section>
    )
  }

  return (
    <section className="mt-8 grid gap-6">
      <div className="grid gap-4 rounded-[32px] border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)] sm:p-5 lg:p-6">
        <div className="grid gap-4">
          <div className="grid gap-3 sm:flex sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold">태그 비중</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-[var(--muted-ink)]">
                각 종목은 하나의 대표 태그만 기준으로 잡습니다. 그래서 태그 비중 합계는 전체
                자산 100%와 맞습니다.
              </p>
            </div>
            <button
              className={`inline-flex h-10 w-fit items-center gap-2 rounded-2xl border px-3 text-sm font-medium transition sm:h-11 ${
                copied
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted-ink)] hover:text-[var(--ink)]'
              }`}
              onClick={onCopy}
              type="button"
            >
              <CopyIcon />
              {copied ? '복사됨' : '복사'}
            </button>
          </div>

          <div className="grid items-center gap-4 rounded-[28px] bg-[var(--surface-2)] p-4 md:grid-cols-[200px_minmax(0,1fr)]">
            <div className="mx-auto flex h-[190px] w-[190px] items-center justify-center rounded-full bg-[var(--surface-3)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] sm:h-[210px] sm:w-[210px]">
              <div
                className="relative h-[162px] w-[162px] rounded-full sm:h-[180px] sm:w-[180px]"
                style={{ backgroundImage: pieGradient }}
              >
                <div className="absolute inset-[24px] grid place-items-center rounded-full bg-[var(--panel)] text-center shadow-[0_10px_30px_rgba(0,0,0,0.28)]">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-ink)]">
                      Total
                    </div>
                    <div className="mt-2 text-base font-semibold sm:text-lg">{formatKrw(totalValue)}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-2.5">
              {slices.map((slice) => (
                <div
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-[var(--panel)] px-3 py-2.5"
                  key={slice.id}
                >
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-3.5 rounded-full"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="min-w-0 truncate text-sm font-medium">{slice.name}</span>
                  <span className="text-sm font-semibold text-[var(--accent)]">
                    {formatPercent(totalValue > 0 ? (slice.value / totalValue) * 100 : NaN)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <article
            className="grid min-h-[320px] content-start gap-4 rounded-[28px] border border-[var(--line)] bg-[var(--surface-2)] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.22)]"
            key={card.id}
            style={{ borderTop: `4px solid ${card.color}` }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">{card.name}</h3>
                <p className="mt-2 text-2xl font-semibold">{formatKrw(card.value)}</p>
              </div>
              <strong className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-sm font-semibold text-[var(--accent)]">
                {formatPercent(totalValue > 0 ? (card.value / totalValue) * 100 : NaN)}
              </strong>
            </div>
            <p className="text-sm text-[var(--muted-ink)]">{card.holdings.length}개 통합 종목</p>
            <div className="grid gap-3">
              {card.holdings.map((holding) => (
                <article
                  className="rounded-[22px] border border-[var(--line)] bg-[var(--panel)] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
                  key={holding.ticker}
                >
                  <div className="text-sm font-semibold text-[var(--muted-ink)]">
                    [{holding.ticker}] ·{' '}
                    {formatPercent(
                      totalValue > 0 ? (holding.market_value_krw / totalValue) * 100 : NaN,
                    )}
                  </div>
                  <div className="mt-2 text-[15px] font-medium leading-6 text-[var(--ink)] break-words">
                    {holding.display_name ?? holding.ticker}
                  </div>
                  <div className="mt-3 text-sm font-semibold text-[var(--ink)]">
                    {formatMoney(holding.market_value_native, holding.currency)}
                    {holding.currency !== 'KRW' && (
                      <span className="ml-1 font-medium text-[var(--muted-ink)]">
                        ({formatKrw(holding.market_value_krw)} 환산)
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
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
      <label className="min-w-0 flex-1 md:flex-none">
        <span className="sr-only">태그 필터</span>
        <select
          className={`h-11 min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)] ${selectClassName}`}
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
          className="h-11 shrink-0 rounded-2xl bg-[var(--accent)] px-3 text-sm font-semibold text-white transition hover:brightness-95 sm:px-4"
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
    <section className="mt-8 grid gap-3">
      <TagActionToolbar
        buttonLabel="계좌 추가"
        className="flex items-center gap-2 rounded-[24px] border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[var(--shadow-soft)] md:hidden"
        onAction={canEdit ? onCreateAccount : undefined}
        onTagFilterChange={onTagFilterChange}
        selectedTagId={selectedTagId}
        selectClassName="w-full"
        tags={tags}
      />
      {!accounts.length && (
        <div className="rounded-[24px] border border-[var(--line)] bg-[var(--panel)] p-5 text-sm leading-6 text-[var(--muted-ink)] shadow-[var(--shadow-soft)]">
          선택한 태그에 해당하는 계좌가 없습니다.
        </div>
      )}
      {accounts.map((account) => {
        const allHoldings = holdingsByAccountId.get(account.id) ?? []
        const holdings = allHoldings.filter((holding) =>
          matchesTagFilter(holding.ticker, selectedTagId, tagMapByTicker),
        )
        return (
          <article
            className="rounded-[24px] border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)]"
            key={account.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold">{account.name}</h2>
                <p className="mt-1 text-sm text-[var(--muted-ink)]">
                  {account.broker || '증권사 없음'} · {account.count}개 보유
                </p>
                {account.note && (
                  <p className="mt-2 text-sm text-[var(--muted-ink)]">{account.note}</p>
                )}
                <p className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted-ink)]">
                  보유 레코드 {holdings.length}
                </p>
              </div>
              {canEdit && (
                <button
                  className="shrink-0 rounded-2xl border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                  onClick={() => onEditAccount(account)}
                  type="button"
                >
                편집
                </button>
              )}
            </div>

            <div className="mt-4">
              <p className="text-lg font-semibold">{formatKrw(account.market_value_krw)}</p>
              <p className="mt-1 text-sm text-[var(--accent)]">
                {formatPercent(
                  totalValue > 0 ? (account.market_value_krw / totalValue) * 100 : NaN,
                )}
              </p>
            </div>

            {!!holdings.length && (
              <div className="mt-4 grid gap-2">
                {holdings.map((holding) => (
                  <div
                    className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-3"
                    key={holding.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold leading-5">
                          {holding.instruments?.display_name ?? holding.ticker}
                        </div>
                        <div className="mt-1 text-sm leading-5 text-[var(--muted-ink)]">
                          {holding.ticker} · 수량 {formatNumber(holding.quantity)} · 평균단가{' '}
                          {formatMoney(holding.avg_price, holding.instruments?.currency)}
                        </div>
                      </div>
                      {canEdit && (
                        <button
                          className="shrink-0 rounded-2xl border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--muted-ink)] transition hover:bg-[var(--panel)] hover:text-[var(--ink)]"
                          onClick={() => onEditHolding(holding)}
                          type="button"
                        >
                        편집
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {canEdit && (
              <div className="mt-4 flex justify-end">
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
    </section>
  )
}

function InstrumentsPage({
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
    <section className="mt-8 grid gap-3">
      <TagActionToolbar
        buttonLabel="종목 추가"
        className="flex items-center gap-2 rounded-[24px] border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[var(--shadow-soft)] md:hidden"
        onAction={canEdit ? onCreateInstrument : undefined}
        onTagFilterChange={onTagFilterChange}
        selectedTagId={selectedTagId}
        selectClassName="w-full"
        tags={tags}
      />
      {!instruments.length && (
        <div className="rounded-[24px] border border-[var(--line)] bg-[var(--panel)] p-5 text-sm leading-6 text-[var(--muted-ink)] shadow-[var(--shadow-soft)]">
          선택한 태그에 해당하는 종목이 없습니다.
        </div>
      )}
      {instruments.map((instrument) => {
        const linkedHoldings = holdingsByTicker.get(instrument.ticker) ?? []
        return (
          <article
            className="rounded-[24px] border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)]"
            key={instrument.ticker}
          >
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
                <p className="mt-1 text-sm text-[var(--muted-ink)]">
                  현재가{' '}
                  {instrument.latestPrice != null
                    ? formatMoney(instrument.latestPrice, instrument.currency)
                    : '가격 없음'}
                  {instrument.latestPriceDate ? ` · ${instrument.latestPriceDate}` : ''}
                </p>
              </div>
              {canEdit && (
                <button
                  className="shrink-0 rounded-2xl border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                  onClick={() => onEditInstrument(instrument)}
                  type="button"
                >
                편집
                </button>
              )}
            </div>

            <div className="mt-4">
              <p className="text-lg font-semibold">
                {formatMoney(instrument.market_value_native, instrument.currency)}
              </p>
              {instrument.currency !== 'KRW' && (
                <p className="mt-1 text-sm text-[var(--muted-ink)]">
                  {formatKrw(instrument.market_value_krw)} 환산
                </p>
              )}
              <p className="mt-1 text-sm text-[var(--accent)]">
                {formatPercent(
                  totalValue > 0 ? (instrument.market_value_krw / totalValue) * 100 : NaN,
                )}
              </p>
            </div>

            {!!linkedHoldings.length && (
              <div className="mt-4 grid gap-2">
                {linkedHoldings.map((holding) => (
                  <div
                    className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-3"
                    key={holding.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold leading-5">
                          계좌 {holding.account_id} · 수량 {formatNumber(holding.quantity)}
                        </div>
                        <div className="mt-1 text-sm leading-5 text-[var(--muted-ink)]">
                          평균단가 {formatMoney(holding.avg_price, instrument.currency)}
                        </div>
                      </div>
                      {canEdit && (
                        <button
                          className="shrink-0 rounded-2xl border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--muted-ink)] transition hover:bg-[var(--panel)] hover:text-[var(--ink)]"
                          onClick={() => onEditHolding(holding)}
                          type="button"
                        >
                        편집
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {canEdit && (
              <div className="mt-4 flex justify-end">
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
  holdingSaving,
  instruments,
  onChange,
  onClose,
  onDelete,
  onSave,
}) {
  return (
    <ModalShell onClose={onClose} title={draft.id ? '보유 수정' : '보유 추가'}>
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

        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            종목
          </span>
          <select
            className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('ticker', event.target.value)}
            value={draft.ticker}
          >
            <option value="">종목 선택</option>
            {instruments.map((instrument) => (
              <option key={instrument.ticker} value={instrument.ticker}>
                {instrument.display_name} ({instrument.ticker})
              </option>
            ))}
          </select>
        </label>

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

export default App
