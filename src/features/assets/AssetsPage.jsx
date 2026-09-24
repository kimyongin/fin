import { useMemo, useState } from 'react'
import { formatKrw, formatMoney, formatNumber, formatSignedPercent, formatUnitPrice, returnToneClass } from '../../lib/format'
import { effectiveKrwValue } from '../../lib/portfolioMath'
import SpreadsheetEditor from './SpreadsheetEditor'
import AssetDetailModal from './AssetDetailModal'
import PortfolioIntegritySummary from '../review/PortfolioIntegritySummary'

const control = 'min-h-11 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 text-sm'
const holdingColumns = 'grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 sm:gap-x-4'

function scopedRows(positions, instruments, accountId, latestPriceByTicker) {
  if (accountId === 'all') return instruments.filter((row) => row.accountCount > 0)
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
  return <span className="min-w-0 text-right">
    <strong className="block break-words text-sm"><span className="sr-only">평가금액 </span>{missing ? '평가 불가' : formatMoney(row.market_value_native, row.currency)}</strong>
    {converted && <span className="block break-words text-xs text-[var(--muted-ink)]">({formatKrw(row.market_value_krw)} 환산)</span>}
    {row.instrument_type === 'market' && <span className={`block break-words text-xs ${returnToneClass(row.priceChangePercent)}`}><span className="sr-only">평균가 대비 가격 수익률 </span>{row.priceChangePercent == null ? '—' : formatSignedPercent(row.priceChangePercent)}</span>}
    {row.valuation_status === 'stale' || row.staleCount > 0 ? <span className="text-xs text-amber-300">오래된 시세·환율 포함</span> : null}
  </span>
}

