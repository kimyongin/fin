import { useEffect, useMemo, useRef, useState } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const tabs = [
  { id: 'overview', label: '자산' },
  { id: 'accounts', label: '계좌' },
  { id: 'instruments', label: '종목' },
  { id: 'settings', label: '설정' },
]

const chartPalette = ['#ff8a00', '#26c6da', '#7dd3fc', '#f97316', '#84cc16', '#facc15', '#fb7185']

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

function authRedirectTo() {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
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
  const [state, setState] = useState({
    accounts: [],
    positions: [],
    instruments: [],
    tags: [],
    instrumentTags: [],
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

  useEffect(() => {
    if (!session) return

    async function loadState() {
      setLoadError('')
      const results = await Promise.all([
        supabase.from('accounts').select('*').order('name'),
        supabase.from('portfolio_view').select('*'),
        supabase.from('instruments').select('*').order('display_name'),
        supabase.from('tags').select('*').order('sort_order'),
        supabase.from('instrument_tags').select('ticker, tag_id, tags(id, name, color)'),
      ])
      const failed = results.find((result) => result.error)
      if (failed) throw failed.error

      setState({
        accounts: results[0].data ?? [],
        positions: results[1].data ?? [],
        instruments: results[2].data ?? [],
        tags: results[3].data ?? [],
        instrumentTags: results[4].data ?? [],
      })
    }

    loadState().catch((error) => {
      setLoadError(error.message ?? String(error))
    })
  }, [session])

  const totalValue = useMemo(
    () => state.positions.reduce((sum, row) => sum + (row.market_value_krw ?? 0), 0),
    [state.positions],
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
    const byPosition = new Map()
    for (const pos of state.positions) {
      const current = byPosition.get(pos.ticker) ?? {
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
      byPosition.set(pos.ticker, current)
    }

    return [...byPosition.values()]
      .map((row) => ({
        ...row,
        accountCount: row.accounts.size,
        tagName: tagMapByTicker.get(row.ticker)?.name ?? '태그 없음',
      }))
      .sort((a, b) => b.market_value_krw - a.market_value_krw)
  }, [state.positions, tagMapByTicker])

  const tagCards = useMemo(() => {
    const byTicker = new Map()
    for (const row of instrumentRows) {
      byTicker.set(row.ticker, row)
    }

    const byTag = new Map()
    for (const row of instrumentRows) {
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
      current.holdings.push(byTicker.get(row.ticker) ?? row)
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
    if (!chartSlices.length) return 'conic-gradient(#2b2d36 0% 100%)'
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
          const holdingPercent = totalValue > 0 ? (holding.market_value_krw / totalValue) * 100 : NaN
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
              여러 계좌에 흩어진 보유 종목을 한 화면에서 통합해 보고, 태그 기준 비중을
              빠르게 확인합니다.
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
          <AccountsPage accounts={accountCards} totalValue={totalValue} />
        )}
        {activeTab === 'instruments' && (
          <InstrumentsPage instruments={instrumentRows} totalValue={totalValue} />
        )}
        {activeTab === 'settings' && <SettingsPage />}
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

function AccountsPage({ accounts, totalValue }) {
  return (
    <section className="mt-8 grid gap-3">
      {accounts.map((account) => (
        <article
          className="grid gap-3 rounded-[24px] border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)] sm:grid-cols-[1fr_auto] sm:items-center"
          key={account.id}
        >
          <div>
            <h2 className="text-base font-semibold">{account.name}</h2>
            <p className="mt-1 text-sm text-[var(--muted-ink)]">
              {account.broker || '증권사 없음'} · {account.count}개 보유
            </p>
            {account.note && <p className="mt-2 text-sm text-[var(--muted-ink)]">{account.note}</p>}
          </div>
          <div className="text-left sm:text-right">
            <p className="text-lg font-semibold">{formatKrw(account.market_value_krw)}</p>
            <p className="mt-1 text-sm text-[var(--accent)]">
              {formatPercent(totalValue > 0 ? (account.market_value_krw / totalValue) * 100 : NaN)}
            </p>
          </div>
        </article>
      ))}
    </section>
  )
}

function InstrumentsPage({ instruments, totalValue }) {
  return (
    <section className="mt-8 grid gap-3">
      {instruments.map((instrument) => (
        <article
          className="grid gap-3 rounded-[24px] border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)] sm:grid-cols-[1fr_auto] sm:items-center"
          key={instrument.ticker}
        >
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-[var(--line)] bg-white/80 px-2.5 py-1 text-xs font-semibold text-[var(--ink)]">
                {instrument.ticker}
              </span>
              <span className="text-sm font-semibold text-[var(--accent)]">{instrument.tagName}</span>
            </div>
            <h2 className="mt-3 text-base font-semibold leading-6">{instrument.display_name}</h2>
            <p className="mt-1 text-sm text-[var(--muted-ink)]">
              {instrument.accountCount}개 계좌 · 수량 {instrument.quantity.toLocaleString()}
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
              {formatPercent(totalValue > 0 ? (instrument.market_value_krw / totalValue) * 100 : NaN)}
            </p>
          </div>
        </article>
      ))}
    </section>
  )
}

function SettingsPage() {
  return (
    <section className="mt-8 rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
      <h2 className="text-lg font-semibold">설정</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">
        편집, CSV 가져오기, 가격 갱신 같은 관리 기능은 다음 단계에서 React 드로어와 함께
        옮깁니다.
      </p>
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
