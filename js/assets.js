import { supabase, requireAuth, signOut } from './supabase.js'

const session = await requireAuth()
if (!session) throw new Error('unauthenticated')

document.getElementById('logout-btn').addEventListener('click', signOut)

let activeTab = 'accounts'
let drawerEl = null
let allAccounts = []
let allInstruments = []
let allTags = []
let allPositions = []
let positionsTotalKrw = 0
let posTagFilters = new Set()
let tagsByTickerMap = {}
let txOffset = 0
let txHasMore = true
let txFilters = {}
const TX_PAGE = 30

const CHART_PALETTE = ['var(--accent)', 'var(--info)', 'var(--success)', '#a78bfa', 'var(--warning)', '#64748b']
const fmtM = v => `₩${((v || 0) / 1_000_000).toFixed(1)}M`

// ── Tab switching ─────────────────────────────────────────────────────
document.querySelectorAll('.tab-bar button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'))
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'))
        btn.classList.add('active')
        document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden')
        activeTab = btn.dataset.tab
        updateFab()
    })
})

// ── FAB ───────────────────────────────────────────────────────────────
function updateFab() {
    let fab = document.getElementById('fab')
    if (!fab) {
        fab = document.createElement('button')
        fab.id = 'fab'
        fab.className = 'fab'
        fab.textContent = '+'
        document.querySelector('.page-content').appendChild(fab)
    }
    fab.onclick = () => openDrawer(activeTab === 'transactions' ? 'transaction' : 'account', null)
}

