import { supabase, requireAuth, signOut } from './supabase.js'

const session = await requireAuth()
if (!session) throw new Error('unauthenticated')

document.getElementById('logout-btn').addEventListener('click', signOut)
const menuToggle = document.getElementById('menu-toggle')
const menuPopover = document.getElementById('menu-popover')
const tw = {
    menuToggle: '!inline-flex !h-10 !w-10 !flex-col !items-center !justify-center !gap-1 !rounded-lg !border !border-white/15 !bg-[#14151a] !text-[#ececef] !transition hover:!border-[#ff8a00] hover:!bg-[#1c1d23]',
    menuLine: '!h-0.5 !w-[17px] !rounded-full !bg-current',
    menuPopover: '!absolute !right-0 !top-12 !min-w-40 !gap-1 !rounded-lg !border !border-white/15 !bg-[#14151a] !p-1.5 !shadow-2xl !shadow-black/40',
    menuButton: '!rounded-md !px-3 !py-2.5 !text-left !text-sm !font-semibold !text-[#8a8e96] !transition hover:!bg-[#1c1d23] hover:!text-[#ececef]',
    primaryButton: '!w-full !rounded-lg !border-0 !bg-[#ff8a00] !px-4 !py-2.5 !text-sm !font-bold !text-white !transition hover:!opacity-90 disabled:!cursor-not-allowed disabled:!opacity-50',
    ghostButton: '!w-full !rounded-lg !border !border-white/15 !bg-transparent !px-4 !py-2.5 !text-sm !font-semibold !text-[#8a8e96] !transition hover:!border-white/25 hover:!text-[#ececef]',
    dangerGhostButton: '!rounded-lg !border !border-red-500/70 !bg-transparent !px-4 !py-2.5 !text-sm !font-semibold !text-red-400 !transition hover:!bg-red-500/10 disabled:!cursor-not-allowed disabled:!opacity-40',
    cardItem: '!flex !cursor-pointer !items-center !justify-between !border-b !border-white/10 !px-4 !py-3.5 !transition hover:!bg-[#14151a]',
    cardTitle: '!truncate !font-semibold !text-[#ececef]',
    cardSub: '!text-[13px] !text-[#8a8e96]',
    cardPrice: '!text-sm !font-semibold !text-[#ececef]',
    drawer: '!fixed !right-0 !top-0 !z-[300] !flex !h-screen !w-[480px] !translate-x-full !flex-col !border-l !border-white/10 !bg-[#14151a] !transition-transform !duration-200',
    drawerOpen: '!translate-x-0',
    drawerHeader: '!flex !shrink-0 !items-center !justify-between !border-b !border-white/10 !px-5 !py-4',
    drawerTitle: '!text-base !font-bold !text-[#ececef]',
    drawerBody: '!min-h-0 !flex-1 !overflow-y-auto !px-5 !py-4',
    drawerFooter: '!shrink-0 !border-t !border-white/10 !px-5 !py-3',
    formGroup: '!mb-5 !flex !flex-col !gap-2',
    formLabel: '!text-xs !font-bold !text-[#8a8e96]',
    field: '!w-full !rounded-lg !border !border-white/15 !bg-[#0f1014] !px-3 !py-2.5 !text-sm !leading-normal !text-[#ececef] !outline-none !shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] !transition hover:!border-white/25 hover:!bg-[#121319] focus:!border-[#ff8a00] focus:!bg-[#14151a] focus:!shadow-[0_0_0_3px_rgba(255,138,0,0.14)] disabled:!cursor-not-allowed disabled:!opacity-60',
    fieldLine: '!h-11',
    fieldText: '!min-h-24 !resize-y',
    tagCard: '!grid !min-h-[260px] !min-w-0 !content-start !gap-3 !rounded-lg !border !border-white/10 !bg-[#1c1d23] !p-[18px]',
    tagHolding: '!grid !min-w-0 !cursor-pointer !gap-2 !rounded-lg !border !border-white/10 !bg-black/10 !px-3 !py-3 !text-left !text-[#ececef] !transition hover:!border-white/20 hover:!bg-[#14151a]',
}

function addClasses(el, classes) {
    classes.split(/\s+/).filter(Boolean).forEach(className => el.classList.add(className))
}

function applyTailwindChrome() {
    addClasses(menuToggle, tw.menuToggle)
    menuToggle?.querySelectorAll('span').forEach(line => addClasses(line, tw.menuLine))
    addClasses(menuPopover, tw.menuPopover)
    menuPopover?.querySelectorAll('button').forEach(button => addClasses(button, tw.menuButton))
}

