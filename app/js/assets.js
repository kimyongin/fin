import { supabase, requireAuth, signOut } from './supabase.js'

const session = await requireAuth()
if (!session) throw new Error('unauthenticated')

document.getElementById('logout-btn').addEventListener('click', signOut)

let activeTab = 'accounts'
let drawerEl = null
let allAccounts = []
let allInstruments = []
let allTags = []
let txOffset = 0
let txHasMore = true
let txFilters = {}
const TX_PAGE = 30

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
    const { data: pvRows } = await supabase.from('portfolio_view').select('market_value_krw')
    const total = (pvRows ?? []).reduce((s, r) => s + (r.market_value_krw ?? 0), 0)
    document.getElementById('total-value').textContent = total
        ? `₩${Math.round(total).toLocaleString()}`
        : '₩0'
    document.getElementById('hero-meta').textContent = `보유 종목 ${pvRows?.length ?? 0}개`
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

// ── Account Drawer ────────────────────────────────────────────────────
async function renderAccountDrawer(drawer, id, mode = id ? 'view' : 'create') {
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

// ── Transaction Drawer ────────────────────────────────────────────────
async function renderTransactionDrawer(drawer, id, mode = id ? 'view' : 'create') {
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
// TODO: Issue #7 — Position 목록 + 상세 (portfolio_view)
// TODO: Issue #8 — 태그 필터 + 구성 차트 + 타임라인 차트
await Promise.all([loadHero(), loadAccounts(), loadTransactions()])
updateFab()