// ── Hero ─────────────────────────────────────────────────────────────
async function loadHero() {
    const [
        { data: pvRows },
        { data: snapshots },
        { data: accountRows }
    ] = await Promise.all([
        supabase.from('portfolio_view').select('market_value_krw, price_date, account_id'),
        supabase.from('portfolio_snapshots').select('snapshot_date, total_value_krw').order('snapshot_date', { ascending: false }).limit(10),
        supabase.from('accounts').select('id')
    ])

    const total = (pvRows ?? []).reduce((s, r) => s + (r.market_value_krw ?? 0), 0)
    document.getElementById('total-value').textContent = total
        ? `₩${Math.round(total).toLocaleString()}`
        : '₩0'

    const today = new Date()
    const monthStart = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`
    const prevSnap = (snapshots ?? []).find(s => s.snapshot_date < monthStart)
    const deltaEl = document.getElementById('hero-delta')
    if (deltaEl) {
        if (prevSnap && total) {
            const delta = total - prevSnap.total_value_krw
            const pct = prevSnap.total_value_krw > 0
                ? (delta / prevSnap.total_value_krw * 100).toFixed(1) : '0.0'
            const sign = delta >= 0 ? '+' : ''
            deltaEl.textContent = `${sign}₩${Math.round(delta).toLocaleString()} (${sign}${pct}%)`
            deltaEl.className = `hero-delta ${delta >= 0 ? 'text-success' : 'text-danger'}`
        } else {
            deltaEl.textContent = ''
        }
    }

    const accCount = accountRows?.length ?? 0
    const posCount = pvRows?.length ?? 0
    const lastPriceDate = (pvRows ?? []).reduce((max, r) => r.price_date > (max ?? '') ? r.price_date : max, null)
    document.getElementById('hero-meta').textContent =
        `${accCount}개 계좌 · ${posCount}개 종목${lastPriceDate ? ` · 마지막 가격 ${lastPriceDate}` : ''}`

    const notice = document.getElementById('price-notice')
    if (notice && pvRows?.length) {
        const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10)
        const hasMissing = pvRows.some(r => !r.price_date || r.price_date < fiveDaysAgo)
        notice.classList.toggle('hidden', !hasMissing)
    }
}

// ── Accounts Tab ──────────────────────────────────────────────────────
async function loadAccounts() {
    const tab = document.getElementById('tab-accounts')

    const [
        { data: accounts },
        { data: holdingRows },
        { data: pvRows }
    ] = await Promise.all([
        supabase.from('accounts').select().order('id'),
        supabase.from('holdings').select('account_id, ticker, quantity'),
        supabase.from('portfolio_view').select('account_id, market_value_krw')
    ])

    allAccounts = accounts ?? []

    if (!allAccounts.length) {
        tab.innerHTML = '<p class="empty-state">계좌가 없습니다.</p>'
        return
    }

    const krwByAccount = {}
    const countByAccount = {}
    for (const r of pvRows ?? []) {
        krwByAccount[r.account_id] = (krwByAccount[r.account_id] ?? 0) + (r.market_value_krw ?? 0)
    }
    for (const r of holdingRows ?? []) {
        if ((r.quantity ?? 0) > 0)
            countByAccount[r.account_id] = (countByAccount[r.account_id] ?? 0) + 1
    }

    tab.innerHTML = '<ul class="card-list"></ul>'
    const list = tab.querySelector('.card-list')
    for (const acc of allAccounts) {
        const totalKrw = krwByAccount[acc.id] ?? 0
        const instrCount = countByAccount[acc.id] ?? 0
        const li = document.createElement('li')
        li.className = 'card-item'
        li.innerHTML = `
            <div class="card-main">
                <div class="card-title">${acc.name}</div>
                <div class="card-sub">${acc.broker ?? '증권사 미등록'}</div>
            </div>
            <div class="card-right">
                <span class="badge ${acc.is_active ? 'badge-success' : 'badge-neutral'}">${acc.is_active ? '활성' : '비활성'}</span>
                <div class="card-price">${totalKrw ? `₩${Math.round(totalKrw).toLocaleString()}` : '—'}</div>
                <div class="card-sub">${instrCount}종목</div>
            </div>`
        li.addEventListener('click', () => openDrawer('account', acc.id))
        list.appendChild(li)
    }
}

// ── Drawer header reset (restores standard layout after position drawer) ──
function resetDrawerHeader(drawer) {
    drawer.querySelector('.drawer-header').innerHTML = `
        <h2 class="drawer-title"></h2>
        <button class="drawer-close">✕</button>`
    drawer.querySelector('.drawer-close').addEventListener('click', closeDrawer)
}

// ── Account Drawer ────────────────────────────────────────────────────
async function renderAccountDrawer(drawer, id, mode = id ? 'view' : 'create') {
    resetDrawerHeader(drawer)
    let acc = null
    if (id) {
        const { data } = await supabase.from('accounts').select().eq('id', id).single()
        acc = data
    }

    drawer.querySelector('.drawer-title').textContent =
        mode === 'create' ? '계좌 추가' : (acc?.name ?? '')

    const body = drawer.querySelector('.drawer-body')
    const footer = drawer.querySelector('.drawer-footer')

    if (mode === 'delete-confirm') {
        body.innerHTML = `<div class="confirm-msg">정말 <strong>${acc?.name}</strong> 계좌를 삭제할까요?<br>연결된 거래 내역도 모두 삭제됩니다.</div>`
        footer.innerHTML = `
            <div class="footer-row">
                <button class="btn-ghost flex-1" id="d-cancel">취소</button>
                <button class="btn-danger flex-1" id="d-confirm">삭제</button>
            </div>`
        footer.querySelector('#d-cancel').onclick = () => renderAccountDrawer(drawer, id, 'view')
        footer.querySelector('#d-confirm').onclick = async () => {
            await supabase.from('accounts').delete().eq('id', id)
            closeDrawer()
            await Promise.all([loadAccounts(), loadHero()])
        }
        return
    }

    const ro = mode === 'view'
    body.innerHTML = `
        <div class="form-group"><label>계좌명</label>
            <input id="f-name" type="text" value="${acc?.name ?? ''}" ${ro ? 'disabled' : ''}></div>
        <div class="form-group"><label>증권사</label>
            <input id="f-broker" type="text" value="${acc?.broker ?? ''}" ${ro ? 'disabled' : ''}></div>
        <div class="form-group"><label>메모</label>
            <textarea id="f-note" rows="2" ${ro ? 'disabled' : ''}>${acc?.note ?? ''}</textarea></div>
        <div class="form-group" style="flex-direction:row;align-items:center;gap:8px">
            <input id="f-active" type="checkbox" ${acc?.is_active !== false ? 'checked' : ''} ${ro ? 'disabled' : ''} style="width:auto">
            <label for="f-active" style="margin:0;font-size:14px">활성</label>
        </div>`

    if (ro) {
        footer.innerHTML = `<div class="footer-row"><button class="btn-primary flex-1" id="d-edit">편집</button></div>`
        footer.querySelector('#d-edit').onclick = () => renderAccountDrawer(drawer, id, 'edit')
    } else {
        footer.innerHTML = `
            <div class="footer-row">
                ${mode === 'edit' ? `<button class="btn-danger-ghost" id="d-delete">삭제</button>` : ''}
                <button class="btn-ghost flex-1" id="d-cancel">취소</button>
                <button class="btn-primary flex-1" id="d-save">저장</button>
            </div>`
        if (mode === 'edit') {
            footer.querySelector('#d-delete').onclick = () => renderAccountDrawer(drawer, id, 'delete-confirm')
        }
        footer.querySelector('#d-cancel').onclick = () =>
            mode === 'create' ? closeDrawer() : renderAccountDrawer(drawer, id, 'view')
        footer.querySelector('#d-save').onclick = async () => {
            const payload = {
                name: body.querySelector('#f-name').value.trim(),
                broker: body.querySelector('#f-broker').value.trim() || null,
                note: body.querySelector('#f-note').value.trim() || null,
                is_active: body.querySelector('#f-active').checked,
            }
            const { error } = mode === 'create'
                ? await supabase.from('accounts').insert(payload)
                : await supabase.from('accounts').update(payload).eq('id', id)
            if (error) { alert(error.message); return }
            closeDrawer()
            await loadAccounts()
        }
    }
}

// ── Transactions Tab ──────────────────────────────────────────────────
async function loadTransactions(append = false) {
    if (!append) {
        txOffset = 0
        txHasMore = true
    }

    const tab = document.getElementById('tab-transactions')

    if (!allAccounts.length) {
        const { data } = await supabase.from('accounts').select('id, name').order('id')
        allAccounts = data ?? []
    }
    if (!allInstruments.length) {
        const { data } = await supabase.from('instruments').select('id, ticker, display_name, currency').neq('instrument_type', 'fx').order('display_name')
        allInstruments = data ?? []
    }
    if (!allTags.length) {
        const { data } = await supabase.from('tags').select('id, name, color').order('sort_order')
        allTags = data ?? []
    }

    let query = supabase
        .from('transactions')
        .select('*, instruments(display_name, currency, instrument_tags(tag_id, tags(name, color))), accounts(name)')
        .order('trade_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(txOffset, txOffset + TX_PAGE - 1)

    if (txFilters.account_id) query = query.eq('account_id', txFilters.account_id)
    if (txFilters.ticker) query = query.eq('ticker', txFilters.ticker)
    if (txFilters.trade_type) query = query.eq('trade_type', txFilters.trade_type)
    if (txFilters.has_pnl) query = query.not('realized_pnl_krw', 'is', null)
    if (txFilters.period) {
        const from = periodFrom(txFilters.period)
        if (from) query = query.gte('trade_date', from)
    }
    if (txFilters.tag_id) {
        const { data: tagged } = await supabase
            .from('instrument_tags')
            .select('ticker')
            .eq('tag_id', txFilters.tag_id)
        const tickers = (tagged ?? []).map(r => r.ticker)
        if (!tickers.length) {
            renderEmptyTransactions(tab, append)
            return
        }
        query = query.in('ticker', tickers)
    }

    const { data: txs } = await query
    txHasMore = (txs?.length ?? 0) === TX_PAGE

    if (!append) {
        if (!txs?.length) {
            tab.innerHTML = `
                <div id="tx-filter-bar" class="filter-bar"></div>
                <p class="empty-state">거래 내역이 없습니다.</p>`
            renderFilterBar()
            return
        }
        tab.innerHTML = `
            <div id="tx-filter-bar" class="filter-bar"></div>
            <ul id="tx-list" class="card-list"></ul>
            <div id="tx-footer"></div>`
        renderFilterBar()
    }

    renderTxCards(txs ?? [], append)

    const footerEl = document.getElementById('tx-footer')
    if (footerEl) {
        footerEl.innerHTML = txHasMore
            ? `<button class="load-more-btn" id="load-more">이전 거래 더 보기</button>`
            : ''
        document.getElementById('load-more')?.addEventListener('click', async () => {
            txOffset += TX_PAGE
            await loadTransactions(true)
        })
    }
}

function renderEmptyTransactions(tab, append) {
    if (!append) {
        tab.innerHTML = `
            <div id="tx-filter-bar" class="filter-bar"></div>
            <p class="empty-state">해당 조건의 거래가 없습니다.</p>`
        renderFilterBar()
    }
}

function periodFrom(period) {
    const now = new Date()
    if (period === 'this-month') return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`
    if (period === 'last-month') return new Date(now.getFullYear(), now.getMonth()-1, 1).toISOString().slice(0, 10)
    if (period === '3m') return new Date(now - 90*86400000).toISOString().slice(0, 10)
    if (period === '6m') return new Date(now - 180*86400000).toISOString().slice(0, 10)
    if (period === '1y') return new Date(now - 365*86400000).toISOString().slice(0, 10)
    return null
}

