import { useEffect, useMemo, useRef, useState } from 'react'
import { formatKrw, formatMoney, formatNumber, formatSignedPercent, formatUnitPrice, returnToneClass } from '../../lib/format'
import { effectiveKrwValue, fxTickerForCurrency } from '../../lib/portfolioMath'
import { PagePanel, pagePanelActionClass } from '../../components/PageControls'
import TagChip from '../../components/TagChip'
import SpreadsheetEditor from './SpreadsheetEditor'
import AssetDetailModal from './AssetDetailModal'
import { filterAssetRows, positionsForAssetRows, UNTAGGED_FILTER } from './filterAssets'

const control = 'min-h-11 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3'
const holdingColumns = 'grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 sm:gap-x-4'

function scopedRows(positions, instruments, accountId, latestPriceByTicker) {
  if (accountId === 'all') return instruments
  const rows = positions.filter((row) => String(row.account_id) === String(accountId))
  return rows.map((row) => {
    const instrument = instruments.find((item) => item.ticker === row.ticker)
    return {
      ...instrument,
      ...row,
      id: instrument?.id ?? row.instrument_id,
      accountCount: 1,
      unknownCount: row.valuation_status === 'missing' ? 1 : 0,
      staleCount: row.valuation_status === 'stale' ? 1 : 0,
      market_value_krw: effectiveKrwValue(row, latestPriceByTicker),
    }
  }).sort((a, b) => (b.market_value_krw || 0) - (a.market_value_krw || 0))
}

function PositionValue({ row }) {
  const missing = row.valuation_status === 'missing' || row.unknownCount > 0
  const converted = !missing && row.currency !== 'KRW' && Number.isFinite(row.market_value_native) && Number.isFinite(row.market_value_krw)
  return <span className="type-number min-w-0 text-right">
    <strong className="type-value block break-words"><span className="sr-only">평가금액 </span>{missing ? '평가 불가' : formatMoney(row.market_value_native, row.currency)}</strong>
    {converted && <span className="type-secondary block break-words text-[var(--muted-ink)]">({formatKrw(row.market_value_krw)} 환산)</span>}
    {row.instrument_type === 'market' && <span className={`type-secondary block break-words ${returnToneClass(row.priceChangePercent)}`}><span className="sr-only">평균가 대비 가격 수익률 </span>{row.priceChangePercent == null ? '—' : formatSignedPercent(row.priceChangePercent)}</span>}
    {row.valuation_status === 'stale' || row.staleCount > 0 ? <span className="type-secondary text-amber-300">오래된 시세·환율 포함</span> : null}
  </span>
}