function applyTailwindRenderedStyles(root = document) {
    root.querySelectorAll('.btn-primary').forEach(el => addClasses(el, tw.primaryButton))
    root.querySelectorAll('.btn-ghost').forEach(el => addClasses(el, tw.ghostButton))
    root.querySelectorAll('.btn-danger-ghost').forEach(el => addClasses(el, tw.dangerGhostButton))
    root.querySelectorAll('.card-item').forEach(el => addClasses(el, tw.cardItem))
    root.querySelectorAll('.card-title').forEach(el => addClasses(el, tw.cardTitle))
    root.querySelectorAll('.card-sub').forEach(el => addClasses(el, tw.cardSub))
    root.querySelectorAll('.card-price').forEach(el => addClasses(el, tw.cardPrice))
    root.querySelectorAll('.drawer').forEach(el => addClasses(el, tw.drawer))
    root.querySelectorAll('.drawer.open').forEach(el => addClasses(el, tw.drawerOpen))
    root.querySelectorAll('.drawer-header').forEach(el => addClasses(el, tw.drawerHeader))
    root.querySelectorAll('.drawer-title').forEach(el => addClasses(el, tw.drawerTitle))
    root.querySelectorAll('.drawer-body').forEach(el => addClasses(el, tw.drawerBody))
    root.querySelectorAll('.drawer-footer').forEach(el => addClasses(el, tw.drawerFooter))
    root.querySelectorAll('.form-group').forEach(el => addClasses(el, tw.formGroup))
    root.querySelectorAll('.form-group label').forEach(el => addClasses(el, tw.formLabel))
    root.querySelectorAll('input, select, textarea').forEach(el => {
        addClasses(el, tw.field)
        addClasses(el, el.tagName === 'TEXTAREA' ? tw.fieldText : tw.fieldLine)
    })
    root.querySelectorAll('.tag-summary-card').forEach(el => addClasses(el, tw.tagCard))
    root.querySelectorAll('.tag-holding-card').forEach(el => addClasses(el, tw.tagHolding))
}

function setMenuOpen(open) {
    menuToggle?.setAttribute('aria-expanded', String(open))
    menuPopover?.classList.toggle('open', open)
    applyTailwindChrome()
}

menuToggle?.addEventListener('click', event => {
    event.stopPropagation()
    setMenuOpen(menuToggle.getAttribute('aria-expanded') !== 'true')
})

document.addEventListener('click', event => {
    if (!menuPopover?.classList.contains('open')) return
    if (event.target.closest('.top-menu')) return
    setMenuOpen(false)
})

document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setMenuOpen(false)
})

