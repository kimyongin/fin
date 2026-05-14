import { supabase, requireAuth, signOut } from './supabase.js'

const session = await requireAuth()
if (!session) throw new Error('unauthenticated')

document.getElementById('logout-btn').addEventListener('click', signOut)

const isDesktop = () => window.innerWidth >= 901

let activeTab = 'fx'
let allTags = []
let drawerEl = null
let firstFxId = null
let firstInstrumentId = null
let firstTagId = null

// ── Tab switching ─────────────────────────────────────────────────────
document.querySelectorAll('.tab-bar button').forEach(btn => {
    btn.addEventListener('click', async () => {
        document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'))
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'))
        btn.classList.add('active')
        document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden')
        activeTab = btn.dataset.tab
        updateFab()
        if (isDesktop()) await autoSelectFirst()
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
    fab.onclick = () => {
        const typeMap = { fx: 'fx', instruments: 'instrument', tags: 'tag' }
        openDrawer(typeMap[activeTab], null)
    }
}

// ── Hero ─────────────────────────────────────────────────────────────
async function loadHero() {
    const { data } = await supabase
        .from('sync_runs')
        .select('*')
        .order('run_at', { ascending: false })
        .limit(1)
        .single()

    if (!data) {
        document.getElementById('sync-ratio').textContent = '—'
        document.getElementById('hero-meta').textContent = '동기화 기록 없음'
        return
    }

    document.getElementById('sync-ratio').textContent = `${data.synced_count} / ${data.total_count}`
    const dt = new Date(data.run_at).toLocaleString('ko-KR')
    const failInfo = data.failed_count > 0 ? ` · 실패 ${data.failed_count}건` : ''
    document.getElementById('hero-meta').textContent = `마지막 동기화: ${dt}${failInfo}`
}

// ── Sync badge ────────────────────────────────────────────────────────
function syncBadge(priceDate, source) {
    if (!priceDate) return '<span class="badge badge-danger">미수집</span>'
    const days = Math.floor((Date.now() - new Date(priceDate).getTime()) / 86400000)
    if (source === 'manual') return '<span class="badge badge-warning">수동</span>'
    if (days <= 3) return '<span class="badge badge-success">동기화</span>'
    return '<span class="badge badge-danger">지연</span>'
}

// ── FX Tab ───────────────────────────────────────────────────────────
async function loadFx() {
    const tab = document.getElementById('tab-fx')
    const { data: instruments } = await supabase
        .from('instruments')
        .select('*')
        .eq('instrument_type', 'fx')
        .order('ticker')

    if (!instruments?.length) {
        tab.innerHTML = '<p class="empty-state">환율 데이터가 없습니다.</p>'
        return
    }

    firstFxId = instruments[0].id
    const tickers = instruments.map(i => i.ticker)
    const { data: prices } = await supabase
        .from('holding_prices_daily')
        .select('ticker, price_date, close_price, source')
        .in('ticker', tickers)
        .order('price_date', { ascending: false })

    const latestPrice = {}
    for (const p of prices ?? []) {
        if (p.source !== 'holiday' && !latestPrice[p.ticker]) latestPrice[p.ticker] = p
    }

    tab.innerHTML = '<ul class="card-list"></ul>'
    const list = tab.querySelector('.card-list')
    for (const inst of instruments) {
        const lp = latestPrice[inst.ticker]
        const li = document.createElement('li')
        li.className = 'card-item'
        li.innerHTML = `
            <div class="card-main">
                <div class="card-title">${inst.display_name}</div>
                <div class="card-sub">${inst.ticker}</div>
            </div>
            <div class="card-right">
                ${syncBadge(lp?.price_date, lp?.source)}
                <div class="card-price">${lp ? lp.close_price.toLocaleString() : '—'}</div>
            </div>`
        li.addEventListener('click', () => openDrawer('fx', inst.id))
        list.appendChild(li)
    }
}

// ── Instruments Tab ───────────────────────────────────────────────────
async function loadInstruments() {
    const tab = document.getElementById('tab-instruments')
    const { data: instruments } = await supabase
        .from('instruments')
        .select('*, instrument_tags(tag_id, tags(name, color))')
        .neq('instrument_type', 'fx')
        .order('ticker')

    if (!instruments?.length) {
        tab.innerHTML = '<p class="empty-state">종목 데이터가 없습니다.</p>'
        return
    }

    const tickers = instruments.map(i => i.ticker)
    const { data: prices } = await supabase
        .from('holding_prices_daily')
        .select('ticker, price_date, close_price, source')
        .in('ticker', tickers)
        .order('price_date', { ascending: false })

    const latestPrice = {}
    for (const p of prices ?? []) {
        if (p.source !== 'holiday' && !latestPrice[p.ticker]) latestPrice[p.ticker] = p
    }

    firstInstrumentId = instruments[0]?.id ?? null
    const sorted = [...instruments].sort((a, b) => {
        const score = lp => {
            if (!lp) return 0
            if (lp.source === 'manual') return 1
            return Math.floor((Date.now() - new Date(lp.price_date).getTime()) / 86400000) > 3 ? 0 : 2
        }
        return score(latestPrice[a.ticker]) - score(latestPrice[b.ticker])
    })

    tab.innerHTML = '<ul class="card-list"></ul>'
    const list = tab.querySelector('.card-list')
    for (const inst of sorted) {
        const lp = latestPrice[inst.ticker]
        const isFail = !lp || Math.floor((Date.now() - new Date(lp.price_date).getTime()) / 86400000) > 3
        const tags = inst.instrument_tags?.map(t =>
            `<span class="chip chip-${t.tags?.color ?? 'neutral'}">${t.tags?.name}</span>`
        ).join('') ?? ''
        const li = document.createElement('li')
        li.className = `card-item${isFail ? ' card-fail' : ''}`
        li.innerHTML = `
            <div class="card-main">
                <div class="card-title">${inst.display_name}</div>
                <div class="card-sub">${inst.ticker} · ${inst.currency}</div>
                <div class="card-chips">
                    <span class="chip chip-neutral">${inst.instrument_type}</span>
                    ${tags}
                </div>
            </div>
            <div class="card-right">
                ${syncBadge(lp?.price_date, lp?.source)}
                <div class="card-price">${lp ? lp.close_price.toLocaleString() : '—'}</div>
            </div>`
        li.addEventListener('click', () => openDrawer('instrument', inst.id))
        list.appendChild(li)
    }
}

// ── Tags Tab ──────────────────────────────────────────────────────────
async function loadTags() {
    const { data: tags } = await supabase
        .from('tags')
        .select('*, instrument_tags(ticker)')
        .order('sort_order')

    allTags = tags ?? []
    firstTagId = tags?.[0]?.id ?? null
    const tab = document.getElementById('tab-tags')

    if (!tags?.length) {
        tab.innerHTML = '<p class="empty-state">태그가 없습니다.</p>'
        return
    }

    tab.innerHTML = '<ul class="card-list"></ul>'
    const list = tab.querySelector('.card-list')
    for (const tag of tags) {
        const count = tag.instrument_tags?.length ?? 0
        const li = document.createElement('li')
        li.className = 'card-item'
        li.innerHTML = `
            <div class="card-main">
                <div class="card-title">${tag.name}</div>
                <div class="card-sub">종목 ${count}개</div>
            </div>
            <div class="card-right">
                <span class="badge badge-${tag.color ?? 'neutral'}">${tag.color ?? 'neutral'}</span>
            </div>`
        li.addEventListener('click', () => openDrawer('tag', tag.id))
        list.appendChild(li)
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
    if (isDesktop()) return
    document.querySelector('.drawer')?.classList.remove('open')
    document.querySelector('.drawer-overlay')?.classList.remove('open')
}

async function autoSelectFirst() {
    if (activeTab === 'fx' && firstFxId) {
        await openDrawer('fx', firstFxId)
    } else if (activeTab === 'instruments' && firstInstrumentId) {
        await openDrawer('instrument', firstInstrumentId)
    } else if (activeTab === 'tags' && firstTagId) {
        await openDrawer('tag', firstTagId)
    } else {
        const drawer = getOrCreateDrawer()
        drawer.querySelector('.drawer-body').innerHTML = '<p class="empty-state">항목을 선택하세요.</p>'
        drawer.querySelector('.drawer-footer').innerHTML = ''
        drawer.querySelector('.drawer-title').textContent = ''
    }
}

async function openDrawer(type, id) {
    const drawer = getOrCreateDrawer()
    document.querySelector('.drawer-overlay').classList.add('open')
    drawer.classList.add('open')
    if (type === 'tag') {
        await renderTagDrawer(drawer, id)
    } else {
        await renderInstrumentDrawer(drawer, type, id)
    }
}

// ── Instrument Drawer ─────────────────────────────────────────────────
async function renderInstrumentDrawer(drawer, type, id, mode = id ? 'view' : 'create') {
    const isFx = type === 'fx'
    let inst = null
    let chartRange = '1M'

    if (id) {
        const { data } = await supabase
            .from('instruments')
            .select('*, instrument_tags(id, tag_id, tags(id, name, color))')
            .eq('id', id)
            .single()
        inst = data
    }

    drawer.querySelector('.drawer-title').textContent =
        mode === 'create' ? (isFx ? '환율 추가' : '종목 추가') : (inst?.display_name ?? '')

    const body = drawer.querySelector('.drawer-body')
    const footer = drawer.querySelector('.drawer-footer')

    if (mode === 'delete-confirm') {
        body.innerHTML = `<div class="confirm-msg">정말 <strong>${inst?.display_name}</strong>을(를) 삭제할까요?</div>`
        footer.innerHTML = `
            <div class="footer-row">
                <button class="btn-ghost flex-1" id="d-cancel">취소</button>
                <button class="btn-danger" id="d-confirm">삭제</button>
            </div>`
        footer.querySelector('#d-cancel').onclick = () => renderInstrumentDrawer(drawer, type, id, 'view')
        footer.querySelector('#d-confirm').onclick = async () => {
            await supabase.from('instruments').delete().eq('id', id)
            closeDrawer()
            isFx ? await loadFx() : await loadInstruments()
        }
        return
    }

    const ro = mode === 'view'
    const typeOpts = isFx
        ? `<option value="fx">fx</option>`
        : ['stock', 'etf', 'fund', 'cash', 'other'].map(t =>
            `<option value="${t}"${inst?.instrument_type === t ? ' selected' : ''}>${t}</option>`
        ).join('')

    body.innerHTML = `
        <div class="form-group"><label>Ticker</label>
            <input id="f-ticker" type="text" value="${inst?.ticker ?? ''}" ${mode !== 'create' ? 'disabled' : ''}></div>
        <div class="form-group"><label>표시명</label>
            <input id="f-display-name" type="text" value="${inst?.display_name ?? ''}" ${ro ? 'disabled' : ''}></div>
        <div class="form-group"><label>유형</label>
            <select id="f-type" ${ro ? 'disabled' : ''}>${typeOpts}</select></div>
        <div class="form-group"><label>통화</label>
            ${ro
                ? `<input id="f-currency" type="text" value="${inst?.currency ?? ''}" disabled>`
                : `<select id="f-currency">${['KRW','USD','JPY'].map(c => `<option value="${c}"${(inst?.currency ?? 'KRW') === c ? ' selected' : ''}>${c}</option>`).join('')}</select>`
            }</div>
        <div class="form-group"><label>가격 소스</label>
            ${ro
                ? `<input id="f-price-source" type="text" value="${inst?.price_source ?? 'yfinance'}" disabled>`
                : `<select id="f-price-source"><option value="yfinance"${(inst?.price_source ?? 'yfinance') === 'yfinance' ? ' selected' : ''}>yfinance</option></select>`
            }</div>
        <div class="form-group"><label>소스 심볼</label>
            <input id="f-source-symbol" type="text" value="${inst?.source_symbol ?? ''}" ${ro ? 'disabled' : ''}></div>
        ${!isFx ? `<div class="form-group"><label>태그</label><div id="f-tags" class="tag-selector"></div></div>` : ''}
        <div class="form-group"><label>메모</label>
            <textarea id="f-note" rows="2" ${ro ? 'disabled' : ''}>${inst?.note ?? ''}</textarea></div>
        ${inst ? `
        <div class="chart-section">
            <div class="chart-header">
                <span>가격 이력</span>
                <div class="seg-control">
                    <button data-range="1M" class="active">1M</button>
                    <button data-range="1D">1D</button>
                </div>
            </div>
            <div id="chart-container"></div>
            <div id="data-quality"></div>
            <div id="manual-form-section" class="hidden">
                <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
                    <div style="font-size:12px;color:var(--muted);font-weight:500;margin-bottom:8px">누락 가격 보완</div>
                    <div style="display:flex;gap:8px;align-items:flex-start">
                        <input id="f-manual-date" type="date" style="flex:1;min-width:0">
                        <input id="f-manual-price" type="number" step="any" placeholder="종가" style="flex:1;min-width:0">
                        <button type="button" class="btn-primary" id="d-manual-save" style="flex-shrink:0">저장</button>
                    </div>
                    <div id="manual-save-result" class="sync-result hidden" style="margin-top:6px"></div>
                </div>
            </div>
        </div>` : ''}`

    // Tag selector
    if (!isFx) {
        const sel = body.querySelector('#f-tags')
        const selectedIds = new Set(inst?.instrument_tags?.map(t => t.tag_id) ?? [])
        if (ro) {
            const linked = inst?.instrument_tags ?? []
            sel.innerHTML = linked.length
                ? linked.map(t => `<span class="chip chip-${t.tags?.color ?? 'neutral'}">${t.tags?.name}</span>`).join('')
                : '<span class="muted">없음</span>'
        } else {
            for (const tag of allTags) {
                const btn = document.createElement('button')
                btn.type = 'button'
                btn.className = `chip chip-${tag.color}${selectedIds.has(tag.id) ? ' selected' : ''}`
                btn.textContent = tag.name
                btn.dataset.tagId = tag.id
                btn.onclick = () => btn.classList.toggle('selected')
                sel.appendChild(btn)
            }
        }
    }

    // Chart + manual save
    if (inst) {
        await renderChart(inst.ticker, chartRange)
        body.querySelectorAll('.seg-control button').forEach(btn => {
            btn.addEventListener('click', async () => {
                body.querySelectorAll('.seg-control button').forEach(b => b.classList.remove('active'))
                btn.classList.add('active')
                chartRange = btn.dataset.range
                await renderChart(inst.ticker, chartRange)
            })
        })
        body.querySelector('#d-manual-save')?.addEventListener('click', async () => {
            const dateVal = body.querySelector('#f-manual-date').value
            const priceVal = body.querySelector('#f-manual-price').value
            const resultEl = body.querySelector('#manual-save-result')
            if (!dateVal || !priceVal) {
                resultEl.textContent = '날짜와 종가를 입력하세요'
                resultEl.className = 'sync-result error'
                resultEl.classList.remove('hidden')
                return
            }
            resultEl.textContent = '저장 중...'
            resultEl.className = 'sync-result'
            resultEl.classList.remove('hidden')
            const { error } = await supabase
                .from('holding_prices_daily')
                .upsert({
                    user_id: session.user.id,
                    ticker: inst.ticker,
                    price_date: dateVal,
                    close_price: parseFloat(priceVal),
                    source: 'manual'
                }, { onConflict: 'user_id,ticker,price_date' })
            if (error) {
                resultEl.textContent = error.message
                resultEl.className = 'sync-result error'
            } else {
                resultEl.textContent = '저장 완료'
                resultEl.className = 'sync-result success'
                body.querySelector('#f-manual-price').value = ''
                await renderChart(inst.ticker, chartRange)
                isFx ? await loadFx() : await loadInstruments()
            }
        })
    }

    // Footer
    if (ro) {
        footer.innerHTML = `
            <div id="d-sync-result" class="sync-result hidden"></div>
            <div class="footer-row" style="margin-top:8px">
                <button class="btn-ghost flex-1" id="d-sync">동기화</button>
                <button class="btn-primary flex-1" id="d-edit">편집</button>
            </div>`
        footer.querySelector('#d-sync').onclick = async () => {
            const res = footer.querySelector('#d-sync-result')
            res.textContent = '동기화 중...'
            res.className = 'sync-result'
            res.classList.remove('hidden')
            try {
                const { data, error } = await supabase.functions.invoke('sync-prices', {
                    body: { tickers: [inst.ticker] }
                })
                if (error) throw error
                const rows = data.synced?.[0]?.rows ?? 0
                const fail = data.failed?.[0]
                if (fail) {
                    res.textContent = `실패: ${fail.error}`
                    res.className = 'sync-result error'
                } else {
                    res.textContent = rows === 0 ? '이미 최신입니다' : `${rows}개 저장 완료`
                    res.className = 'sync-result success'
                    await renderChart(inst.ticker, chartRange)
                }
            } catch (e) {
                res.textContent = e.message
                res.className = 'sync-result error'
            }
        }
        footer.querySelector('#d-edit').onclick = () => renderInstrumentDrawer(drawer, type, id, 'edit')
    } else {
        footer.innerHTML = `
            <div class="footer-row">
                ${mode === 'edit' ? `<button class="btn-danger-ghost" id="d-delete">삭제</button>` : ''}
                <button class="btn-ghost flex-1" id="d-cancel">취소</button>
                <button class="btn-primary flex-1" id="d-save">저장</button>
            </div>`
        if (mode === 'edit') {
            footer.querySelector('#d-delete').onclick = () => renderInstrumentDrawer(drawer, type, id, 'delete-confirm')
        }
        footer.querySelector('#d-cancel').onclick = () =>
            mode === 'create' ? closeDrawer() : renderInstrumentDrawer(drawer, type, id, 'view')
        footer.querySelector('#d-save').onclick = async () => {
            const payload = {
                ticker: body.querySelector('#f-ticker').value.trim(),
                display_name: body.querySelector('#f-display-name').value.trim(),
                instrument_type: body.querySelector('#f-type').value,
                currency: body.querySelector('#f-currency').value.trim(),
                price_source: body.querySelector('#f-price-source').value.trim() || 'yfinance',
                source_symbol: body.querySelector('#f-source-symbol').value.trim() || null,
                note: body.querySelector('#f-note').value.trim() || null,
            }

            let saved
            if (mode === 'create') {
                const { data, error } = await supabase.from('instruments').insert(payload).select().single()
                if (error) { alert(error.message); return }
                saved = data
            } else {
                const { data, error } = await supabase.from('instruments').update(payload).eq('id', id).select().single()
                if (error) { alert(error.message); return }
                saved = data
            }

            if (!isFx) {
                const selectedIds = new Set(
                    [...body.querySelectorAll('#f-tags .chip.selected')].map(b => Number(b.dataset.tagId))
                )
                const currentTags = inst?.instrument_tags ?? []
                for (const it of currentTags) {
                    if (!selectedIds.has(it.tag_id)) await supabase.from('instrument_tags').delete().eq('id', it.id)
                }
                const currentIds = new Set(currentTags.map(t => t.tag_id))
                for (const tagId of selectedIds) {
                    if (!currentIds.has(tagId)) {
                        await supabase.from('instrument_tags').insert({
                            user_id: session.user.id,
                            ticker: saved.ticker,
                            tag_id: tagId
                        })
                    }
                }
            }

            closeDrawer()
            isFx ? await loadFx() : await loadInstruments()
        }
    }
}

// ── Chart ─────────────────────────────────────────────────────────────
async function renderChart(ticker, range) {
    const days = range === '1M' ? 30 : 7
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

    const { data: prices } = await supabase
        .from('holding_prices_daily')
        .select('price_date, close_price, source')
        .eq('ticker', ticker)
        .gte('price_date', since)
        .order('price_date')

    const container = document.getElementById('chart-container')
    const quality = document.getElementById('data-quality')
    if (!container) return

    // holiday 레코드: 품질 체크 priceSet엔 포함, 차트 렌더링엔 제외
    const allPrices = prices ?? []
    const chartPrices = allPrices.filter(p => p.source !== 'holiday' && p.close_price != null)

    if (!chartPrices.length) {
        container.innerHTML = '<p class="muted" style="font-size:12px;padding:8px 0">데이터 없음</p>'
        if (quality) quality.innerHTML = ''
        return
    }

    const W = 300, H = 72, P = 6
    const vals = chartPrices.map(p => p.close_price)
    const min = Math.min(...vals), max = Math.max(...vals)
    const span = max - min || 1
    const n = chartPrices.length

    const cx = i => P + (i / Math.max(n - 1, 1)) * (W - P * 2)
    const cy = v => H - P - ((v - min) / span) * (H - P * 2)

    const linePts = chartPrices.map((p, i) => `${cx(i)},${cy(p.close_price)}`).join(' ')
    const areaPath = [
        `M ${cx(0)},${H - P}`,
        ...chartPrices.map((p, i) => `L ${cx(i)},${cy(p.close_price)}`),
        `L ${cx(n - 1)},${H - P}`, 'Z'
    ].join(' ')

    container.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">
            <defs>
                <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.25"/>
                    <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
                </linearGradient>
            </defs>
            <path d="${areaPath}" fill="url(#ag)"/>
            <polyline points="${linePts}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>`

    if (quality) {
        const last = chartPrices[chartPrices.length - 1]
        const manualCnt = chartPrices.filter(p => p.source === 'manual').length

        // allPrices 기준 priceSet: holiday 마킹된 날짜도 포함 → 누락으로 집계 안됨
        const priceSet = new Set(allPrices.map(p => p.price_date))
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        yesterday.setHours(0, 0, 0, 0)
        const missingDates = []
        for (let d = new Date(since); d <= yesterday; d.setDate(d.getDate() + 1)) {
            const dow = d.getDay()
            if (dow === 0 || dow === 6) continue
            const ds = d.toISOString().slice(0, 10)
            if (!priceSet.has(ds)) missingDates.push(ds)
        }

        quality.innerHTML = `
            <div class="quality-row"><span>데이터 시작일</span><span>${prices[0].price_date}</span></div>
            <div class="quality-row"><span>마지막 동기화</span><span>${last.price_date}</span></div>
            ${manualCnt ? `<div class="quality-row"><span>수동 입력</span><span>${manualCnt}일</span></div>` : ''}
            ${missingDates.length ? `
            <div class="quality-row" style="margin-top:6px">
                <span class="badge badge-danger" style="font-size:10px">누락 ${missingDates.length}일</span>
                <button type="button" class="btn-ghost" id="btn-open-manual" style="font-size:11px;padding:3px 8px">보완</button>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">
                ${missingDates.slice(-8).map(d =>
                    `<button type="button" class="chip chip-danger missing-date-chip" data-date="${d}">${d.slice(5)}</button>`
                ).join('')}
            </div>` : ''}`

        quality.querySelectorAll('.missing-date-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('manual-form-section')?.classList.remove('hidden')
                const di = document.getElementById('f-manual-date')
                if (di) di.value = btn.dataset.date
                document.getElementById('f-manual-price')?.focus()
            })
        })
        document.getElementById('btn-open-manual')?.addEventListener('click', () => {
            document.getElementById('manual-form-section')?.classList.remove('hidden')
            document.getElementById('f-manual-price')?.focus()
        })
    }
}

// ── Tag Drawer ────────────────────────────────────────────────────────
async function renderTagDrawer(drawer, id, mode = id ? 'view' : 'create') {
    let tag = null
    if (id) {
        const { data } = await supabase
            .from('tags')
            .select('*, instrument_tags(ticker)')
            .eq('id', id)
            .single()
        tag = data
    }

    drawer.querySelector('.drawer-title').textContent = mode === 'create' ? '태그 추가' : (tag?.name ?? '')

    const body = drawer.querySelector('.drawer-body')
    const footer = drawer.querySelector('.drawer-footer')
    const linkedCount = tag?.instrument_tags?.length ?? 0
    const canDelete = linkedCount === 0

    if (mode === 'delete-confirm') {
        body.innerHTML = `<div class="confirm-msg">정말 <strong>${tag?.name}</strong> 태그를 삭제할까요?</div>`
        footer.innerHTML = `
            <div class="footer-row">
                <button class="btn-ghost flex-1" id="d-cancel">취소</button>
                <button class="btn-danger" id="d-confirm">삭제</button>
            </div>`
        footer.querySelector('#d-cancel').onclick = () => renderTagDrawer(drawer, id, 'view')
        footer.querySelector('#d-confirm').onclick = async () => {
            await supabase.from('tags').delete().eq('id', id)
            closeDrawer()
            await loadTags()
        }
        return
    }

    const ro = mode === 'view'
    body.innerHTML = `
        <div class="form-group"><label>태그명</label>
            <input id="f-name" type="text" value="${tag?.name ?? ''}" ${ro ? 'disabled' : ''}></div>
        <div class="form-group"><label>색상</label>
            <select id="f-color" ${ro ? 'disabled' : ''}>
                ${['success', 'info', 'neutral', 'warning'].map(c =>
                    `<option value="${c}"${tag?.color === c ? ' selected' : ''}>${c}</option>`
                ).join('')}
            </select></div>
        <div class="form-group"><label>순서</label>
            <input id="f-sort-order" type="number" value="${tag?.sort_order ?? 0}" ${ro ? 'disabled' : ''}></div>
        <div class="form-group"><label>연결 종목 수</label><span>${linkedCount}개</span></div>
        ${linkedCount ? `
        <div class="form-group"><label>연결 종목</label>
            <div class="tag-selector">${(tag?.instrument_tags ?? []).map(t =>
                `<span class="chip chip-neutral">${t.ticker}</span>`
            ).join('')}</div>
        </div>` : ''}`

    if (ro) {
        footer.innerHTML = `<div class="footer-row"><button class="btn-primary flex-1" id="d-edit">편집</button></div>`
        footer.querySelector('#d-edit').onclick = () => renderTagDrawer(drawer, id, 'edit')
    } else {
        footer.innerHTML = `
            <div class="footer-row">
                ${mode === 'edit' ? `<button class="btn-danger-ghost" id="d-delete" ${!canDelete ? 'disabled' : ''} title="${!canDelete ? '연결 종목이 있어 삭제 불가' : ''}">삭제</button>` : ''}
                <button class="btn-ghost flex-1" id="d-cancel">취소</button>
                <button class="btn-primary flex-1" id="d-save">저장</button>
            </div>`
        if (mode === 'edit') {
            footer.querySelector('#d-delete').onclick = () => {
                if (canDelete) renderTagDrawer(drawer, id, 'delete-confirm')
            }
        }
        footer.querySelector('#d-cancel').onclick = () =>
            mode === 'create' ? closeDrawer() : renderTagDrawer(drawer, id, 'view')
        footer.querySelector('#d-save').onclick = async () => {
            const payload = {
                name: body.querySelector('#f-name').value.trim(),
                color: body.querySelector('#f-color').value,
                sort_order: Number(body.querySelector('#f-sort-order').value),
            }
            const { error } = mode === 'create'
                ? await supabase.from('tags').insert(payload)
                : await supabase.from('tags').update(payload).eq('id', id)
            if (error) { alert(error.message); return }
            closeDrawer()
            await loadTags()
        }
    }
}

// ── Init ──────────────────────────────────────────────────────────────
await Promise.all([loadHero(), loadFx(), loadInstruments(), loadTags()])
updateFab()
if (isDesktop()) await autoSelectFirst()