function renderFilterBar() {
    const bar = document.getElementById('tx-filter-bar')
    if (!bar) return

    const tagChips = allTags.map(t =>
        `<button class="chip chip-${t.color}${txFilters.tag_id === t.id ? ' selected' : ''}" data-fk="tag_id" data-fv="${t.id}">${t.name}</button>`
    ).join('')

    const accountOpts = ['<option value="">전체 계좌</option>',
        ...allAccounts.map(a => `<option value="${a.id}"${txFilters.account_id == a.id ? ' selected' : ''}>${a.name}</option>`)
    ].join('')
    const tickerOpts = ['<option value="">전체 종목</option>',
        ...allInstruments.map(i => `<option value="${i.ticker}"${txFilters.ticker === i.ticker ? ' selected' : ''}>${i.display_name}</option>`)
    ].join('')

    bar.innerHTML = `
        <div class="filter-chips">
            <button class="chip chip-neutral${txFilters.trade_type === 'BUY' ? ' selected' : ''}" data-fk="trade_type" data-fv="BUY">BUY</button>
            <button class="chip chip-neutral${txFilters.trade_type === 'SELL' ? ' selected' : ''}" data-fk="trade_type" data-fv="SELL">SELL</button>
            <button class="chip chip-neutral${txFilters.period === 'this-month' ? ' selected' : ''}" data-fk="period" data-fv="this-month">이번달</button>
            <button class="chip chip-neutral${txFilters.period === '3m' ? ' selected' : ''}" data-fk="period" data-fv="3m">3개월</button>
            <button class="chip chip-neutral${txFilters.period === '6m' ? ' selected' : ''}" data-fk="period" data-fv="6m">6개월</button>
            <button class="chip chip-neutral${txFilters.has_pnl ? ' selected' : ''}" data-fk="has_pnl" data-fv="1">실현손익</button>
            ${tagChips}
        </div>
        <div class="filter-extra">
            <select id="f-flt-account">${accountOpts}</select>
            <select id="f-flt-ticker">${tickerOpts}</select>
        </div>`

    bar.querySelectorAll('.chip[data-fk]').forEach(btn => {
        btn.addEventListener('click', () => {
            const k = btn.dataset.fk
            const v = btn.dataset.fv
            if (k === 'has_pnl') {
                txFilters.has_pnl = !txFilters.has_pnl
            } else if (k === 'tag_id') {
                txFilters.tag_id = txFilters.tag_id === Number(v) ? null : Number(v)
            } else {
                txFilters[k] = txFilters[k] === v ? null : v
            }
            loadTransactions()
        })
    })
    bar.querySelector('#f-flt-account')?.addEventListener('change', e => {
        txFilters.account_id = e.target.value ? Number(e.target.value) : null
        loadTransactions()
    })
    bar.querySelector('#f-flt-ticker')?.addEventListener('change', e => {
        txFilters.ticker = e.target.value || null
        loadTransactions()
    })
}

function renderTxCards(txs, append) {
    const list = document.getElementById('tx-list')
    if (!list) return
    if (!append) list.innerHTML = ''

    let lastMonth = null
    for (const tx of txs) {
        const month = tx.trade_date.slice(0, 7)
        if (month !== lastMonth) {
            lastMonth = month
            const header = document.createElement('li')
            header.className = 'group-header'
            header.textContent = month
            list.appendChild(header)
        }

        const tags = tx.instruments?.instrument_tags?.map(t =>
            `<span class="chip chip-${t.tags?.color ?? 'neutral'}">${t.tags?.name}</span>`
        ).join('') ?? ''

        const isSell = tx.trade_type === 'SELL'
        const currency = tx.instruments?.currency ?? ''
        const amountStr = currency === 'KRW'
            ? `₩${Math.round(tx.amount).toLocaleString()}`
            : `${currency} ${tx.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`

        const pnlBadge = isSell && tx.realized_pnl_krw != null
            ? `<span class="badge ${tx.realized_pnl_krw >= 0 ? 'badge-success' : 'badge-danger'}">${tx.realized_pnl_krw >= 0 ? '+' : ''}₩${Math.round(tx.realized_pnl_krw).toLocaleString()}</span>`
            : tx.fee ? `<span class="muted" style="font-size:11px">수수료 ${tx.fee}</span>` : ''

        const li = document.createElement('li')
        li.className = 'card-item'
        li.innerHTML = `
            <div class="card-main" style="width:100%">
                <div style="display:flex;justify-content:space-between;align-items:baseline">
                    <span class="card-sub">${tx.trade_date} · <strong>${tx.trade_type}</strong></span>
                    <span class="card-price">${amountStr}</span>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:4px">
                    <div>
                        <div class="card-title" style="font-size:13px">${tx.instruments?.display_name ?? tx.ticker} · ${tx.accounts?.name ?? ''}</div>
                        <div class="card-chips" style="margin-top:2px">${tags}</div>
                    </div>
                    <div style="text-align:right;font-size:12px;color:var(--muted)">
                        <div>${tx.quantity} × ${tx.price}</div>
                        <div style="margin-top:2px">${pnlBadge}</div>
                    </div>
                </div>
            </div>`
        li.addEventListener('click', () => openDrawer('transaction', tx.id))
        list.appendChild(li)
    }
}

