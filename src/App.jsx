import { useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const tabs = [
  { id: 'overview', label: '자산' },
  { id: 'accounts', label: '계좌' },
  { id: 'instruments', label: '종목' },
  { id: 'settings', label: '설정' },
]

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

function App() {
  const [session, setSession] = useState(null)
  const [authStatus, setAuthStatus] = useState('loading')
  const [activeTab, setActiveTab] = useState('overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [state, setState] = useState({
    accounts: [],
    positions: [],
    instruments: [],
    tags: [],
    instrumentTags: [],
  })
  const [loadError, setLoadError] = useState('')

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
      setSession(nextSession)
      setAuthStatus(nextSession ? 'signed-in' : 'signed-out')
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

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
    const byTicker = new Map()
    for (const tagRow of state.instrumentTags) {
      if (!byTicker.has(tagRow.ticker) && tagRow.tags) {
        byTicker.set(tagRow.ticker, tagRow.tags.name)
      }
    }

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
        tagName: byTicker.get(row.ticker) ?? '태그 없음',
      }))
      .sort((a, b) => b.market_value_krw - a.market_value_krw)
  }, [state.instrumentTags, state.positions])

  const tagCards = useMemo(() => {
    const byTicker = new Map()
    for (const row of state.instrumentTags) {
      if (!byTicker.has(row.ticker) && row.tags) byTicker.set(row.ticker, row.tags)
    }

    const byTag = new Map()
    for (const pos of state.positions) {
      const tag = byTicker.get(pos.ticker) ?? {
        id: 'untagged',
        name: '태그 없음',
        color: '#8a8e96',
      }
      const item = byTag.get(tag.id) ?? {
        ...tag,
        value: 0,
        holdings: [],
      }
      item.value += pos.market_value_krw ?? 0
      item.holdings.push(pos)
      byTag.set(tag.id, item)
    }

    return [...byTag.values()].sort((a, b) => b.value - a.value)
  }, [state.instrumentTags, state.positions])

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
      <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-100">
        <section className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-sm content-center gap-6">
          <div>
            <p className="text-sm font-semibold text-orange-400">Portfolio</p>
            <h1 className="mt-2 text-3xl font-bold">포트폴리오</h1>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              여러 계좌에 흩어진 종목을 통합해서 태그별 비중을 확인합니다.
            </p>
          </div>
          <button
            className="rounded-lg bg-orange-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-orange-400"
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
    <main className="min-h-screen bg-zinc-950 px-4 py-5 text-zinc-100 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="relative flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-orange-400">총 평가액</p>
            <h1 className="mt-2 text-3xl font-bold tracking-normal sm:text-4xl">
              {formatKrw(totalValue)}
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              {state.accounts.length}개 계좌 · {state.positions.length}개 보유 항목
            </p>
          </div>
          <button
            aria-expanded={menuOpen}
            aria-label="메뉴 열기"
            className="inline-flex h-10 w-10 flex-col items-center justify-center gap-1 rounded-lg border border-white/15 bg-zinc-900 text-zinc-100"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            <span className="h-0.5 w-4 rounded-full bg-current" />
            <span className="h-0.5 w-4 rounded-full bg-current" />
            <span className="h-0.5 w-4 rounded-full bg-current" />
          </button>
          {menuOpen && (
            <nav className="absolute right-0 top-12 z-10 grid min-w-40 gap-1 rounded-lg border border-white/15 bg-zinc-900 p-1.5 shadow-2xl shadow-black/40">
              {tabs.map((tab) => (
                <button
                  className={`rounded-md px-3 py-2.5 text-left text-sm font-semibold ${
                    activeTab === tab.id ? 'bg-orange-500 text-white' : 'text-zinc-400'
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
                className="rounded-md px-3 py-2.5 text-left text-sm font-semibold text-zinc-400"
                onClick={signOut}
                type="button"
              >
                로그아웃
              </button>
            </nav>
          )}
        </header>

        {loadError && (
          <div className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
            {loadError}
          </div>
        )}

        {activeTab === 'overview' && <Overview cards={tagCards} totalValue={totalValue} />}
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

function Overview({ cards, totalValue }) {
  return (
    <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <article
          className="grid min-h-72 content-start gap-4 rounded-lg border border-white/10 bg-zinc-900 p-5"
          key={card.id}
          style={{ borderLeftColor: card.color, borderLeftWidth: 4 }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">{card.name}</h2>
              <p className="mt-2 text-2xl font-bold">{formatKrw(card.value)}</p>
            </div>
            <strong className="text-sm text-orange-400">
              {totalValue > 0 ? `${((card.value / totalValue) * 100).toFixed(1)}%` : '-'}
            </strong>
          </div>
          <div className="grid gap-3">
            {card.holdings.map((holding) => (
              <div
                className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm"
                key={`${holding.account_id}-${holding.ticker}`}
              >
                <div className="font-bold text-zinc-100">
                  {holding.ticker} ·{' '}
                  {formatPercent(totalValue > 0 ? ((holding.market_value_krw ?? 0) / totalValue) * 100 : NaN)}
                </div>
                <div className="mt-2 leading-6 text-zinc-300">{holding.display_name}</div>
                <div className="mt-3 font-bold">
                  {formatMoney(holding.market_value_native, holding.currency)}
                  {holding.currency !== 'KRW' && (
                    <span className="ml-1 text-zinc-400">
                      ({formatKrw(holding.market_value_krw ?? 0)} 환산)
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  )
}

function AccountsPage({ accounts, totalValue }) {
  return (
    <section className="mt-8 grid gap-3">
      {accounts.map((account) => (
        <article
          className="grid gap-3 rounded-lg border border-white/10 bg-zinc-900 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
          key={account.id}
        >
          <div>
            <h2 className="text-base font-bold">{account.name}</h2>
            <p className="mt-1 text-sm text-zinc-400">
              {account.broker || '증권사 없음'} · {account.count}개 보유
            </p>
            {account.note && <p className="mt-2 text-sm text-zinc-500">{account.note}</p>}
          </div>
          <div className="text-left sm:text-right">
            <p className="text-lg font-bold">{formatKrw(account.market_value_krw)}</p>
            <p className="mt-1 text-sm text-orange-400">
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
          className="grid gap-3 rounded-lg border border-white/10 bg-zinc-900 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
          key={instrument.ticker}
        >
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-white/15 px-2 py-1 text-xs font-bold text-zinc-200">
                {instrument.ticker}
              </span>
              <span className="text-sm font-semibold text-orange-400">{instrument.tagName}</span>
            </div>
            <h2 className="mt-3 text-base font-bold leading-6">{instrument.display_name}</h2>
            <p className="mt-1 text-sm text-zinc-400">
              {instrument.accountCount}개 계좌 · 수량 {instrument.quantity.toLocaleString()}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-lg font-bold">
              {formatMoney(instrument.market_value_native, instrument.currency)}
            </p>
            {instrument.currency !== 'KRW' && (
              <p className="mt-1 text-sm text-zinc-400">
                {formatKrw(instrument.market_value_krw)} 환산
              </p>
            )}
            <p className="mt-1 text-sm text-orange-400">
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
    <section className="mt-8 rounded-lg border border-white/10 bg-zinc-900 p-5">
      <h2 className="text-lg font-bold">설정</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        편집, CSV 가져오기, 가격 갱신 같은 관리 기능은 다음 단계에서 React 드로어와 함께 옮깁니다.
      </p>
    </section>
  )
}

function CenteredMessage({ title, body }) {
  return (
    <main className="grid min-h-screen content-center bg-zinc-950 px-5 text-zinc-100">
      <section className="mx-auto max-w-sm rounded-lg border border-white/10 bg-zinc-900 p-6">
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">{body}</p>
      </section>
    </main>
  )
}

export default App