export default function AssetsPage({
  accountById, accounts, canEdit, computedPositions, csvCopied, holdingsByTicker,
  instruments, latestPriceByTicker, onCopyCsv, onCreateAccount, onCreateInstrument, onEditAccount,
  onSpreadsheetSave, onSyncPrices, syncingPrices, syncMessage,
  spreadsheetSaving, sheetAccounts, sheetInstruments, holdings, instrumentTags, tagMapByTicker,
  tags, selectedAccountId, onSelectedAccountIdChange, query, onQueryChange, supabase, onTradeSaved, onSheetDirtyChange, registeredTicker, onRegisteredTickerHandled, shared = false,
}) {
  const [selectedTicker, setSelectedTicker] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [detailRefreshRevision, setDetailRefreshRevision] = useState(0)
  const [selectedTags, setSelectedTags] = useState([])
  const [filterNotice, setFilterNotice] = useState('')
  const previousTagIds = useRef(null)
  const openedIndex = useRef(0)
  const listRef = useRef(null)
  useEffect(() => {
    const ids = new Set(tags.map((tag) => String(tag.id)))
    if (previousTagIds.current) {
      const removed = [...previousTagIds.current].filter((id) => !ids.has(id))
      if (removed.length) {
        setSelectedTags((current) => current.filter((id) => id === UNTAGGED_FILTER || !removed.includes(id)))
        setFilterNotice('삭제된 태그의 조회 조건을 해제했습니다.')
      }
    }
    previousTagIds.current = ids
  }, [tags])
  const selectedAccount = accounts.find((item) => String(item.id) === String(selectedAccountId))
  const accountId = selectedAccount ? selectedAccountId : 'all'
  const rows = useMemo(() => scopedRows(computedPositions, instruments, accountId, latestPriceByTicker), [computedPositions, instruments, accountId, latestPriceByTicker])
  const visibleRows = useMemo(() => filterAssetRows(rows, query, selectedTags, tagMapByTicker), [rows, query, selectedTags, tagMapByTicker])
  useEffect(() => {
    if (!registeredTicker) return
    setSelectedTags((current) => current.length ? [] : current)
    if (accountId !== 'all' || query) return
    const row = [...(listRef.current?.querySelectorAll('[data-asset-row]') ?? [])].find((item) => item.dataset.ticker === registeredTicker)
    if (!row) return
    row.focus()
    row.scrollIntoView({ block: 'nearest' })
    onRegisteredTickerHandled?.()
  }, [registeredTicker, visibleRows, accountId, query, onRegisteredTickerHandled])
  const scopedPositions = useMemo(() => accountId === 'all' ? computedPositions : computedPositions.filter((row) => String(row.account_id) === String(accountId)), [accountId, computedPositions])
  const visiblePositions = useMemo(() => positionsForAssetRows(scopedPositions, visibleRows), [scopedPositions, visibleRows])
  const totalValue = visiblePositions.reduce((sum, row) => {
    const value = effectiveKrwValue(row, latestPriceByTicker)
    return sum + (Number.isFinite(value) ? value : 0)
  }, 0)
  const unknownCount = visiblePositions.filter((row) => row.valuation_status === 'missing').length
  const staleCount = visiblePositions.filter((row) => row.valuation_status === 'stale').length
  const latestQuoteDate = useMemo(() => visibleRows.flatMap((row) => [row.ticker, fxTickerForCurrency(row.currency)].filter(Boolean).map((ticker) => latestPriceByTicker.get(ticker)?.price_date)).filter(Boolean).sort().at(-1), [visibleRows, latestPriceByTicker])
  const filtered = Boolean(query.trim() || selectedTags.length)
  function toggleTag(id) {
    setFilterNotice('')
    setSelectedTags((current) => current.includes(id) ? current.filter((tagId) => tagId !== id) : [...current, id])
  }
  function closeDetail() {
    setSelectedTicker(null)
    requestAnimationFrame(() => {
      const buttons = listRef.current?.querySelectorAll('[data-asset-row]') ?? []
      const target = buttons[Math.min(openedIndex.current, buttons.length - 1)] ?? listRef.current
      target?.focus()
    })
  }
  async function refreshDetail() {
    const refreshed = await onTradeSaved()
    if (!refreshed) throw new Error('자산 목록을 새로고침하지 못했습니다.')
    setDetailRefreshRevision((value) => value + 1)
  }
  const selectedInstrument = instruments.find((item) => item.ticker === selectedTicker)
  const linkedHoldings = holdingsByTicker.get(selectedTicker) ?? []
  return <section className="grid gap-5">
      <PagePanel title="자산" status={shared ? '공유 · 읽기 전용' : null} actions={canEdit && <>
        <button className={pagePanelActionClass} disabled={syncingPrices} onClick={onSyncPrices} type="button">{syncingPrices ? '갱신 중' : '가격 갱신'}</button>
        <button className={pagePanelActionClass} onClick={onCreateInstrument} type="button">종목 추가</button>
        <button className={pagePanelActionClass} onClick={onCreateAccount} type="button">계좌 추가</button>
        <button className={pagePanelActionClass} onClick={() => setSheetOpen(true)} type="button">표 편집</button>
      </>} supporting={<>
        <p className="type-number">{filtered ? '조회 결과' : selectedAccount ? selectedAccount.name : '전체 계좌'} · 평가액 {formatKrw(totalValue)}</p>
        {(unknownCount > 0 || staleCount > 0) && <p className="text-amber-300">{unknownCount > 0 ? `평가 불가 ${unknownCount}개 제외` : ''}{unknownCount > 0 && staleCount > 0 ? ' · ' : ''}{staleCount > 0 ? `오래된 시세·환율 ${staleCount}개 포함` : ''}</p>}
        {syncMessage && <p aria-live="polite" role="status">{syncMessage}</p>}
      </>}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
            <label><span className="sr-only">계좌 선택</span><select className={`${control} type-input w-full`} onChange={(event) => onSelectedAccountIdChange(event.target.value)} value={accountId}><option value="all">전체 계좌</option>{accounts.map((account) => <option key={account.id} value={String(account.id)}>{account.name}</option>)}</select></label>
            <input aria-label="종목 검색" className={`${control} type-input w-full`} onChange={(event) => onQueryChange(event.target.value)} placeholder="종목명 또는 티커 검색" type="search" value={query} />
          </div>
          <div><p className="type-label mb-2 text-[var(--muted-ink)]">대표 태그</p><div aria-label="대표 태그 필터" className="flex flex-wrap gap-2" role="group"><TagChip onClick={() => { setSelectedTags([]); setFilterNotice('') }} selected={selectedTags.length === 0}>전체</TagChip><TagChip onClick={() => toggleTag(UNTAGGED_FILTER)} selected={selectedTags.includes(UNTAGGED_FILTER)}>태그 없음</TagChip>{tags.map((tag) => <TagChip key={tag.id} onClick={() => toggleTag(String(tag.id))} selected={selectedTags.includes(String(tag.id))}>{tag.name}</TagChip>)}</div></div>
          {filterNotice && <p aria-live="polite" className="type-secondary text-[var(--muted-ink)]" role="status">{filterNotice}</p>}
          {selectedAccount && canEdit && <div className="flex flex-wrap items-center justify-between gap-2"><span className="type-secondary">{selectedAccount.name} · {scopedPositions.length}개 보유</span><button className={control} onClick={() => onEditAccount(selectedAccount)} type="button">계좌 수정</button></div>}
      </PagePanel>
      <section aria-label="자산 종목" className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel)]" ref={listRef} tabIndex={-1}>
        {!rows.length ? <div className="grid gap-3 p-5 text-sm"><p>{selectedAccount ? '이 계좌에 보유한 종목이 없습니다. 전체 계좌에서 종목을 선택해 보유를 추가할 수 있습니다.' : '아직 등록한 종목이 없습니다.'}</p>{canEdit && <button className={control} onClick={selectedAccount ? () => onSelectedAccountIdChange('all') : onCreateInstrument} type="button">{selectedAccount ? '전체 계좌 보기' : '종목 추가'}</button>}</div>
          : !visibleRows.length ? <div className="flex flex-wrap items-center justify-between gap-2 p-5"><p className="type-secondary text-[var(--muted-ink)]">조건에 맞는 종목이 없습니다.</p><button className={control} onClick={() => { setSelectedTags([]); onQueryChange('') }} type="button">검색·태그 해제</button></div>
          : <div className="divide-y divide-[var(--line)]">
            <div className={`${holdingColumns} list-column-header type-label px-3 text-[var(--muted-ink)] sm:px-4`}>
              <span>종목</span><span className="text-right">보유</span><span className="text-right">평가</span>
            </div>
            {visibleRows.map((row, index) => <button className={`${holdingColumns} min-h-16 w-full items-start px-3 py-3 text-left hover:bg-[var(--surface-2)] sm:px-4`} data-asset-row data-ticker={row.ticker} key={row.ticker} onClick={() => { openedIndex.current = index; setSelectedTicker(row.ticker) }} type="button">
              <span className="min-w-0"><strong className="type-item-title block break-words">{row.display_name ?? row.ticker}</strong><span className="type-meta block break-words text-[var(--muted-ink)]">{row.ticker}{tagMapByTicker.get(row.ticker)?.name ? ` · ${tagMapByTicker.get(row.ticker).name}` : ''}{accountId === 'all' && row.accountCount > 1 ? ` · ${row.accountCount}개 계좌` : ''}</span></span>
              <span className="min-w-0 text-right">{row.instrument_type === 'market' ? <>
                <strong className="type-value type-number block break-words"><span className="sr-only">수량 </span>{formatNumber(row.quantity)}</strong>
                <span className="type-secondary type-number block break-words text-[var(--muted-ink)]">평균가 {formatUnitPrice(row.avgCost, row.currency)}</span>
                <span className="type-secondary type-number block break-words text-[var(--muted-ink)]">현재가 {formatUnitPrice(row.latestPrice, row.currency)}</span>
              </> : <><strong className="type-value block">{row.accountCount === 0 ? '보유 없음' : row.instrument_type === 'valuation' ? '평가형' : '현금성'}</strong>{row.accountCount > 0 && row.instrument_type === 'valuation' && <span className="type-secondary type-number block break-words text-[var(--muted-ink)]">매입 {formatUnitPrice(row.cost_basis_native, row.currency)}</span>}</>}</span>
              {row.accountCount === 0 ? <span className="type-number text-right"><strong className="type-value block">{formatMoney(0, row.currency)}</strong><span className="type-secondary text-[var(--muted-ink)]">—</span></span> : <PositionValue row={row} />}
            </button>)}
            {visibleRows.some((row) => row.instrument_type === 'market') && <p className="type-secondary px-3 py-3 text-[var(--muted-ink)] sm:px-4">{latestQuoteDate ? `가장 최근 시세 기준일 ${latestQuoteDate} · ` : '시세 기준일 없음 · '}수익률은 평균가 대비 현재가 기준이며 수수료·세금·배당·환율 변동은 반영하지 않습니다.</p>}
          </div>}
      </section>
    {sheetOpen && canEdit && <SpreadsheetEditor accounts={sheetAccounts} canSave={canEdit} csvCopied={csvCopied} holdings={holdings} instrumentTags={instrumentTags} instruments={sheetInstruments} onClose={() => setSheetOpen(false)} onCopyCsv={onCopyCsv} onDirtyChange={onSheetDirtyChange} onSave={onSpreadsheetSave} saving={spreadsheetSaving} tags={tags} />}
    {selectedInstrument && <AssetDetailModal accounts={accounts} canEdit={canEdit} holdings={linkedHoldings} instrument={selectedInstrument} key={selectedInstrument.id} onClose={closeDetail} onRefresh={refreshDetail} refreshRevision={detailRefreshRevision} selectedAccountId={accountId} supabase={supabase} tags={tags} />}
  </section>
}