export default function AssetsPage({
  accountById, accounts, canEdit, computedPositions, csvCopied, holdingsByTicker,
  instruments, latestPriceByTicker, onCopyCsv, onCreateAccount, onCreateHolding, onCreateHoldingForAccount, onEditAccount,
  onEditHolding, onEditInstrument, onSpreadsheetSave, onSyncPrices, syncingPrices, syncMessage,
  spreadsheetSaving, sheetAccounts, sheetInstruments, holdings, instrumentTags, tagMapByTicker,
  tags, selectedAccountId, onSelectedAccountIdChange, query, onQueryChange, supabase, onTradeSaved, onSheetDirtyChange,
}) {
  const [selectedTicker, setSelectedTicker] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [detailRefreshRevision, setDetailRefreshRevision] = useState(0)
  const [syncRequestedAt, setSyncRequestedAt] = useState('')
  const latestQuoteDate = useMemo(() => [...latestPriceByTicker.values()].map((row) => row.price_date).filter(Boolean).sort().at(-1), [latestPriceByTicker])
  const selectedAccount = accounts.find((item) => String(item.id) === String(selectedAccountId))
  const accountId = selectedAccount ? selectedAccountId : 'all'
  const rows = useMemo(() => scopedRows(computedPositions, instruments, accountId, latestPriceByTicker), [computedPositions, instruments, accountId, latestPriceByTicker])
  const visibleRows = useMemo(() => rows.filter((row) => [row.display_name, row.ticker].some((value) => String(value ?? '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))), [rows, query])
  const scopedPositions = useMemo(() => accountId === 'all' ? computedPositions : computedPositions.filter((row) => String(row.account_id) === String(accountId)), [accountId, computedPositions])
  const totalValue = scopedPositions.reduce((sum, row) => {
    const value = effectiveKrwValue(row, latestPriceByTicker)
    return sum + (Number.isFinite(value) ? value : 0)
  }, 0)
  const unknownCount = scopedPositions.filter((row) => row.valuation_status === 'missing').length
  const staleCount = scopedPositions.filter((row) => row.valuation_status === 'stale').length
  async function refreshDetail() {
    await onTradeSaved()
    setDetailRefreshRevision((value) => value + 1)
  }
  const selectedInstrument = instruments.find((item) => item.ticker === selectedTicker)
  const linkedHoldings = holdingsByTicker.get(selectedTicker) ?? []
  return <section className="grid gap-4">
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs text-[var(--muted-ink)]">{selectedAccount ? selectedAccount.name : '전체 계좌'} · 확인 가능한 평가액</p><strong className="mt-1 block text-2xl">{formatKrw(totalValue)}</strong></div>
          {canEdit && <button className={control} disabled={syncingPrices} onClick={() => { setSyncRequestedAt(new Date().toLocaleString('ko-KR')); onSyncPrices() }} type="button">{syncingPrices ? '갱신 중' : '가격 갱신'}</button>}
        </div>
        <p className="mt-2 text-xs text-[var(--muted-ink)]">{latestQuoteDate ? `가장 최근 시세 기준일 ${latestQuoteDate}` : '시세 기준일 없음'}{syncRequestedAt ? ` · 갱신 요청 ${syncRequestedAt}` : ''}</p>
        {(unknownCount > 0 || staleCount > 0) && <p className="mt-2 text-sm text-amber-300">{unknownCount > 0 ? `평가 불가 ${unknownCount}개 제외` : ''}{unknownCount > 0 && staleCount > 0 ? ' · ' : ''}{staleCount > 0 ? `오래된 시세·환율 ${staleCount}개 포함` : ''}</p>}
        {syncMessage && <p aria-live="polite" className="mt-2 text-sm" role="status">{syncMessage}</p>}
      </section>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]">
        <label><span className="sr-only">계좌 선택</span><select className={`${control} w-full`} onChange={(event) => onSelectedAccountIdChange(event.target.value)} value={accountId}><option value="all">전체 계좌</option>{accounts.map((account) => <option key={account.id} value={String(account.id)}>{account.name}</option>)}</select></label>
        <input aria-label="종목 검색" className={`${control} w-full`} onChange={(event) => onQueryChange(event.target.value)} placeholder="종목명 또는 티커 검색" type="search" value={query} />
        <div className="flex gap-2">
          {canEdit && <details className="relative"><summary className={`${control} flex cursor-pointer list-none items-center font-semibold [&::-webkit-details-marker]:hidden`}>추가 ▾</summary><div className="absolute right-0 z-20 mt-1 min-w-36 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-1 shadow-[var(--shadow-soft)]"><button className="min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-[var(--surface-2)]" onClick={(event) => { event.currentTarget.closest('details').open = false; if (accountId === 'all') onCreateHolding(); else onCreateHoldingForAccount(accountId) }} type="button">보유 추가</button><button className="min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-[var(--surface-2)]" onClick={(event) => { event.currentTarget.closest('details').open = false; onCreateAccount() }} type="button">계좌 추가</button></div></details>}
          {canEdit && <button className={control} onClick={() => setSheetOpen(true)} type="button">표 편집</button>}
        </div>
      </div>
      {selectedAccount && canEdit && <div className="flex items-center justify-between gap-2 text-sm"><span>{selectedAccount.name} · {scopedPositions.length}개 보유</span><button className={control} onClick={() => onEditAccount(selectedAccount)} type="button">계좌 수정</button></div>}
      <section aria-label="보유 종목" className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel)]">
        {!accounts.length && !rows.length ? <div className="grid gap-3 p-5 text-sm"><p>계좌를 만든 다음 보유 종목을 추가해 주세요.</p>{canEdit && <button className={control} onClick={onCreateAccount} type="button">계좌 추가</button>}</div>
          : !rows.length ? <div className="grid gap-2 p-5 text-sm text-[var(--muted-ink)]"><p>{selectedAccount ? '이 계좌에' : '아직'} 보유 종목이 없습니다.</p>{canEdit && <button className={control} onClick={() => selectedAccount ? onCreateHoldingForAccount(accountId) : onCreateHolding()} type="button">보유 추가</button>}</div>
          : !visibleRows.length ? <p className="p-5 text-sm text-[var(--muted-ink)]">검색 결과가 없습니다.</p>
          : <div className="divide-y divide-[var(--line)]">
            <div className={`${holdingColumns} px-3 py-2 text-xs font-semibold text-[var(--muted-ink)] sm:px-4`}>
              <span>종목</span><span className="text-right">보유</span><span className="text-right">평가</span>
            </div>
            {visibleRows.map((row) => <button className={`${holdingColumns} min-h-16 w-full items-start px-3 py-3 text-left hover:bg-[var(--surface-2)] sm:px-4`} key={row.ticker} onClick={() => setSelectedTicker(row.ticker)} type="button">
              <span className="min-w-0"><strong className="block break-words text-sm">{row.display_name ?? row.ticker}</strong><span className="block break-words text-xs text-[var(--muted-ink)]">{row.ticker}{tagMapByTicker.get(row.ticker)?.name ? ` · ${tagMapByTicker.get(row.ticker).name}` : ''}{accountId === 'all' && row.accountCount > 1 ? ` · ${row.accountCount}개 계좌` : ''}</span></span>
              <span className="min-w-0 text-right">{row.instrument_type === 'market' ? <>
                <strong className="block break-words text-sm"><span className="sr-only">수량 </span>{formatNumber(row.quantity)}</strong>
                <span className="block break-words text-xs text-[var(--muted-ink)]">평균가 {formatUnitPrice(row.avgCost, row.currency)}</span>
                <span className="block break-words text-xs text-[var(--muted-ink)]">현재가 {formatUnitPrice(row.latestPrice, row.currency)}</span>
              </> : <><strong className="block text-sm">{row.instrument_type === 'valuation' ? '평가형' : '현금성'}</strong>{row.instrument_type === 'valuation' && <span className="block break-words text-xs text-[var(--muted-ink)]">매입 {formatUnitPrice(row.cost_basis_native, row.currency)}</span>}</>}</span>
              <PositionValue row={row} />
            </button>)}
            {visibleRows.some((row) => row.instrument_type === 'market') && <p className="px-3 py-3 text-xs text-[var(--muted-ink)] sm:px-4">수익률은 평균가 대비 현재가 기준이며 수수료·세금·배당·환율 변동은 반영하지 않습니다.</p>}
          </div>}
      </section>
      {canEdit && <PortfolioIntegritySummary supabase={supabase} />}
    {sheetOpen && canEdit && <SpreadsheetEditor accounts={sheetAccounts} canSave={canEdit} csvCopied={csvCopied} holdings={holdings} instrumentTags={instrumentTags} instruments={sheetInstruments} onClose={() => setSheetOpen(false)} onCopyCsv={onCopyCsv} onDirtyChange={onSheetDirtyChange} onSave={onSpreadsheetSave} saving={spreadsheetSaving} tags={tags} />}
    {selectedInstrument && <AssetDetailModal accounts={accounts} canEdit={canEdit} holdings={linkedHoldings} instrument={selectedInstrument} key={selectedInstrument.id} onClose={() => setSelectedTicker(null)} onRefresh={refreshDetail} refreshRevision={detailRefreshRevision} selectedAccountId={accountId} supabase={supabase} tags={tags} />}
  </section>
}