let activeTab = 'overview'
let drawerEl = null
let state = {
    accounts: [],
    holdings: [],
    instruments: [],
    tags: [],
    instrumentTags: [],
    positions: [],
    prices: [],
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

const fmtKrw = value => Number.isFinite(value) ? KRW.format(Math.round(value)) : '—'
const fmtMoney = (value, currency = 'KRW') => {
    if (!Number.isFinite(value)) return '—'
    if (currency === 'USD') return USD.format(value)
    return fmtKrw(value)
}
const fmtNum = value => Number.isFinite(value) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'
const pct = value => Number.isFinite(value) ? `${value.toFixed(1)}%` : '—'
const today = () => new Date().toISOString().slice(0, 10)
applyTailwindChrome()

document.querySelectorAll('.nav-tab').forEach(button => {
    button.addEventListener('click', () => {
        activeTab = button.dataset.tab
        document.querySelectorAll('.nav-tab').forEach(btn => btn.classList.remove('active'))
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'))
        button.classList.add('active')
        document.getElementById(`tab-${activeTab}`).classList.remove('hidden')
        setMenuOpen(false)
        render()
    })
})

async function loadState() {
    const results = await Promise.all([
        supabase.from('accounts').select('*').order('name'),
        supabase.from('holdings').select('*, accounts(name), instruments(display_name, currency, instrument_type)').order('account_id'),
        supabase.from('instruments').select('*').order('display_name'),
        supabase.from('tags').select('*').order('sort_order'),
        supabase.from('instrument_tags').select('ticker, tag_id, tags(id, name, color)'),
        supabase.from('portfolio_view').select('*'),
        supabase.from('holding_prices_daily').select('ticker, price_date, close_price, source').order('price_date', { ascending: false }),
    ])
    const errorResult = results.find(result => result.error)
    if (errorResult) throw errorResult.error
    const [
        { data: accounts },
        { data: holdings },
        { data: instruments },
        { data: tags },
        { data: instrumentTags },
        { data: positions },
        { data: prices },
    ] = results

    state = {
        accounts: accounts ?? [],
        holdings: holdings ?? [],
        instruments: instruments ?? [],
        tags: tags ?? [],
        instrumentTags: instrumentTags ?? [],
        positions: positions ?? [],
        prices: latestPrices(prices ?? []),
    }
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

function totalValue() {
    return state.positions.reduce((sum, row) => sum + (row.market_value_krw ?? 0), 0)
}

function tagsForTicker(ticker) {
    return state.instrumentTags
        .filter(row => row.ticker === ticker && row.tags)
        .map(row => row.tags)
}

function primaryTagForTicker(ticker) {
    return tagsForTicker(ticker)[0] ?? null
}

function tagNames(ticker) {
    return primaryTagForTicker(ticker)?.name ?? '태그 없음'
}

function aggregateByTicker() {
    const map = new Map()
    for (const pos of state.positions) {
        const prev = map.get(pos.ticker) ?? {
            ticker: pos.ticker,
            display_name: pos.display_name,
            currency: pos.currency,
            quantity: 0,
            market_value_native: 0,
            market_value_krw: 0,
            unrealized_pnl_krw: 0,
            accounts: [],
        }
        prev.quantity += pos.quantity ?? 0
        prev.market_value_native += pos.market_value_native ?? 0
        prev.market_value_krw += pos.market_value_krw ?? 0
        prev.unrealized_pnl_krw += pos.unrealized_pnl_krw ?? 0
        prev.accounts.push(pos)
        map.set(pos.ticker, prev)
    }
    return [...map.values()].sort((a, b) => b.market_value_krw - a.market_value_krw)
}

function aggregateByAccount() {
    return state.accounts.map(account => {
        const rows = state.positions.filter(pos => pos.account_id === account.id)
        return {
            ...account,
            market_value_krw: rows.reduce((sum, pos) => sum + (pos.market_value_krw ?? 0), 0),
            count: rows.length,
        }
    }).sort((a, b) => b.market_value_krw - a.market_value_krw)
}

function aggregateByTag() {
    const map = new Map()
    for (const pos of state.positions) {
        const tag = primaryTagForTicker(pos.ticker)
        if (!tag) continue
        const prev = map.get(tag.id) ?? { ...tag, market_value_krw: 0 }
        prev.market_value_krw += pos.market_value_krw ?? 0
        map.set(tag.id, prev)
    }
    return [...map.values()].sort((a, b) => b.market_value_krw - a.market_value_krw)
}

function render() {
    renderHero()
    if (activeTab === 'overview') renderOverview()
    if (activeTab === 'accounts') renderAccounts()
    if (activeTab === 'instruments') renderInstruments()
    if (activeTab === 'settings') renderSettings()
    applyTailwindRenderedStyles(document)
}

function renderHero() {
    const total = totalValue()
    const lastDate = state.prices.reduce((max, row) => row.price_date > max ? row.price_date : max, '')
    document.getElementById('total-value').textContent = fmtKrw(total)
    document.getElementById('hero-meta').textContent =
        `${state.accounts.length}개 계좌 · ${aggregateByTicker().length}개 통합 종목${lastDate ? ` · 가격 ${lastDate}` : ''}`
    document.getElementById('hero-delta').textContent = ''
}

function renderOverview() {
    const tab = document.getElementById('tab-overview')
    const total = totalValue()
    const tickers = aggregateByTicker()
    const tags = aggregateByTag()

    if (!tickers.length) {
        tab.innerHTML =
            '<p class="empty-state">\uC544\uC9C1 \uBCF4\uC720 \uD56D\uBAA9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uACC4\uC88C\uC640 \uC885\uBAA9\uC744 \uB9CC\uB4E0 \uB4A4 \uACC4\uC88C \uBA54\uB274\uC5D0\uC11C \uBCF4\uC720\uB97C \uCD94\uAC00\uD558\uC138\uC694.</p>'
        return
    }

    tab.innerHTML = `
        ${renderTagOverview(tags, total)}`

    tab.querySelectorAll('[data-copy-tags]').forEach(button => {
        button.addEventListener('click', async event => {
            event.stopPropagation()
            await copyAllTagsMarkdown()
            button.classList.add('copied')
            setTimeout(() => button.classList.remove('copied'), 900)
        })
    })

    tab.querySelectorAll('[data-ticker]').forEach(item => {
        item.addEventListener('click', () => openTickerDrawer(item.dataset.ticker))
    })
}

function renderTagOverview(tags, total) {
    if (!tags.length || !total) return ''
    const colors = ['var(--accent)', 'var(--info)', 'var(--success)', '#a78bfa', 'var(--warning)', '#94a3b8', '#f97316', '#14b8a6']
    const topTags = tags.filter(tag => (tag.market_value_krw ?? 0) > 0)
    if (!topTags.length) return ''
    const tickerRows = aggregateByTicker()

    let pieCursor = 0
    const pieSlices = topTags.map((tag, index) => {
        const value = Math.min(tag.market_value_krw / total * 100, 100)
        const start = pieCursor
        const end = pieCursor + value
        pieCursor = end
        return `${colors[index % colors.length]} ${start}% ${end}%`
    }).join(', ')
    const pieLegend = topTags.map((tag, index) => `
        <div class="tag-pie-leg" style="--slice-color:${colors[index % colors.length]}">
            <span class="tag-pie-name">${tag.name}</span>
            <span class="tag-pie-pct">${pct(tag.market_value_krw / total * 100)}</span>
        </div>
    `).join('')

    const cards = topTags.map((tag, index) => {
        const taggedTickers = tickerRows
            .filter(row => primaryTagForTicker(row.ticker)?.id === tag.id)
            .sort((a, b) => (b.market_value_krw ?? 0) - (a.market_value_krw ?? 0))
        const holdings = taggedTickers.map(row => `
            <button class="tag-holding-card" data-ticker="${row.ticker}">
                <span class="tag-holding-top">
                    <span class="tag-holding-ticker">${row.ticker}</span>
                    <span class="tag-holding-pct">${pct(total ? row.market_value_krw / total * 100 : NaN)}</span>
                </span>
                <span class="tag-holding-title">${row.display_name ?? row.ticker}</span>
                <span class="tag-holding-side">
                    <span class="tag-holding-value">${fmtMoney(row.market_value_native, row.currency)}</span>
                    ${row.currency !== 'KRW' ? `<span class="tag-holding-sub">(${fmtKrw(row.market_value_krw)} \uD658\uC0B0)</span>` : ''}
                </span>
            </button>
        `).join('')

        return `
            <article class="tag-summary-card" style="--tag-color:${colors[index % colors.length]}">
                <div class="tag-card-head">
                    <span class="tag-card-name">${tag.name}</span>
                    <span class="tag-card-pct">${pct(tag.market_value_krw / total * 100)}</span>
                </div>
                <div class="tag-card-value">${fmtKrw(tag.market_value_krw)}</div>
                <div class="tag-card-note">${taggedTickers.length}\uAC1C \uD1B5\uD569 \uC885\uBAA9</div>
                <div class="tag-card-holdings">${holdings}</div>
            </article>`
    }).join('')

    return `
        <section class="tag-overview">
            <div class="tag-overview-head">
                <div>
                    <h2>태그 비중</h2>
                    <p>각 종목의 대표 태그 하나만 기준으로 계산합니다. 그래서 태그 비중 합계는 전체 자산의 100% 안에서 해석할 수 있습니다.</p>
                </div>
                <button class="tag-copy-btn" data-copy-tags type="button" title="\uC804\uCCB4 \uD0DC\uADF8 \uCE74\uB4DC\uB97C \uB9C8\uD06C\uB2E4\uC6B4\uC73C\uB85C \uBCF5\uC0AC" aria-label="\uC804\uCCB4 \uD0DC\uADF8 \uCE74\uB4DC\uB97C \uB9C8\uD06C\uB2E4\uC6B4\uC73C\uB85C \uBCF5\uC0AC">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="8" y="8" width="10" height="10" rx="2"></rect>
                        <path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                </button>
            </div>
            <div class="tag-pie-wrap">
                <div class="tag-pie-chart" style="--pie: conic-gradient(${pieSlices})">
                    <span>${pct(pieCursor)}</span>
                </div>
                <div class="tag-pie-legend">${pieLegend}</div>
            </div>
            <div class="tag-summary-grid">${cards}</div>
        </section>`
}

async function copyAllTagsMarkdown() {
    const total = totalValue()
    const tickerRows = aggregateByTicker()
    const lines = aggregateByTag()
        .filter(tag => (tag.market_value_krw ?? 0) > 0)
        .flatMap(tag => {
            const rows = tickerRows
                .filter(row => String(primaryTagForTicker(row.ticker)?.id) === String(tag.id))
                .sort((a, b) => (b.market_value_krw ?? 0) - (a.market_value_krw ?? 0))

            return [
                `## ${tag.name} · ${pct(total ? tag.market_value_krw / total * 100 : NaN)}`,
                `${fmtKrw(tag.market_value_krw)} · ${rows.length}\uAC1C \uD1B5\uD569 \uC885\uBAA9`,
                '',
                ...rows.flatMap(row => {
                    const value = fmtMoney(row.market_value_native, row.currency)
                    const converted = row.currency !== 'KRW' ? ` (${fmtKrw(row.market_value_krw)} \uD658\uC0B0)` : ''
                    return [
                        `### ${row.ticker} · ${pct(total ? row.market_value_krw / total * 100 : NaN)}`,
                        row.display_name ?? row.ticker,
                        `${value}${converted}`,
                        '',
                    ]
                }),
            ]
        })

    await writeClipboard(lines.join('\n').trim())
}

async function copyTagMarkdownUnused() {
    const total = totalValue()
    const tag = aggregateByTag().find(item => String(item.id) === String(tagId))
    if (!tag) return

    const rows = aggregateByTicker()
        .filter(row => String(primaryTagForTicker(row.ticker)?.id) === String(tagId))
        .sort((a, b) => (b.market_value_krw ?? 0) - (a.market_value_krw ?? 0))

    const lines = [
        `## ${tag.name}`,
        '',
        `- \uBE44\uC911: ${pct(total ? tag.market_value_krw / total * 100 : NaN)}`,
        `- \uD3C9\uAC00\uAE08\uC561: ${fmtKrw(tag.market_value_krw)}`,
        `- \uD1B5\uD569 \uC885\uBAA9: ${rows.length}\uAC1C`,
        '',
        ...rows.flatMap(row => {
            const value = fmtMoney(row.market_value_native, row.currency)
            const converted = row.currency !== 'KRW' ? ` (${fmtKrw(row.market_value_krw)} \uD658\uC0B0)` : ''
            return [
                `### ${row.ticker} · ${pct(total ? row.market_value_krw / total * 100 : NaN)}`,
                row.display_name ?? row.ticker,
                `${value}${converted}`,
                '',
            ]
        }),
    ]

    await writeClipboard(lines.join('\n').trim())
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
    textarea.style.top = '-999px'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
}

function renderComposition(title, rows, labelFn, total) {
    if (!rows.length || !total) return ''
    const topRows = rows.filter(row => (row.market_value_krw ?? 0) > 0).slice(0, 8)
    if (!topRows.length) return ''
    const colors = ['var(--accent)', 'var(--info)', 'var(--success)', '#a78bfa', 'var(--warning)', '#94a3b8', '#f97316', '#14b8a6']
    const segments = topRows.map((row, index) => {
        const width = row.market_value_krw / total * 100
        return `<span style="width:${width}%;background:${colors[index % colors.length]}"></span>`
    }).join('')
    const legend = topRows.map((row, index) => `
        <div class="leg">
            <span class="dot" style="background:${colors[index % colors.length]}"></span>
            <span class="name">${labelFn(row)}</span>
            <span class="pct">${pct(row.market_value_krw / total * 100)}</span>
            <span class="amt">${fmtKrw(row.market_value_krw)}</span>
        </div>
    `).join('')

    return `
        <section class="composition">
            <div class="composition-head">
                <div>
                    <h2>${title}</h2>
                    <p>전체 평가금액 기준</p>
                </div>
            </div>
            <div class="comp-bar">${segments}</div>
            <div class="comp-legend">${legend}</div>
        </section>`
}

function renderAccounts() {
    const tab = document.getElementById('tab-accounts')
    const accounts = aggregateByAccount()
    tab.innerHTML = `
        <div style="padding:12px 16px">
            <button class="btn-primary" id="add-account">계좌 추가</button>
        </div>
        <ul class="card-list">
            ${accounts.map(account => `
                <li class="card-item" data-account="${account.id}">
                    <div class="card-main">
                        <div class="card-title">${account.name}</div>
                        <div class="card-sub">${account.broker ?? '증권사 없음'} · ${account.count}개 보유</div>
                    </div>
                    <div class="card-right">
                        <div class="card-price">${fmtKrw(account.market_value_krw)}</div>
                    </div>
                </li>
            `).join('')}
        </ul>`

    tab.querySelector('#add-account').addEventListener('click', () => openAccountDrawer(null))
    tab.querySelectorAll('[data-account]').forEach(item => {
        item.addEventListener('click', () => openAccountDrawer(Number(item.dataset.account)))
    })
}

function renderInstruments() {
    const tab = document.getElementById('tab-instruments')
    const instruments = state.instruments.filter(item => item.instrument_type !== 'fx')
    tab.innerHTML = `
        <div style="padding:12px 16px">
            <button class="btn-primary" id="add-instrument">종목 추가</button>
        </div>
        <ul class="card-list">
            ${instruments.map(item => {
                const price = state.prices.find(row => row.ticker === item.ticker)
                return `
                    <li class="card-item" data-instrument="${item.id}">
                        <div class="card-main">
                            <div class="card-title">${item.display_name}</div>
                            <div class="card-sub">${item.ticker} · ${item.currency} · ${tagNames(item.ticker)}</div>
                        </div>
                        <div class="card-right">
                            <div class="card-price">${price ? fmtMoney(price.close_price, item.currency) : '—'}</div>
                            <div class="card-sub">${price?.price_date ?? '가격 없음'}</div>
                        </div>
                    </li>`
            }).join('')}
        </ul>`

    tab.querySelector('#add-instrument').addEventListener('click', () => openInstrumentDrawer(null))
    tab.querySelectorAll('[data-instrument]').forEach(item => {
        item.addEventListener('click', () => openInstrumentDrawer(Number(item.dataset.instrument)))
    })
}

function renderSettings() {
    const tab = document.getElementById('tab-settings')
    const fx = state.instruments.filter(item => item.instrument_type === 'fx')
    tab.innerHTML = `
        <div style="padding:12px 16px;display:grid;gap:8px">
            <button class="btn-primary" id="sync-prices">가격 동기화</button>
            <button class="btn-ghost" id="add-tag">태그 추가</button>
        </div>
        <ul class="card-list">
            <li class="group-header">태그</li>
            ${state.tags.map(tag => `
                <li class="card-item" data-tag="${tag.id}">
                    <div class="card-main">
                        <div class="card-title">${tag.name}</div>
                        <div class="card-sub">${tag.color ?? 'neutral'}</div>
                    </div>
                </li>
            `).join('')}
            <li class="group-header">환율</li>
            ${fx.map(item => {
                const price = state.prices.find(row => row.ticker === item.ticker)
                return `
                    <li class="card-item" data-instrument="${item.id}">
                        <div class="card-main">
                            <div class="card-title">${item.display_name}</div>
                            <div class="card-sub">${item.ticker}</div>
                        </div>
                        <div class="card-right">
                            <div class="card-price">${price ? fmtMoney(price.close_price, item.currency) : '—'}</div>
                            <div class="card-sub">${price?.price_date ?? '가격 없음'}</div>
                        </div>
                    </li>`
            }).join('')}
        </ul>`

    tab.querySelector('#sync-prices').addEventListener('click', syncPrices)
    tab.querySelector('#add-tag').addEventListener('click', () => openTagDrawer(null))
    tab.querySelectorAll('[data-tag]').forEach(item => {
        item.addEventListener('click', () => openTagDrawer(Number(item.dataset.tag)))
    })
    tab.querySelectorAll('[data-instrument]').forEach(item => {
        item.addEventListener('click', () => openInstrumentDrawer(Number(item.dataset.instrument)))
    })
}

async function syncPrices() {
    const button = document.getElementById('sync-prices')
    button.disabled = true
    button.textContent = '동기화 중...'
    try {
        const { error } = await supabase.functions.invoke('sync-prices', { body: {} })
        if (error) alert(error.message)
        await refresh()
    } finally {
        button.disabled = false
        button.textContent = '가격 동기화'
    }
}

function drawer() {
    if (!drawerEl) {
        const overlay = document.createElement('div')
        overlay.className = 'drawer-overlay'
        overlay.addEventListener('click', closeDrawer)
        document.body.appendChild(overlay)

        drawerEl = document.createElement('aside')
        drawerEl.className = 'drawer'
        drawerEl.innerHTML = `
            <div class="drawer-header">
                <h2 class="drawer-title"></h2>
                <button class="drawer-close">×</button>
            </div>
            <div class="drawer-body"></div>
            <div class="drawer-footer"></div>`
        drawerEl.querySelector('.drawer-close').addEventListener('click', closeDrawer)
        document.body.appendChild(drawerEl)
    }
    document.querySelector('.drawer-overlay').classList.add('open')
    drawerEl.classList.add('open')
    applyTailwindRenderedStyles(drawerEl)
    return drawerEl
}

function closeDrawer() {
    document.querySelector('.drawer-overlay')?.classList.remove('open')
    drawerEl?.classList.remove('open')
}

function setDrawer(title, bodyHtml, footerHtml = '') {
    const el = drawer()
    el.querySelector('.drawer-title').textContent = title
    el.querySelector('.drawer-body').innerHTML = bodyHtml
    el.querySelector('.drawer-footer').innerHTML = footerHtml
    applyTailwindRenderedStyles(el)
    return el
}

function openTickerDrawer(ticker) {
    const row = aggregateByTicker().find(item => item.ticker === ticker)
    if (!row) return
    const total = totalValue()
    const accountRows = row.accounts.map(pos => `
        <li class="card-item" data-holding="${pos.id}">
            <div class="card-main">
                <div class="card-title">${pos.account_name}</div>
                <div class="card-sub">수량 ${fmtNum(pos.quantity)} · 평단 ${fmtMoney(pos.avg_price, pos.currency)}</div>
            </div>
            <div class="card-right">
                <div class="card-price">${fmtMoney(pos.market_value_native, pos.currency)}</div>
                ${pos.currency !== 'KRW' ? `<div class="card-sub">${fmtKrw(pos.market_value_krw)} 환산</div>` : ''}
            </div>
        </li>
    `).join('')

    const el = setDrawer(row.display_name ?? ticker, `
        <div class="stat-row">
            <div class="stat-item">
                <div class="stat-label">평가금액</div>
                <div class="stat-value">${fmtMoney(row.market_value_native, row.currency)}</div>
                ${row.currency !== 'KRW' ? `<div class="card-sub">${fmtKrw(row.market_value_krw)} 환산</div>` : ''}
            </div>
            <div class="stat-item">
                <div class="stat-label">전체 비중</div>
                <div class="stat-value">${pct(total ? row.market_value_krw / total * 100 : NaN)}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">총 수량</div>
                <div class="stat-value">${fmtNum(row.quantity)}</div>
            </div>
        </div>
        <ul class="card-list">${accountRows}</ul>
    `, `
        <div class="footer-row">
            <button class="btn-primary flex-1" id="add-holding-for-ticker">계좌 보유 추가</button>
        </div>
    `)

    el.querySelector('#add-holding-for-ticker').addEventListener('click', () => openHoldingDrawer({ ticker }))
    el.querySelectorAll('[data-holding]').forEach(item => {
        item.addEventListener('click', () => openHoldingDrawer({ id: Number(item.dataset.holding) }))
    })
}

function openAccountDrawer(id) {
    const account = state.accounts.find(item => item.id === id)
    const accountHoldings = id ? state.holdings.filter(row => row.account_id === id) : []
    const title = id ? account.name : '계좌 추가'
    const body = `
        <div class="form-group"><label>계좌명</label><input id="account-name" value="${account?.name ?? ''}"></div>
        <div class="form-group"><label>증권사</label><input id="account-broker" value="${account?.broker ?? ''}"></div>
        <div class="form-group"><label>메모</label><textarea id="account-note" rows="2">${account?.note ?? ''}</textarea></div>
        ${id ? `
            <div class="group-header">이 계좌의 보유</div>
            <ul class="card-list">
                ${accountHoldings.map(row => `
                    <li class="card-item" data-holding="${row.id}">
                        <div class="card-main">
                            <div class="card-title">${row.instruments?.display_name ?? row.ticker}</div>
                            <div class="card-sub">${row.ticker} · 수량 ${fmtNum(row.quantity)} · 평단 ${fmtMoney(row.avg_price, row.instruments?.currency)}</div>
                        </div>
                    </li>
                `).join('')}
            </ul>
        ` : ''}`
    const footer = `
        <div class="footer-row">
            ${id ? '<button class="btn-ghost flex-1" id="add-holding">보유 추가</button>' : ''}
            <button class="btn-primary flex-1" id="save-account">저장</button>
        </div>`
    const el = setDrawer(title, body, footer)
    el.querySelector('#save-account').addEventListener('click', async () => {
        const payload = {
            name: el.querySelector('#account-name').value.trim(),
            broker: el.querySelector('#account-broker').value.trim() || null,
            note: el.querySelector('#account-note').value.trim() || null,
            is_active: true,
        }
        if (!payload.name) return alert('계좌명을 입력하세요.')
        const { error } = id
            ? await supabase.from('accounts').update(payload).eq('id', id)
            : await supabase.from('accounts').insert(payload)
        if (error) return alert(error.message)
        await refresh()
        closeDrawer()
    })
    el.querySelector('#add-holding')?.addEventListener('click', () => openHoldingDrawer({ account_id: id }))
    el.querySelectorAll('[data-holding]').forEach(item => {
        item.addEventListener('click', () => openHoldingDrawer({ id: Number(item.dataset.holding) }))
    })
}

function openHoldingDrawer({ id = null, account_id = null, ticker = '' } = {}) {
    if (!state.accounts.length) {
        alert('계좌를 먼저 추가하세요.')
        return
    }
    if (!state.instruments.some(item => item.instrument_type !== 'fx')) {
        alert('종목을 먼저 추가하세요.')
        return
    }

    const holding = state.holdings.find(item => item.id === id)
    const accountOptions = state.accounts.map(account =>
        `<option value="${account.id}"${(holding?.account_id ?? account_id) === account.id ? ' selected' : ''}>${account.name}</option>`
    ).join('')
    const instrumentOptions = state.instruments
        .filter(item => item.instrument_type !== 'fx')
        .map(item => `<option value="${item.ticker}"${(holding?.ticker ?? ticker) === item.ticker ? ' selected' : ''}>${item.display_name} (${item.ticker})</option>`)
        .join('')
    const el = setDrawer(id ? '보유 수정' : '보유 추가', `
        <div class="form-group"><label>계좌</label><select id="holding-account">${accountOptions}</select></div>
        <div class="form-group"><label>종목</label><select id="holding-ticker">${instrumentOptions}</select></div>
        <div class="form-group"><label>수량</label><input id="holding-quantity" type="number" step="any" value="${holding?.quantity ?? ''}"></div>
        <div class="form-group"><label>평균 단가</label><input id="holding-avg" type="number" step="any" value="${holding?.avg_price ?? ''}"></div>
        <div class="form-group"><label>메모</label><textarea id="holding-note" rows="2">${holding?.note ?? ''}</textarea></div>
    `, `
        <div class="footer-row">
            ${id ? '<button class="btn-danger-ghost" id="delete-holding">삭제</button>' : ''}
            <button class="btn-primary flex-1" id="save-holding">저장</button>
        </div>`)

    el.querySelector('#save-holding').addEventListener('click', async () => {
        const payload = {
            account_id: Number(el.querySelector('#holding-account').value),
            ticker: el.querySelector('#holding-ticker').value,
            quantity: Number(el.querySelector('#holding-quantity').value),
            avg_price: Number(el.querySelector('#holding-avg').value),
            note: el.querySelector('#holding-note').value.trim() || null,
        }
        if (!payload.account_id || !payload.ticker || !Number.isFinite(payload.quantity) || !Number.isFinite(payload.avg_price)) {
            return alert('계좌, 종목, 수량, 평균 단가를 입력하세요.')
        }
        const { error } = id
            ? await supabase.from('holdings').update(payload).eq('id', id)
            : await supabase.from('holdings').upsert(payload, { onConflict: 'account_id,ticker' })
        if (error) return alert(error.message)
        await refresh()
        closeDrawer()
    })
    el.querySelector('#delete-holding')?.addEventListener('click', async () => {
        if (!confirm('이 보유 항목을 삭제할까요?')) return
        const { error } = await supabase.from('holdings').delete().eq('id', id)
        if (error) return alert(error.message)
        await refresh()
        closeDrawer()
    })
}

function openInstrumentDrawer(id) {
    const instrument = state.instruments.find(item => item.id === id)
    const selectedTagId = primaryTagForTicker(instrument?.ticker)?.id ?? ''
    const tagOptions = state.tags.map(tag =>
        `<option value="${tag.id}"${selectedTagId === tag.id ? ' selected' : ''}>${tag.name}</option>`
    ).join('')
    const price = state.prices.find(row => row.ticker === instrument?.ticker)
    const el = setDrawer(id ? '종목 수정' : '종목 추가', `
        <div class="form-group"><label>티커</label><input id="instrument-ticker" value="${instrument?.ticker ?? ''}" ${id ? 'disabled' : ''}></div>
        <div class="form-group"><label>종목명</label><input id="instrument-name" value="${instrument?.display_name ?? ''}"></div>
        <div class="form-group"><label>통화</label><select id="instrument-currency">
            ${['KRW', 'USD'].map(cur => `<option value="${cur}"${(instrument?.currency ?? 'KRW') === cur ? ' selected' : ''}>${cur}</option>`).join('')}
        </select></div>
        <div class="form-group"><label>종류</label><select id="instrument-type">
            ${['stock', 'etf', 'fund', 'cash', 'other', 'fx'].map(type => `<option value="${type}"${(instrument?.instrument_type ?? 'etf') === type ? ' selected' : ''}>${type}</option>`).join('')}
        </select></div>
        <div class="form-group"><label>현재가</label><input id="instrument-price" type="number" step="any" value="${price?.close_price ?? ''}"></div>
        <div class="form-group"><label>가격일</label><input id="instrument-price-date" type="date" value="${price?.price_date ?? today()}"></div>
        <div class="form-group"><label>태그</label><select id="instrument-tag"><option value="">태그 없음</option>${tagOptions}</select></div>
    `, `
        <div class="footer-row">
            <button class="btn-primary flex-1" id="save-instrument">저장</button>
        </div>`)

    el.querySelector('#save-instrument').addEventListener('click', async () => {
        const tickerValue = el.querySelector('#instrument-ticker').value.trim()
        const payload = {
            ticker: tickerValue,
            display_name: el.querySelector('#instrument-name').value.trim(),
            currency: el.querySelector('#instrument-currency').value,
            instrument_type: el.querySelector('#instrument-type').value,
            price_source: 'yfinance',
        }
        if (!payload.ticker || !payload.display_name) return alert('티커와 종목명을 입력하세요.')
        const { error } = id
            ? await supabase.from('instruments').update(payload).eq('id', id)
            : await supabase.from('instruments').insert(payload)
        if (error) return alert(error.message)

        const priceValue = Number(el.querySelector('#instrument-price').value)
        if (Number.isFinite(priceValue) && priceValue > 0) {
            await supabase.from('holding_prices_daily').upsert({
                ticker: tickerValue,
                price_date: el.querySelector('#instrument-price-date').value,
                close_price: priceValue,
                source: 'manual',
            }, { onConflict: 'user_id,ticker,price_date' })
        }

        await supabase.from('instrument_tags').delete().eq('ticker', tickerValue)
        const tagId = Number(el.querySelector('#instrument-tag').value)
        if (Number.isFinite(tagId) && tagId > 0) {
            await supabase.from('instrument_tags').insert({
                ticker: tickerValue,
                tag_id: tagId,
            })
        }

        await refresh()
        closeDrawer()
    })
}

function openTagDrawer(id) {
    const tag = state.tags.find(item => item.id === id)
    const el = setDrawer(id ? '태그 수정' : '태그 추가', `
        <div class="form-group"><label>태그명</label><input id="tag-name" value="${tag?.name ?? ''}"></div>
        <div class="form-group"><label>색상</label><select id="tag-color">
            ${['neutral', 'info', 'success', 'warning', 'danger'].map(color => `<option value="${color}"${(tag?.color ?? 'neutral') === color ? ' selected' : ''}>${color}</option>`).join('')}
        </select></div>
    `, `
        <div class="footer-row">
            <button class="btn-primary flex-1" id="save-tag">저장</button>
        </div>`)

    el.querySelector('#save-tag').addEventListener('click', async () => {
        const payload = {
            name: el.querySelector('#tag-name').value.trim(),
            color: el.querySelector('#tag-color').value,
        }
        if (!payload.name) return alert('태그명을 입력하세요.')
        const { error } = id
            ? await supabase.from('tags').update(payload).eq('id', id)
            : await supabase.from('tags').insert(payload)
        if (error) return alert(error.message)
        await refresh()
        closeDrawer()
    })
}

async function refresh() {
    await loadState()
    render()
}

function renderFatalError(error) {
    document.body.classList.remove('auth-pending')
    document.getElementById('total-value').textContent = '불러오기 실패'
    document.getElementById('hero-meta').textContent = error?.message ?? '데이터를 불러오지 못했습니다.'
    document.getElementById('hero-delta').textContent = ''
    document.getElementById('tab-overview').innerHTML = `
        <div class="empty-state">
            <p>로그인 세션은 있지만 데이터를 불러오지 못했습니다.</p>
            <p class="muted">${error?.message ?? ''}</p>
            <button class="btn-primary" id="retry-load">다시 시도</button>
            <button class="btn-ghost" id="error-logout">로그아웃</button>
        </div>`
    document.getElementById('retry-load')?.addEventListener('click', () => location.reload())
    document.getElementById('error-logout')?.addEventListener('click', signOut)
}

try {
    await refresh()
    document.body.classList.remove('auth-pending')
} catch (error) {
    console.error(error)
    renderFatalError(error)
}