// ── Positions Tab ─────────────────────────────────────────────────────
async function loadPositions() {
    const tab = document.getElementById('tab-positions')

    if (!allTags.length) {
        const { data } = await supabase.from('tags').select('id, name, color').order('sort_order')
        allTags = data ?? []
    }

    const [{ data: pvRows }, { data: instrTags }] = await Promise.all([
        supabase.from('portfolio_view').select('*'),
        supabase.from('instrument_tags').select('ticker, tags(id, name, color)')
    ])

    if (!pvRows?.length) {
        tab.innerHTML = `
            <p class="empty-state">보유 종목이 없습니다.</p>
            <div style="text-align:center;padding:0 16px 16px">
                <button class="btn-primary" id="goto-tx">거래 추가</button>
            </div>`
        tab.querySelector('#goto-tx')?.addEventListener('click', () => {
            document.querySelector('[data-tab="transactions"]').click()
        })
        return
    }

    tagsByTickerMap = {}
    for (const it of instrTags ?? []) {
        if (!tagsByTickerMap[it.ticker]) tagsByTickerMap[it.ticker] = []
        tagsByTickerMap[it.ticker].push(it.tags)
    }

    positionsTotalKrw = pvRows.reduce((s, r) => s + (r.market_value_krw ?? 0), 0)
    allPositions = [...pvRows].sort((a, b) => {
        if (a.account_id !== b.account_id) return a.account_id - b.account_id
        return (b.market_value_krw ?? 0) - (a.market_value_krw ?? 0)
    })

    tab.innerHTML = `
        <div id="pos-filter-bar" class="filter-bar" style="padding:8px 16px 4px"></div>
        <div id="pos-chart-area" style="padding:0 16px 8px"></div>
        <ul id="pos-list" class="card-list"></ul>`

    renderPositionsView()
}

function renderPositionsView() {
    const filterBar = document.getElementById('pos-filter-bar')
    const chartArea = document.getElementById('pos-chart-area')
    const list = document.getElementById('pos-list')
    if (!filterBar || !chartArea || !list) return

    const filteredPositions = posTagFilters.size === 0
        ? allPositions
        : allPositions.filter(pos => {
            const posTags = (tagsByTickerMap[pos.ticker] ?? []).map(t => t?.id)
            for (const tagId of posTagFilters) {
                if (!posTags.includes(tagId)) return false
            }
            return true
        })

    // Tag pills — only show tags present in at least one position
    const tagsInPositions = new Set()
    for (const pos of allPositions) {
        for (const t of tagsByTickerMap[pos.ticker] ?? []) {
            if (t?.id) tagsInPositions.add(t.id)
        }
    }
    const tagPills = allTags
        .filter(t => tagsInPositions.has(t.id))
        .map(t => `<button class="chip chip-${t.color}${posTagFilters.has(t.id) ? ' selected' : ''}" data-tag-id="${t.id}">${t.name}</button>`)
        .join('')

    filterBar.innerHTML = tagPills
        ? `<div class="filter-chips">${tagPills}</div>`
        : ''

    filterBar.querySelectorAll('.chip[data-tag-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = Number(btn.dataset.tagId)
            if (posTagFilters.has(id)) posTagFilters.delete(id)
            else posTagFilters.add(id)
            renderPositionsView()
        })
    })

    // Composition bar chart
    const filteredTotal = filteredPositions.reduce((s, p) => s + (p.market_value_krw ?? 0), 0)
    if (filteredPositions.length && filteredTotal > 0) {
        const segments = filteredPositions.map((pos, i) => {
            const w = ((pos.market_value_krw ?? 0) / filteredTotal * 100).toFixed(2)
            const color = CHART_PALETTE[i % CHART_PALETTE.length]
            const posIdx = allPositions.indexOf(pos)
            return { pos, w: Number(w), color, posIdx }
        })

        const headingTitle = posTagFilters.size === 0 ? '전체 자산 구성' : '선택 태그 자산 구성'
        const metaText = posTagFilters.size === 0
            ? `태그 미선택 · ${filteredPositions.length}종목`
            : `${[...posTagFilters].map(id => allTags.find(t => t.id === id)?.name).filter(Boolean).join(' + ')} · ${filteredPositions.length}종목`

        const barSegments = segments.map(({ pos, w, color, posIdx }) =>
            `<span style="width:${w}%;background:${color}" title="${pos.display_name} ${w}%" data-pos-idx="${posIdx}"></span>`
        ).join('')

        const legendItems = segments.map(({ pos, w, color, posIdx }) =>
            `<button class="leg" data-pos-idx="${posIdx}">
                <span class="dot" style="background:${color}"></span>
                <span class="name">${pos.display_name}</span>
                <span class="pct">${w}%</span>
                <span class="amt">${fmtM(pos.market_value_krw)}</span>
            </button>`
        ).join('')

        chartArea.innerHTML = `
            <div class="composition">
                <div class="composition-head">
                    <div>
                        <h2>${headingTitle}</h2>
                        <p>${metaText}</p>
                    </div>
                </div>
                <div class="comp-bar">${barSegments}</div>
                <div class="comp-legend">${legendItems}</div>
            </div>`

        chartArea.querySelectorAll('[data-pos-idx]').forEach(el => {
            el.addEventListener('click', () => openPositionDrawer(Number(el.dataset.posIdx)))
        })
    } else {
        chartArea.innerHTML = ''
    }

    // Position cards
    list.innerHTML = ''
    if (!filteredPositions.length) {
        const li = document.createElement('li')
        li.innerHTML = '<p class="empty-state">필터에 맞는 종목이 없습니다.</p>'
        list.appendChild(li)
        return
    }

    let lastAccountId = null
    for (const pos of filteredPositions) {
        if (pos.account_id !== lastAccountId) {
            lastAccountId = pos.account_id
            const header = document.createElement('li')
            header.className = 'group-header'
            header.textContent = pos.account_name ?? `계좌 ${pos.account_id}`
            list.appendChild(header)
        }

        const tags = (tagsByTickerMap[pos.ticker] ?? []).map(t =>
            `<span class="chip chip-${t?.color ?? 'neutral'}">${t?.name}</span>`
        ).join('')

        const pnlPct = pos.avg_price && pos.close_price
            ? ((pos.close_price - pos.avg_price) / pos.avg_price * 100).toFixed(1)
            : null
        const pnlClass = pnlPct == null ? 'badge-neutral' : (Number(pnlPct) >= 0 ? 'badge-success' : 'badge-danger')
        const pnlText = pnlPct == null ? '—' : `${Number(pnlPct) >= 0 ? '+' : ''}${pnlPct}%`

        const li = document.createElement('li')
        li.className = 'card-item'
        li.innerHTML = `
            <div class="card-main">
                <div class="card-title">${pos.display_name}</div>
                <div class="card-sub">${pos.ticker} · ${pos.currency}</div>
                <div class="card-chips">${tags}</div>
            </div>
            <div class="card-right">
                <span class="badge ${pnlClass}">${pnlText}</span>
                <div class="card-price">${pos.market_value_krw ? `₩${Math.round(pos.market_value_krw).toLocaleString()}` : '—'}</div>
                <div class="card-sub">${pos.quantity} · ${pos.avg_price?.toLocaleString()}</div>
            </div>`
        const posIdx = allPositions.indexOf(pos)
        li.addEventListener('click', () => openPositionDrawer(posIdx))
        list.appendChild(li)
    }
}

