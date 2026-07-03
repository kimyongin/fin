import { useEffect, useMemo, useRef, useState } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const tabs = [
  { id: 'overview', label: '자산' },
  { id: 'accounts', label: '계좌' },
  { id: 'instruments', label: '종목' },
  { id: 'settings', label: '설정' },
]

const chartPalette = ['#db6a21', '#26c6da', '#7dd3fc', '#f97316', '#84cc16', '#facc15', '#fb7185']
const tagColorOptions = ['neutral', 'info', 'success', 'warning', 'danger']
const tagColorMap = {
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

function today() {
  return new Date().toISOString().slice(0, 10)
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
  const [activeTab, setActiveTab] = useState('overview')
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

  async function refreshState() {
    setLoadError('')
    const results = await Promise.all([
      supabase.from('accounts').select('*').order('name'),
      supabase
        .from('holdings')
        .select('*, instruments(display_name, currency, instrument_type)')
        .order('account_id'),
      supabase.from('portfolio_view').select('*'),
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
      positions: results[2].data ?? [],
      instruments: results[3].data ?? [],
      tags: results[4].data ?? [],
      instrumentTags: results[5].data ?? [],
      prices: latestPrices(results[6].data ?? []),
    })
  }

  useEffect(() => {
    if (!session) return

    refreshState().catch((error) => {
      setLoadError(error.message ?? String(error))
    })
  }, [session])

  const totalValue = useMemo(
    () => state.positions.reduce((sum, row) => sum + (row.market_value_krw ?? 0), 0),
    [state.positions],
  )

  const latestPriceByTicker = useMemo(() => {
    return new Map(state.prices.map((row) => [row.ticker, row]))
  }, [state.prices])

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
        const rows = state.positions.filter((pos) => pos.account_id === account.id)
        return {
          ...account,
          count: rows.length,
          market_value_krw: rows.reduce((sum, row) => sum + (row.market_value_krw ?? 0), 0),
        }
      })
      .sort((a, b) => b.market_value_krw - a.market_value_krw)
  }, [state.accounts, state.positions])

  const instrumentRows = useMemo(() => {
    const aggregated = new Map()
    for (const pos of state.positions) {
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
      current.market_value_krw += pos.market_value_krw ?? 0
      if (pos.account_id) current.accounts.add(pos.account_id)
      aggregated.set(pos.ticker, current)
    }

    return state.instruments
      .filter((item) => item.instrument_type !== 'fx')
      .map((instrument) => {
        const position = aggregated.get(instrument.ticker)
        const latestPrice = latestPriceByTicker.get(instrument.ticker)
        return {
          ...instrument,
          tagName: tagMapByTicker.get(instrument.ticker)?.name ?? '태그 없음',
          quantity: position?.quantity ?? 0,
          market_value_native: position?.market_value_native ?? 0,
          market_value_krw: position?.market_value_krw ?? 0,
          accountCount: position?.accounts.size ?? 0,
          latestPrice: latestPrice?.close_price ?? null,
          latestPriceDate: latestPrice?.price_date ?? '',
        }
      })
      .sort((a, b) => b.market_value_krw - a.market_value_krw || a.display_name.localeCompare(b.display_name))
  }, [state.instruments, state.positions, latestPriceByTicker, tagMapByTicker])

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
        color: tag.color || chartPalette[index % chartPalette.length],
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
    setAccountError('')
    setAccountModal({
      id: account?.id ?? null,
      name: account?.name ?? '',
      broker: account?.broker ?? '',
      note: account?.note ?? '',
    })
  }

  function openInstrumentModal(instrument = null) {
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
    await supabase.auth.signOut()
  }

  async function handleSaveAccount() {
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
      <main className="min-h-screen px-5 py-8 text-stone-950">
        <section className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-sm content-center gap-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
              Portfolio
            </p>
            <h1 className="mt-3 text-4xl font-semibold text-[var(--ink)]">포트폴리오</h1>
            <p className="mt-4 text-sm leading-6 text-[var(--muted-ink)]">
              여러 계좌에 흩어진 보유 종목을 한 화면에서 통합해 보고, 태그 기준 비중을 빠르게
              확인합니다.
            </p>
          </div>
          <button
            className="rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95"
            onClick={signInWithGoogle}
            type="button"
          >
            Google로 로그인
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen px-4 py-5 text-[var(--ink)] sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="relative flex items-start justify-between gap-4" ref={menuRef}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
              Total Value
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal sm:text-5xl">
              {formatKrw(totalValue)}
            </h1>
            <p className="mt-3 text-sm text-[var(--muted-ink)]">
              {state.accounts.length}개 계좌 · {state.positions.length}개 보유 항목
            </p>
          </div>
          <button
            aria-expanded={menuOpen}
            aria-label="메뉴 열기"
            className="inline-flex h-10 w-10 flex-col items-center justify-center gap-1 rounded-2xl border border-[var(--line)] bg-white/65 text-[var(--ink)] shadow-sm backdrop-blur"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            <span className="h-0.5 w-4 rounded-full bg-current" />
            <span className="h-0.5 w-4 rounded-full bg-current" />
            <span className="h-0.5 w-4 rounded-full bg-current" />
          </button>
          {menuOpen && (
            <nav className="absolute right-0 top-12 z-10 grid min-w-40 gap-1 rounded-2xl border border-[var(--line)] bg-[rgba(255,250,244,0.96)] p-1.5 shadow-2xl shadow-[rgba(70,52,35,0.12)] backdrop-blur">
              {tabs.map((tab) => (
                <button
                  className={`rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                    activeTab === tab.id
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--muted-ink)] hover:bg-white hover:text-[var(--ink)]'
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
                className="rounded-xl px-3 py-2.5 text-left text-sm font-medium text-[var(--muted-ink)] transition hover:bg-white hover:text-[var(--ink)]"
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
            accounts={accountCards}
            holdingsByAccountId={holdingsByAccountId}
            onCreateAccount={() => openAccountModal()}
            onCreateHolding={(accountId) => openHoldingModal({ accountId })}
            onEditAccount={(account) => openAccountModal(account)}
            onEditHolding={(holding) => openHoldingModal({ holding })}
            totalValue={totalValue}
          />
        )}
        {activeTab === 'instruments' && (
          <InstrumentsPage
            holdingsByTicker={holdingsByTicker}
            instruments={instrumentRows}
            onCreateHolding={(ticker) => openHoldingModal({ ticker })}
            onCreateInstrument={() => openInstrumentModal()}
            onEditHolding={(holding) => openHoldingModal({ holding })}
            onEditInstrument={(instrument) => openInstrumentModal(instrument)}
            totalValue={totalValue}
          />
        )}
        {activeTab === 'settings' && (
          <SettingsPage
            onCreateTag={() => openTagModal()}
            onEditTag={(tag) => openTagModal(tag)}
            onSyncPrices={handleSyncPrices}
            syncingPrices={syncingPrices}
            syncMessage={syncMessage}
            tags={state.tags}
          />
        )}

        {accountModal && (
          <AccountEditorModal
            accountError={accountError}
            accountSaving={accountSaving}
            draft={accountModal}
            holdings={holdingsByAccountId.get(accountModal.id) ?? []}
            onAddHolding={() => {
              const accountId = accountModal.id
              setAccountModal(null)
              if (accountId) openHoldingModal({ accountId })
            }}
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
            onEditHolding={(holding) => {
              setAccountModal(null)
              openHoldingModal({ holding })
            }}
            onSave={handleSaveAccount}
          />
        )}

        {instrumentModal && (
          <InstrumentEditorModal
            draft={instrumentModal}
            holdings={holdingsByTicker.get(instrumentModal.ticker) ?? []}
            instrumentError={instrumentError}
            instrumentSaving={instrumentSaving}
            onAddHolding={() => {
              const ticker = instrumentModal.ticker
              setInstrumentModal(null)
              if (ticker) openHoldingModal({ ticker })
            }}
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
            onEditHolding={(holding) => {
              setInstrumentModal(null)
              openHoldingModal({ holding })
            }}
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
      <div className="grid gap-5 rounded-[32px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)] lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:p-6">
        <div className="grid gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">태그 비중</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-[var(--muted-ink)]">
                각 종목은 하나의 대표 태그만 기준으로 잡습니다. 그래서 태그 비중 합계는 전체
                자산 100%와 맞습니다.
              </p>
            </div>
            <button
              className={`inline-flex h-11 items-center gap-2 rounded-2xl border px-3 text-sm font-medium transition ${
                copied
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'border-[var(--line)] bg-white/75 text-[var(--muted-ink)] hover:text-[var(--ink)]'
              }`}
              onClick={onCopy}
              type="button"
            >
              <CopyIcon />
              {copied ? '복사됨' : 'Markdown 복사'}
            </button>
          </div>

          <div className="grid items-center gap-5 rounded-[28px] bg-white/70 p-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <div className="mx-auto flex h-[220px] w-[220px] items-center justify-center rounded-full bg-[var(--panel)] shadow-[inset_0_0_0_18px_rgba(255,255,255,0.82)]">
              <div
                className="relative h-[184px] w-[184px] rounded-full"
                style={{ backgroundImage: pieGradient }}
              >
                <div className="absolute inset-[26px] grid place-items-center rounded-full bg-[var(--panel)] text-center shadow-[0_10px_30px_rgba(95,77,56,0.08)]">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-ink)]">
                      Total
                    </div>
                    <div className="mt-2 text-lg font-semibold">{formatKrw(totalValue)}</div>
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

        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((card) => (
            <article
              className="grid min-h-[320px] content-start gap-4 rounded-[28px] border border-[var(--line)] bg-[rgba(255,255,255,0.72)] p-5 shadow-[0_24px_60px_rgba(91,69,44,0.08)]"
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
      </div>
    </section>
  )
}

function AccountsPage({
  accounts,
  holdingsByAccountId,
  onCreateAccount,
  onCreateHolding,
  onEditAccount,
  onEditHolding,
  totalValue,
}) {
  return (
    <section className="mt-8 grid gap-3">
      <div className="flex justify-end">
        <button
          className="rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95"
          onClick={onCreateAccount}
          type="button"
        >
          계좌 추가
        </button>
      </div>
      {accounts.map((account) => {
        const holdings = holdingsByAccountId.get(account.id) ?? []
        return (
          <div
            className="rounded-[24px] border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)]"
            key={account.id}
          >
            <button
              className="grid w-full gap-3 text-left transition hover:-translate-y-[1px] sm:grid-cols-[1fr_auto] sm:items-center"
              onClick={() => onEditAccount(account)}
              type="button"
            >
              <div>
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
              <div className="text-left sm:text-right">
                <p className="text-lg font-semibold">{formatKrw(account.market_value_krw)}</p>
                <p className="mt-1 text-sm text-[var(--accent)]">
                  {formatPercent(
                    totalValue > 0 ? (account.market_value_krw / totalValue) * 100 : NaN,
                  )}
                </p>
              </div>
            </button>

            {!!holdings.length && (
              <div className="mt-4 grid gap-2">
                {holdings.map((holding) => (
                  <button
                    className="rounded-2xl border border-[var(--line)] bg-white/70 px-3 py-3 text-left transition hover:bg-white"
                    key={holding.id}
                    onClick={() => onEditHolding(holding)}
                    type="button"
                  >
                    <div className="text-sm font-semibold">
                      {holding.instruments?.display_name ?? holding.ticker}
                    </div>
                    <div className="mt-1 text-sm text-[var(--muted-ink)]">
                      {holding.ticker} · 수량 {formatNumber(holding.quantity)} · 평균단가{' '}
                      {formatMoney(holding.avg_price, holding.instruments?.currency)}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button
                className="rounded-2xl border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--muted-ink)] transition hover:bg-white hover:text-[var(--ink)]"
                onClick={() => onCreateHolding(account.id)}
                type="button"
              >
                이 계좌에 보유 추가
              </button>
            </div>
          </div>
        )
      })}
    </section>
  )
}

function InstrumentsPage({
  holdingsByTicker,
  instruments,
  onCreateHolding,
  onCreateInstrument,
  onEditHolding,
  onEditInstrument,
  totalValue,
}) {
  return (
    <section className="mt-8 grid gap-3">
      <div className="flex justify-end">
        <button
          className="rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95"
          onClick={onCreateInstrument}
          type="button"
        >
          종목 추가
        </button>
      </div>
      {instruments.map((instrument) => {
        const linkedHoldings = holdingsByTicker.get(instrument.ticker) ?? []
        return (
          <div
            className="rounded-[24px] border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)]"
            key={instrument.ticker}
          >
            <button
              className="grid w-full gap-3 text-left transition hover:-translate-y-[1px] sm:grid-cols-[1fr_auto] sm:items-center"
              onClick={() => onEditInstrument(instrument)}
              type="button"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[var(--line)] bg-white/80 px-2.5 py-1 text-xs font-semibold text-[var(--ink)]">
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
              <div className="text-left sm:text-right">
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
            </button>

            {!!linkedHoldings.length && (
              <div className="mt-4 grid gap-2">
                {linkedHoldings.map((holding) => (
                  <button
                    className="rounded-2xl border border-[var(--line)] bg-white/70 px-3 py-3 text-left transition hover:bg-white"
                    key={holding.id}
                    onClick={() => onEditHolding(holding)}
                    type="button"
                  >
                    <div className="text-sm font-semibold">
                      계좌 {holding.account_id} · 수량 {formatNumber(holding.quantity)}
                    </div>
                    <div className="mt-1 text-sm text-[var(--muted-ink)]">
                      평균단가 {formatMoney(holding.avg_price, instrument.currency)}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button
                className="rounded-2xl border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--muted-ink)] transition hover:bg-white hover:text-[var(--ink)]"
                onClick={() => onCreateHolding(instrument.ticker)}
                type="button"
              >
                이 종목 보유 추가
              </button>
            </div>
          </div>
        )
      })}
    </section>
  )
}

function SettingsPage({ onCreateTag, onEditTag, onSyncPrices, syncingPrices, syncMessage, tags }) {
  return (
    <section className="mt-8 grid gap-5">
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
          <p className="mt-4 rounded-2xl bg-white/75 px-3 py-3 text-sm text-[var(--muted-ink)]">
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
            className="rounded-2xl border border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-white hover:text-[var(--ink)]"
            onClick={onCreateTag}
            type="button"
          >
            태그 추가
          </button>
        </div>
        <div className="mt-4 grid gap-2">
          {tags.map((tag) => (
            <button
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-[var(--line)] bg-white/72 px-3 py-3 text-left transition hover:bg-white"
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
  holdings,
  onAddHolding,
  onChange,
  onClose,
  onDelete,
  onEditHolding,
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
            className="rounded-2xl border border-[var(--line)] bg-white/80 px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('name', event.target.value)}
            value={draft.name}
          />
        </label>

        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            증권사
          </span>
          <input
            className="rounded-2xl border border-[var(--line)] bg-white/80 px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('broker', event.target.value)}
            value={draft.broker}
          />
        </label>

        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
            메모
          </span>
          <textarea
            className="min-h-24 rounded-2xl border border-[var(--line)] bg-white/80 px-3 py-3 outline-none transition focus:border-[var(--accent)]"
            onChange={(event) => onChange('note', event.target.value)}
            value={draft.note}
          />
        </label>

        {!!draft.id && (
          <div className="grid gap-3 rounded-[24px] border border-[var(--line)] bg-white/65 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">이 계좌의 보유 종목</h3>
              <button
                className="rounded-2xl border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--muted-ink)] transition hover:bg-white hover:text-[var(--ink)]"
                onClick={onAddHolding}
                type="button"
              >
                보유 추가
              </button>
            </div>
            {holdings.length ? (
              <div className="grid gap-2.5">
                {holdings.map((holding) => (
                  <button
                    className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-3 py-3 text-left"
                    key={holding.id}
                    onClick={() => onEditHolding(holding)}
                    type="button"
                  >
                    <div className="text-sm font-semibold text-[var(--ink)]">
                      {holding.instruments?.display_name ?? holding.ticker}
                    </div>
                    <div className="mt-1 text-sm text-[var(--muted-ink)]">
                      {holding.ticker} · 수량 {formatNumber(holding.quantity)}
                    </div>
                    <div className="mt-1 text-sm text-[var(--muted-ink)]">
                      평균단가 {formatMoney(holding.avg_price, holding.instruments?.currency)}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm leading-6 text-[var(--muted-ink)]">
                아직 보유 종목이 없습니다.
              </p>
            )}
          </div>
        )}

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
  holdings,
  instrumentError,
  instrumentSaving,
  onAddHolding,
  onChange,
  onClose,
  onDelete,
  onEditHolding,
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
            className="rounded-2xl border border-[var(--line)] bg-white/80 px-3 py-3 outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:bg-stone-100"
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
            className="rounded-2xl border border-[var(--line)] bg-white/80 px-3 py-3 outline-none transition focus:border-[var(--accent)]"
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
              className="rounded-2xl border border-[var(--line)] bg-white/80 px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('currency', event.target.value)}
              value={draft.currency}
            >
              {['KRW', 'USD'].map((value) => (
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
              className="rounded-2xl border border-[var(--line)] bg-white/80 px-3 py-3 outline-none transition focus:border-[var(--accent)]"
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
              className="rounded-2xl border border-[var(--line)] bg-white/80 px-3 py-3 outline-none transition focus:border-[var(--accent)]"
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
              className="rounded-2xl border border-[var(--line)] bg-white/80 px-3 py-3 outline-none transition focus:border-[var(--accent)]"
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
            className="rounded-2xl border border-[var(--line)] bg-white/80 px-3 py-3 outline-none transition focus:border-[var(--accent)]"
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

        {!!draft.id && (
          <div className="grid gap-3 rounded-[24px] border border-[var(--line)] bg-white/65 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">이 종목의 보유 목록</h3>
              <button
                className="rounded-2xl border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--muted-ink)] transition hover:bg-white hover:text-[var(--ink)]"
                onClick={onAddHolding}
                type="button"
              >
                보유 추가
              </button>
            </div>
            {holdings.length ? (
              <div className="grid gap-2.5">
                {holdings.map((holding) => (
                  <button
                    className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-3 py-3 text-left"
                    key={holding.id}
                    onClick={() => onEditHolding(holding)}
                    type="button"
                  >
                    <div className="text-sm font-semibold text-[var(--ink)]">
                      계좌 {holding.account_id}
                    </div>
                    <div className="mt-1 text-sm text-[var(--muted-ink)]">
                      수량 {formatNumber(holding.quantity)} · 평균단가{' '}
                      {formatMoney(holding.avg_price, draft.currency)}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm leading-6 text-[var(--muted-ink)]">
                아직 연결된 보유가 없습니다.
              </p>
            )}
          </div>
        )}

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
            className="rounded-2xl border border-[var(--line)] bg-white/80 px-3 py-3 outline-none transition focus:border-[var(--accent)]"
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
            className="rounded-2xl border border-[var(--line)] bg-white/80 px-3 py-3 outline-none transition focus:border-[var(--accent)]"
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
              className="rounded-2xl border border-[var(--line)] bg-white/80 px-3 py-3 outline-none transition focus:border-[var(--accent)]"
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
              className="rounded-2xl border border-[var(--line)] bg-white/80 px-3 py-3 outline-none transition focus:border-[var(--accent)]"
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
            className="min-h-24 rounded-2xl border border-[var(--line)] bg-white/80 px-3 py-3 outline-none transition focus:border-[var(--accent)]"
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
            className="rounded-2xl border border-[var(--line)] bg-white/80 px-3 py-3 outline-none transition focus:border-[var(--accent)]"
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
              className="rounded-2xl border border-[var(--line)] bg-white/80 px-3 py-3 outline-none transition focus:border-[var(--accent)]"
              onChange={(event) => onChange('color', event.target.value)}
              value={draft.color}
            >
              {tagColorOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">
              순서
            </span>
            <input
              className="rounded-2xl border border-[var(--line)] bg-white/80 px-3 py-3 outline-none transition focus:border-[var(--accent)]"
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
            className="rounded-2xl border border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
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
    <div className="flex flex-wrap justify-between gap-3 pt-1">
      <div>
        {canDelete && (
          <button
            className="rounded-2xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onClick={onDelete}
            type="button"
          >
            {deleteLabel}
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <button
          className="rounded-2xl border border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
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
    <div className="fixed inset-0 z-30 bg-[rgba(71,49,28,0.18)] px-3 py-4 backdrop-blur-sm sm:px-6 sm:py-8">
      <div className="mx-auto flex h-full max-w-2xl items-start justify-center">
        <section className="max-h-full w-full overflow-y-auto rounded-[30px] border border-[var(--line)] bg-[rgba(255,248,241,0.98)] p-5 shadow-[0_30px_70px_rgba(79,55,29,0.2)] sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <h2 className="text-xl font-semibold">{title}</h2>
            <button
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] bg-white/75 text-[var(--muted-ink)] transition hover:text-[var(--ink)]"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </div>
          {children}
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
