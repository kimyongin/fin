import { supabase, requireAuth, signOut } from './supabase.js?v=auth-guard-2'

const session = await requireAuth()
if (!session) throw new Error('unauthenticated')
document.body.classList.remove('auth-pending')

document.getElementById('logout-btn').addEventListener('click', signOut)

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

const fmtKrw = value => Number.isFinite(value) ? KRW.format(Math.round(value)) : '—'
const fmtNum = value => Number.isFinite(value) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'
const pct = value => Number.isFinite(value) ? `${value.toFixed(1)}%` : '—'
const today = () => new Date().toISOString().slice(0, 10)

document.querySelectorAll('.nav-tab').forEach(button => {
    button.addEventListener('click', () => {
        activeTab = button.dataset.tab
        document.querySelectorAll('.nav-tab').forEach(btn => btn.classList.remove('active'))
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'))
        button.classList.add('active')
        document.getElementById(`tab-${activeTab}`).classList.remove('hidden')
        render()
    })
})

async function loadState() {
    const [
        { data: accounts },
        { data: holdings },
        { data: instruments },
        { data: tags },
        { data: instrumentTags },
        { data: positions },
        { data: prices },
    ] = await Promise.all([
        supabase.from('accounts').select('*').order('name'),
        supabase.from('holdings').select('*, accounts(name), instruments(display_name, currency, instrument_type)').order('account_id'),
        supabase.from('instruments').select('*').order('display_name'),
        supabase.from('tags').select('*').order('sort_order'),
        supabase.from('instrument_tags').select('ticker, tag_id, tags(id, name, color)'),
        supabase.from('portfolio_view').select('*'),
        supabase.from('holding_prices_daily').select('ticker, price_date, close_price, source').order('price_date', { ascending: false }),
    ])

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

function tagNames(ticker) {
    const tags = tagsForTicker(ticker).map(tag => tag.name)
    return tags.length ? tags.join(', ') : '태그 없음'
}

function aggregateByTicker() {
    const map = new Map()
    for (const pos of state.positions) {
        const prev = map.get(pos.ticker) ?? {
            ticker: pos.ticker,
            display_name: pos.display_name,
            currency: pos.currency,
            quantity: 0,
            market_value_krw: 0,
            unrealized_pnl_krw: 0,
            accounts: [],
        }
        prev.quantity += pos.quantity ?? 0
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
        const tags = tagsForTicker(pos.ticker)
        for (const tag of tags) {
            const prev = map.get(tag.id) ?? { ...tag, market_value_krw: 0 }
            prev.market_value_krw += pos.market_value_krw ?? 0
            map.set(tag.id, prev)
        }
    }
    return [...map.values()].sort((a, b) => b.market_value_krw - a.market_value_krw)
}

function render() {
    renderHero()
    if (activeTab === 'overview') renderOverview()
    if (activeTab === 'accounts') renderAccounts()
    if (activeTab === 'instruments') renderInstruments()
    if (activeTab === 'settings') renderSettings()
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
    const accounts = aggregateByAccount()

    if (!tickers.length) {
        tab.innerHTML = `
            <p class="empty-state">아직 보유 항목이 없습니다. 계좌와 종목을 만든 뒤 계좌 메뉴에서 보유를 추가하세요.</p>`
        return
    }

    tab.innerHTML = `
        ${renderComposition('종목 비중', tickers, row => row.display_name ?? row.ticker, total)}
        ${renderComposition('태그 비중', tags, row => row.name, total)}
        ${renderComposition('계좌 비중', accounts, row => row.name, total)}
        <ul class="card-list">
            ${tickers.map(row => `
                <li class="card-item" data-ticker="${row.ticker}">
                    <div class="card-main">
                        <div class="card-title">${row.display_name ?? row.ticker}</div>
                        <div class="card-sub">${row.ticker} · ${row.currency ?? ''} · ${tagNames(row.ticker)}</div>
                    </div>
                    <div class="card-right">
                        <span class="badge badge-neutral">${pct(total ? row.market_value_krw / total * 100 : NaN)}</span>
                        <div class="card-price">${fmtKrw(row.market_value_krw)}</div>
                        <div class="card-sub">${fmtNum(row.quantity)}주</div>
                    </div>
                </li>
            `).join('')}
        </ul>`

    tab.querySelectorAll('[data-ticker]').forEach(item => {
        item.addEventListener('click', () => openTickerDrawer(item.dataset.ticker))
    })
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
                            <div class="card-price">${price ? fmtNum(price.close_price) : '—'}</div>
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
                            <div class="card-price">${price ? fmtNum(price.close_price) : '—'}</div>
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
                <div class="card-sub">수량 ${fmtNum(pos.quantity)} · 평단 ${fmtNum(pos.avg_price)}</div>
            </div>
            <div class="card-right">
                <div class="card-price">${fmtKrw(pos.market_value_krw)}</div>
            </div>
        </li>
    `).join('')

    const el = setDrawer(row.display_name ?? ticker, `
        <div class="stat-row">
            <div class="stat-item">
                <div class="stat-label">평가금액</div>
                <div class="stat-value">${fmtKrw(row.market_value_krw)}</div>
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
                            <div class="card-sub">${row.ticker} · 수량 ${fmtNum(row.quantity)} · 평단 ${fmtNum(row.avg_price)}</div>
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
    const selectedTags = new Set(state.instrumentTags.filter(row => row.ticker === instrument?.ticker).map(row => row.tag_id))
    const tagChecks = state.tags.map(tag => `
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <input type="checkbox" class="instrument-tag" value="${tag.id}" ${selectedTags.has(tag.id) ? 'checked' : ''}>
            <span>${tag.name}</span>
        </label>
    `).join('')
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
        <div class="form-group"><label>태그</label>${tagChecks || '<p class="empty-state">설정에서 태그를 먼저 추가하세요.</p>'}</div>
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
        const tagRows = [...el.querySelectorAll('.instrument-tag:checked')].map(input => ({
            ticker: tickerValue,
            tag_id: Number(input.value),
        }))
        if (tagRows.length) await supabase.from('instrument_tags').insert(tagRows)

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

await refresh()