// ── Position price chart ──────────────────────────────────────────────
async function renderPositionChart(container, pos, range) {
    container.innerHTML = '<p class="empty-state" style="padding:8px 0;font-size:12px">로딩 중...</p>'

    const now = new Date()
    let since = null
    if (range === '1M') since = new Date(now - 30 * 86400000).toISOString().slice(0, 10)
    else if (range === '3M') since = new Date(now - 90 * 86400000).toISOString().slice(0, 10)

    let priceQuery = supabase
        .from('holding_prices_daily')
        .select('price_date, close_price')
        .eq('ticker', pos.ticker)
        .order('price_date')
    if (since) priceQuery = priceQuery.gte('price_date', since)

    const [{ data: prices }, { data: txs }] = await Promise.all([
        priceQuery,
        supabase.from('transactions')
            .select('trade_date, trade_type, price, quantity')
            .eq('ticker', pos.ticker)
            .eq('account_id', pos.account_id)
            .order('trade_date')
    ])

    if (!prices?.length) {
        container.innerHTML = '<p class="empty-state" style="padding:8px 0;font-size:12px">가격 데이터 없음</p>'
        return
    }

    const W = 400, H = 140
    const n = prices.length
    const currency = pos.currency ?? 'KRW'

    const vals = prices.map(p => p.close_price)
    const minP = Math.min(...vals)
    const maxP = Math.max(...vals)
    const priceRange = Math.max(1, maxP - minP)

    const xFn = i => 20 + (n > 1 ? i * 366 / (n - 1) : 183)
    const yFn = v => 115 - ((v - minP) / priceRange) * 82

    const pts = prices.map((p, i) => `${xFn(i).toFixed(1)},${yFn(p.close_price).toFixed(1)}`)

    const fmtP = p => {
        if (currency === 'KRW') return p >= 10000 ? `${(p / 1000).toFixed(0)}K` : p.toFixed(0)
        return p >= 1000 ? `$${(p / 1000).toFixed(1)}K` : `$${p.toFixed(2)}`
    }

    const gridLines = [35, 75, 115].map(y =>
        `<line class="grid" x1="0" y1="${y}" x2="${W}" y2="${y}"/>`
    ).join('')

    const axisLabels = `
        <text class="ytx" x="395" y="32" text-anchor="end">${fmtP(maxP)}</text>
        <text class="ytx" x="395" y="118" text-anchor="end">${fmtP(minP)}</text>`

    // BUY/SELL circles at price coordinates
    const dateIndexMap = {}
    prices.forEach((p, i) => { dateIndexMap[p.price_date] = i })
    const txInRange = (txs ?? []).filter(tx => !since || tx.trade_date >= since)

    const markers = txInRange.map(tx => {
        const idx = dateIndexMap[tx.trade_date]
        if (idx == null) return ''
        const cx = xFn(idx).toFixed(1)
        const cy = yFn(prices[idx].close_price).toFixed(1)
        const cls = tx.trade_type === 'BUY' ? 'buy' : 'sell'
        return `<circle class="${cls}" cx="${cx}" cy="${cy}" r="5"><title>${tx.trade_date} ${tx.trade_type} ${tx.quantity}주 @${tx.price}</title></circle>`
    }).join('')

    const areaPath = `M${pts.join(' L')} L${xFn(n - 1).toFixed(1)},130 L20,130 Z`
    const linePath = `M${pts.join(' L')}`

    container.innerHTML = `
        <div class="chart">
            <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
                ${gridLines}
                <path class="area" d="${areaPath}"/>
                <path class="line" d="${linePath}"/>
                ${axisLabels}
                ${markers}
            </svg>
            <div class="chart-axis">
                <span>${prices[0].price_date}</span>
                <span class="cur">최근 ${fmtP(vals[n - 1])}</span>
                <span>${prices[n - 1].price_date}</span>
            </div>
            <div class="chart-legend">
                <span><span class="m buy"></span>BUY</span>
                <span><span class="m sell"></span>SELL</span>
                <span><span class="m line"></span>종가</span>
            </div>
        </div>`
}

// ── Position Drawer ───────────────────────────────────────────────────
async function openPositionDrawer(idx) {
    const drawer = getOrCreateDrawer()
    document.querySelector('.drawer-overlay').classList.add('open')
    drawer.classList.add('open')
    await renderPositionDrawer(drawer, idx)
}

async function renderPositionDrawer(drawer, idx) {
    const pos = allPositions[idx]
    const n = allPositions.length
    const weight = positionsTotalKrw ? ((pos.market_value_krw ?? 0) / positionsTotalKrw * 100).toFixed(1) : 0
    const pnlKrw = pos.unrealized_pnl_krw

    // Custom header with prev/next
    drawer.querySelector('.drawer-header').innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
            <button id="d-prev" style="background:none;border:none;color:var(--text);font-size:20px;cursor:pointer;padding:0 4px" ${idx === 0 ? 'disabled' : ''}>‹</button>
            <div style="flex:1;min-width:0">
                <div style="font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${pos.display_name}</div>
                <div style="font-size:11px;color:var(--muted)">${pos.ticker} · ${pos.account_name} · ${idx+1}/${n}</div>
            </div>
            <button id="d-next" style="background:none;border:none;color:var(--text);font-size:20px;cursor:pointer;padding:0 4px" ${idx === n-1 ? 'disabled' : ''}>›</button>
        </div>
        <button class="drawer-close" style="margin-left:8px">✕</button>`
    drawer.querySelector('.drawer-close').addEventListener('click', closeDrawer)
    drawer.querySelector('#d-prev')?.addEventListener('click', () => { if (idx > 0) renderPositionDrawer(drawer, idx-1) })
    drawer.querySelector('#d-next')?.addEventListener('click', () => { if (idx < n-1) renderPositionDrawer(drawer, idx+1) })

    const body = drawer.querySelector('.drawer-body')
    drawer.querySelector('.drawer-footer').innerHTML = ''

    // Fetch recent transactions
    const { data: txs } = await supabase
        .from('transactions')
        .select('id, trade_date, trade_type, quantity, price, amount, realized_pnl_krw')
        .eq('ticker', pos.ticker)
        .eq('account_id', pos.account_id)
        .order('trade_date', { ascending: false })
        .limit(5)

    const txFeedHtml = (txs ?? []).map(tx => {
        const isSell = tx.trade_type === 'SELL'
        const pnl = isSell && tx.realized_pnl_krw != null
            ? `<span class="badge ${tx.realized_pnl_krw >= 0 ? 'badge-success' : 'badge-danger'}" style="font-size:10px">${tx.realized_pnl_krw >= 0 ? '+' : ''}₩${Math.round(tx.realized_pnl_krw).toLocaleString()}</span>`
            : ''
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
            <div>
                <span style="font-size:12px;color:var(--muted)">${tx.trade_date} · <strong>${tx.trade_type}</strong></span>
                <div style="font-size:12px;color:var(--muted)">${tx.quantity} × ${tx.price}</div>
            </div>
            <div style="text-align:right">
                <div style="font-size:13px">${(tx.amount ?? 0).toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                ${pnl}
            </div>
        </div>`
    }).join('')

    const txHasMoreFeed = (txs?.length ?? 0) === 5

    body.innerHTML = `
        <div class="stat-row">
            <div class="stat-item">
                <div class="stat-label">평가금액</div>
                <div class="stat-value">${pos.market_value_krw ? `₩${Math.round(pos.market_value_krw).toLocaleString()}` : '—'}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">미실현 손익</div>
                <div class="stat-value ${pnlKrw != null ? (pnlKrw >= 0 ? 'text-success' : 'text-danger') : ''}">${
                    pnlKrw != null ? `${pnlKrw >= 0 ? '+' : ''}₩${Math.round(pnlKrw).toLocaleString()}` : '—'}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">비중</div>
                <div class="stat-value">${weight}%</div>
            </div>
        </div>

        <div class="chart-section">
            <div class="chart-header">
                <span style="font-size:12px;font-weight:600;color:var(--muted)">${pos.currency === 'USD' ? '매매 타임라인 (USD)' : '매매 타임라인'}</span>
                <div class="seg-control" id="pos-range-ctrl">
                    <button data-range="1M">1M</button>
                    <button data-range="3M">3M</button>
                    <button data-range="ALL" class="active">ALL</button>
                </div>
            </div>
            <div id="pos-chart-container"></div>
        </div>

        <div style="margin-top:16px;margin-bottom:20px">
            <div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:8px">보유 직접 편집 (Initial Load)</div>
            <div class="form-group"><label>수량</label>
                <input id="f-il-qty" type="number" step="any" value="${pos.quantity ?? ''}"></div>
            <div class="form-group"><label>평균단가</label>
                <input id="f-il-price" type="number" step="any" value="${pos.avg_price ?? ''}"></div>
            <div class="form-group"><label>메모</label>
                <textarea id="f-il-note" rows="2">${pos.note ?? ''}</textarea></div>
            <p style="font-size:11px;color:var(--warning);margin:4px 0 8px">⚠ 거래를 입력하면 트리거가 이 값을 덮어씁니다.</p>
            <div id="il-result" class="sync-result hidden"></div>
            <button class="btn-primary" id="d-il-save" style="width:100%">저장</button>
        </div>

        <div>
            <div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:4px">거래 기록</div>
            <div id="tx-feed">${txFeedHtml || '<p class="empty-state" style="padding:8px 0">거래 내역 없음</p>'}</div>
            ${txHasMoreFeed ? `<button class="load-more-btn" id="d-more-tx" style="font-size:12px" data-offset="5">이전 거래 더 보기</button>` : ''}
        </div>`

    // Chart range toggle
    let currentRange = 'ALL'
    const chartContainer = body.querySelector('#pos-chart-container')
    await renderPositionChart(chartContainer, pos, currentRange)

    body.querySelector('#pos-range-ctrl')?.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (btn.dataset.range === currentRange) return
            currentRange = btn.dataset.range
            body.querySelectorAll('#pos-range-ctrl button').forEach(b => b.classList.remove('active'))
            btn.classList.add('active')
            await renderPositionChart(chartContainer, pos, currentRange)
        })
    })

    body.querySelector('#d-il-save')?.addEventListener('click', async () => {
        const resultEl = body.querySelector('#il-result')
        resultEl.classList.add('hidden')
        const qty = parseFloat(body.querySelector('#f-il-qty').value)
        const avgPrice = parseFloat(body.querySelector('#f-il-price').value)
        if (isNaN(qty) || isNaN(avgPrice)) {
            resultEl.textContent = '수량과 평균단가를 입력하세요'
            resultEl.className = 'sync-result error'
            resultEl.classList.remove('hidden')
            return
        }
        const { error } = await supabase.from('holdings').upsert({
            user_id: session.user.id,
            account_id: pos.account_id,
            ticker: pos.ticker,
            quantity: qty,
            avg_price: avgPrice,
            note: body.querySelector('#f-il-note').value.trim() || null,
        }, { onConflict: 'account_id,ticker' })
        if (error) {
            resultEl.textContent = error.message
            resultEl.className = 'sync-result error'
        } else {
            resultEl.textContent = '저장 완료'
            resultEl.className = 'sync-result success'
            await Promise.all([loadPositions(), loadHero()])
        }
        resultEl.classList.remove('hidden')
    })

    body.querySelector('#d-more-tx')?.addEventListener('click', async function() {
        const offset = Number(this.dataset.offset)
        const { data: moreTxs } = await supabase
            .from('transactions')
            .select('id, trade_date, trade_type, quantity, price, amount, realized_pnl_krw')
            .eq('ticker', pos.ticker)
            .eq('account_id', pos.account_id)
            .order('trade_date', { ascending: false })
            .range(offset, offset + 4)
        const feedEl = body.querySelector('#tx-feed')
        for (const tx of moreTxs ?? []) {
            const isSell = tx.trade_type === 'SELL'
            const pnl = isSell && tx.realized_pnl_krw != null
                ? `<span class="badge ${tx.realized_pnl_krw >= 0 ? 'badge-success' : 'badge-danger'}" style="font-size:10px">${tx.realized_pnl_krw >= 0 ? '+' : ''}₩${Math.round(tx.realized_pnl_krw).toLocaleString()}</span>`
                : ''
            feedEl.insertAdjacentHTML('beforeend', `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
                    <div>
                        <span style="font-size:12px;color:var(--muted)">${tx.trade_date} · <strong>${tx.trade_type}</strong></span>
                        <div style="font-size:12px;color:var(--muted)">${tx.quantity} × ${tx.price}</div>
                    </div>
                    <div style="text-align:right">
                        <div style="font-size:13px">${(tx.amount ?? 0).toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                        ${pnl}
                    </div>
                </div>`)
        }
        if ((moreTxs?.length ?? 0) < 5) this.remove()
        else this.dataset.offset = String(offset + 5)
    })
}

// ── Transaction Drawer ────────────────────────────────────────────────
async function renderTransactionDrawer(drawer, id, mode = id ? 'view' : 'create') {
    resetDrawerHeader(drawer)
    let tx = null
    if (id) {
        const { data } = await supabase
            .from('transactions')
            .select('*, instruments(display_name, currency), accounts(name)')
            .eq('id', id)
            .single()
        tx = data
    }

    if (!allAccounts.length) {
        const { data } = await supabase.from('accounts').select('id, name').order('id')
        allAccounts = data ?? []
    }
    if (!allInstruments.length) {
        const { data } = await supabase.from('instruments').select('id, ticker, display_name, currency').neq('instrument_type', 'fx').order('display_name')
        allInstruments = data ?? []
    }

    const isSell = (tx?.trade_type ?? 'BUY') === 'SELL'
    drawer.querySelector('.drawer-title').textContent =
        mode === 'create' ? '거래 추가' : `${tx?.trade_date ?? ''} · ${tx?.trade_type ?? ''}`

    const body = drawer.querySelector('.drawer-body')
    const footer = drawer.querySelector('.drawer-footer')

    if (mode === 'delete-confirm') {
        body.innerHTML = `<div class="confirm-msg">이 거래를 삭제할까요?<br>Holdings가 자동으로 재계산됩니다.</div>`
        footer.innerHTML = `
            <div class="footer-row">
                <button class="btn-ghost flex-1" id="d-cancel">취소</button>
                <button class="btn-danger flex-1" id="d-confirm">삭제</button>
            </div>`
        footer.querySelector('#d-cancel').onclick = () => renderTransactionDrawer(drawer, id, 'view')
        footer.querySelector('#d-confirm').onclick = async () => {
            await supabase.from('transactions').delete().eq('id', id)
            closeDrawer()
            await Promise.all([loadTransactions(), loadHero()])
        }
        return
    }

    const ro = mode === 'view'
    const accountOpts = allAccounts.map(a =>
        `<option value="${a.id}"${tx?.account_id === a.id ? ' selected' : ''}>${a.name}</option>`
    ).join('')
    const instrOpts = allInstruments.map(i =>
        `<option value="${i.ticker}"${tx?.ticker === i.ticker ? ' selected' : ''}>${i.display_name} (${i.ticker} · ${i.currency})</option>`
    ).join('')

    const currency = tx?.instruments?.currency ?? ''
    const statRow = tx ? `
        <div class="stat-row">
            <div class="stat-item">
                <div class="stat-label">거래금액</div>
                <div class="stat-value">${currency === 'KRW'
                    ? `₩${Math.round(tx.amount).toLocaleString()}`
                    : `${tx.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">수량</div>
                <div class="stat-value">${tx.quantity}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">${isSell ? '실현손익' : '거래 타입'}</div>
                <div class="stat-value ${isSell && tx.realized_pnl_krw != null
                    ? (tx.realized_pnl_krw >= 0 ? 'text-success' : 'text-danger') : ''}">${
                    isSell && tx.realized_pnl_krw != null
                        ? `${tx.realized_pnl_krw >= 0 ? '+' : ''}₩${Math.round(tx.realized_pnl_krw).toLocaleString()}`
                        : tx.trade_type}</div>
            </div>
        </div>` : ''

    body.innerHTML = `
        ${statRow}
        <div class="form-group"><label>거래일</label>
            <input id="f-date" type="date" value="${tx?.trade_date ?? new Date().toISOString().slice(0,10)}" ${ro ? 'disabled' : ''}></div>
        <div class="form-group"><label>거래 유형</label>
            <select id="f-type" ${ro ? 'disabled' : ''}>
                <option value="BUY"${!isSell ? ' selected' : ''}>BUY</option>
                <option value="SELL"${isSell ? ' selected' : ''}>SELL</option>
            </select></div>
        <div class="form-group"><label>계좌</label>
            <select id="f-account" ${ro ? 'disabled' : ''}>${accountOpts}</select></div>
        <div class="form-group"><label>종목</label>
            <select id="f-ticker" ${ro || mode === 'edit' ? 'disabled' : ''}><option value="">선택</option>${instrOpts}</select></div>
        <div class="form-group"><label>통화</label>
            <input id="f-currency" type="text" disabled value="${tx?.instruments?.currency ?? ''}"></div>
        <div class="form-group"><label>수량</label>
            <input id="f-qty" type="number" step="any" value="${tx?.quantity ?? ''}" ${ro ? 'disabled' : ''}></div>
        <div class="form-group"><label>단가</label>
            <input id="f-price" type="number" step="any" value="${tx?.price ?? ''}" ${ro ? 'disabled' : ''}></div>
        <div class="form-group"><label>수수료</label>
            <input id="f-fee" type="number" step="any" value="${tx?.fee ?? 0}" ${ro ? 'disabled' : ''}></div>
        <div class="form-group"><label>거래금액 (자동)</label>
            <input id="f-amount" type="number" step="any" value="${tx?.amount ?? ''}" ${ro ? 'disabled' : ''}></div>
        ${isSell ? `<div class="form-group"><label>실현손익 (자동)</label>
            <input type="text" disabled value="${tx?.realized_pnl_krw != null ? tx.realized_pnl_krw : '트리거 자동계산'}"></div>` : ''}
        <div class="form-group"><label>메모</label>
            <textarea id="f-note" rows="2" ${ro ? 'disabled' : ''}>${tx?.note ?? ''}</textarea></div>
        <div id="tx-error" class="sync-result error hidden"></div>`

    if (!ro) {
        const tickerSel = body.querySelector('#f-ticker')
        const qtyInput = body.querySelector('#f-qty')
        const priceInput = body.querySelector('#f-price')
        const feeInput = body.querySelector('#f-fee')
        const amountInput = body.querySelector('#f-amount')
        const currencyInput = body.querySelector('#f-currency')

        const calcAmount = () => {
            const q = parseFloat(qtyInput.value) || 0
            const p = parseFloat(priceInput.value) || 0
            const f = parseFloat(feeInput.value) || 0
            amountInput.value = (q * p + f).toFixed(2)
        }

        tickerSel?.addEventListener('change', () => {
            const inst = allInstruments.find(i => i.ticker === tickerSel.value)
            currencyInput.value = inst?.currency ?? ''
        })
        qtyInput?.addEventListener('input', calcAmount)
        priceInput?.addEventListener('input', calcAmount)
        feeInput?.addEventListener('input', calcAmount)
    }

    if (ro) {
        footer.innerHTML = `<div class="footer-row"><button class="btn-primary flex-1" id="d-edit">편집</button></div>`
        footer.querySelector('#d-edit').onclick = () => renderTransactionDrawer(drawer, id, 'edit')
    } else {
        footer.innerHTML = `
            <div class="footer-row">
                ${mode === 'edit' ? `<button class="btn-danger-ghost" id="d-delete">삭제</button>` : ''}
                <button class="btn-ghost flex-1" id="d-cancel">취소</button>
                <button class="btn-primary flex-1" id="d-save">저장</button>
            </div>`
        if (mode === 'edit') {
            footer.querySelector('#d-delete').onclick = () => renderTransactionDrawer(drawer, id, 'delete-confirm')
        }
        footer.querySelector('#d-cancel').onclick = () =>
            mode === 'create' ? closeDrawer() : renderTransactionDrawer(drawer, id, 'view')
        footer.querySelector('#d-save').onclick = async () => {
            const errEl = body.querySelector('#tx-error')
            errEl.classList.add('hidden')
            const tickerVal = body.querySelector('#f-ticker').value
            if (!tickerVal) { errEl.textContent = '종목을 선택하세요'; errEl.classList.remove('hidden'); return }
            const payload = {
                trade_date: body.querySelector('#f-date').value,
                trade_type: body.querySelector('#f-type').value,
                account_id: Number(body.querySelector('#f-account').value),
                ticker: tickerVal,
                quantity: parseFloat(body.querySelector('#f-qty').value),
                price: parseFloat(body.querySelector('#f-price').value),
                fee: parseFloat(body.querySelector('#f-fee').value) || 0,
                amount: parseFloat(body.querySelector('#f-amount').value),
                note: body.querySelector('#f-note').value.trim() || null,
            }
            const { error } = mode === 'create'
                ? await supabase.from('transactions').insert(payload)
                : await supabase.from('transactions').update(payload).eq('id', id)
            if (error) {
                errEl.textContent = error.message
                errEl.classList.remove('hidden')
                return
            }
            closeDrawer()
            await Promise.all([loadTransactions(), loadHero()])
        }
    }
}

// ── Drawer core ───────────────────────────────────────────────────────
function getOrCreateDrawer() {
    if (!drawerEl) {
        const overlay = document.createElement('div')
        overlay.className = 'drawer-overlay'
        overlay.addEventListener('click', closeDrawer)
        document.body.appendChild(overlay)

        drawerEl = document.createElement('div')
        drawerEl.className = 'drawer'
        drawerEl.innerHTML = `
            <div class="drawer-header">
                <h2 class="drawer-title"></h2>
                <button class="drawer-close">✕</button>
            </div>
            <div class="drawer-body"></div>
            <div class="drawer-footer"></div>`
        drawerEl.querySelector('.drawer-close').addEventListener('click', closeDrawer)
        document.body.appendChild(drawerEl)
    }
    return drawerEl
}

function closeDrawer() {
    document.querySelector('.drawer')?.classList.remove('open')
    document.querySelector('.drawer-overlay')?.classList.remove('open')
}

async function openDrawer(type, id) {
    const drawer = getOrCreateDrawer()
    document.querySelector('.drawer-overlay').classList.add('open')
    drawer.classList.add('open')
    if (type === 'account') await renderAccountDrawer(drawer, id)
    else if (type === 'transaction') await renderTransactionDrawer(drawer, id)
}

// ── Init ──────────────────────────────────────────────────────────────
await Promise.all([loadHero(), loadAccounts(), loadPositions(), loadTransactions()])
updateFab()
