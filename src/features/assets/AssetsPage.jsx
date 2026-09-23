import { useEffect, useMemo, useState } from 'react'
import ModalShell from '../../components/ModalShell'
import { formatKrw, formatNumber, formatPercent, formatUnitPrice, formattedValueWithConversion } from '../../lib/format'
import { effectiveKrwValue } from '../../lib/portfolioMath'
import SpreadsheetEditor from './SpreadsheetEditor'
import HoldingReasonModal from './HoldingReasonModal'
import TradeEntryModal from './TradeEntryModal'
import HoldingIntegrityModal from './HoldingIntegrityModal'
import { fetchPrivateHoldingNotes, savePrivateHoldingNote } from './privateHoldingNotesData'
import PortfolioIntegritySummary from '../review/PortfolioIntegritySummary'

const control = 'min-h-11 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 text-sm'

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
  return <div className="text-right">
    <strong className="block text-sm">{missing ? '평가 불가' : formattedValueWithConversion(row.market_value_native, row.currency, row.market_value_krw)}</strong>
    {row.valuation_status === 'stale' || row.staleCount > 0 ? <span className="text-xs text-amber-300">오래된 시세·환율 포함</span> : null}
  </div>
}

function InstrumentDetail({ accounts, canEdit, instrument, linkedHoldings, notes, onClose, onEditHolding, onEditInstrument, onEditReason, onRecordTrade, onReconcileHolding, onCreateHolding }) {
  const generalNote = notes.find((item) => Number(item.instrument_id) === Number(instrument.id) && item.account_id == null)
  return <ModalShell onClose={onClose} title={instrument.display_name ?? instrument.ticker} variant="detail">
    <div className="grid gap-4 text-sm">
      <p className="text-[var(--muted-ink)]">{instrument.ticker} · {instrument.currency} · {instrument.tagName ?? '태그 없음'}</p>
      {instrument.instrument_type === 'market' && <p>현재가 {instrument.latestPrice == null ? '시세 없음' : formatUnitPrice(instrument.latestPrice, instrument.currency)}{instrument.latestPriceDate ? ` · 기준일 ${instrument.latestPriceDate}` : ''}</p>}
      {generalNote && <p className="whitespace-pre-wrap break-words text-[var(--muted-ink)]">보유 메모 · {generalNote.note}</p>}
      <div className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
        {linkedHoldings.map((holding) => {
          const account = accounts.find((item) => String(item.id) === String(holding.account_id))
          const privateNote = notes.find((item) => Number(item.instrument_id) === Number(instrument.id) && Number(item.account_id) === Number(holding.account_id))
          return <div className="grid gap-2 p-3" key={holding.id}>
            <div className="flex items-center justify-between gap-2"><strong>{account?.name ?? '계좌'}</strong><PositionValue row={holding} /></div>
            {holding.instrument_type === 'market' && <p>수량 {formatNumber(holding.quantity)} · 평균가 {holding.avgCost == null ? '-' : formatUnitPrice(holding.avgCost, holding.currency)}</p>}
            {holding.instrument_type === 'valuation' && <p>매입금액 {formatUnitPrice(holding.cost_basis_native, holding.currency)}</p>}
            {holding.valuation_status === 'missing' && <p className="text-amber-300">시세·환율 또는 평가금액을 확인하세요.</p>}
            {privateNote && <p className="whitespace-pre-wrap break-words text-[var(--muted-ink)]">계좌 메모 · {privateNote.note}</p>}
            {canEdit && <div className="flex flex-wrap gap-2">
              <button className={control} onClick={() => { onClose(); onEditHolding(holding) }} type="button">보유 수정</button>
              <button className={control} onClick={() => { onClose(); onReconcileHolding(instrument, holding) }} type="button">잔고 맞추기</button>
            </div>}
          </div>
        })}
      </div>
      {canEdit && <div className="flex flex-wrap gap-2">
        <button className={control} onClick={() => { onClose(); onEditInstrument(instrument) }} type="button">종목 정보 수정</button>
        <button className={control} onClick={() => { onClose(); onEditReason(instrument, linkedHoldings) }} type="button">보유 메모</button>
        {instrument.instrument_type === 'market' && <button className={control} onClick={() => { onClose(); onRecordTrade(instrument, linkedHoldings) }} type="button">매매 기록</button>}
        <button className={control} onClick={() => { onClose(); onCreateHolding(instrument.ticker) }} type="button">다른 계좌에 보유 추가</button>
      </div>}
    </div>
  </ModalShell>
}

export default function AssetsPage({
  accountById, accounts, canEdit, computedPositions, csvCopied, holdingsByTicker,
  instruments, latestPriceByTicker, onAssetViewChange, onCopyCsv, onCreateAccount, onCreateHolding, onCreateHoldingForAccount, onEditAccount,
  onEditHolding, onEditInstrument, onSpreadsheetSave, onSyncPrices, syncingPrices, syncMessage,
  spreadsheetSaving, sheetAccounts, sheetInstruments, holdings, instrumentTags, tagMapByTicker,
  tags, selectedAccountId, onSelectedAccountIdChange, query, onQueryChange, supabase, onTradeSaved, onSheetDirtyChange,
}) {
  const [selectedTicker, setSelectedTicker] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [reasonEditor, setReasonEditor] = useState(null)
  const [reasonError, setReasonError] = useState('')
  const [reasonSaving, setReasonSaving] = useState(false)
  const [tradeEditor, setTradeEditor] = useState(null)
  const [integrityEditor, setIntegrityEditor] = useState(null)
  const [privateNotes, setPrivateNotes] = useState([])
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
  const tagSummary = useMemo(() => {
    const byTag = new Map()
    for (const row of scopedPositions) {
      const value = effectiveKrwValue(row, latestPriceByTicker)
      const tag = tagMapByTicker.get(row.ticker)?.name ?? '미분류'
      byTag.set(tag, (byTag.get(tag) ?? 0) + (Number.isFinite(value) ? value : 0))
    }
    return [...byTag].sort((a, b) => b[1] - a[1]).slice(0, 3)
  }, [scopedPositions, latestPriceByTicker, tagMapByTicker])
  useEffect(() => {
    if (!canEdit || !supabase) return undefined
    let active = true
    fetchPrivateHoldingNotes(supabase).then((items) => { if (active) setPrivateNotes(items) }).catch((error) => { if (active) setReasonError(error.message) })
    return () => { active = false }
  }, [canEdit, supabase])
  async function saveReason(payload) {
    setReasonSaving(true); setReasonError('')
    try {
      await savePrivateHoldingNote(supabase, { ...payload, instrumentId: reasonEditor.instrument.id })
      setPrivateNotes(await fetchPrivateHoldingNotes(supabase))
      setReasonEditor(null)
    } catch (error) { setReasonError(error.message) }
    finally { setReasonSaving(false) }
  }
  const selectedInstrument = instruments.find((item) => item.ticker === selectedTicker)
  const linkedHoldings = (holdingsByTicker.get(selectedTicker) ?? []).filter((row) => accountId === 'all' || String(row.account_id) === String(accountId))
  function linkedAccounts(items) { return items.map((row) => accountById.get(row.account_id)).filter(Boolean) }
  return <section className="grid gap-4">
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs text-[var(--muted-ink)]">{selectedAccount ? selectedAccount.name : '전체 계좌'} · 확인 가능한 평가액</p><strong className="mt-1 block text-2xl">{formatKrw(totalValue)}</strong></div>
          {canEdit && <button className={control} disabled={syncingPrices} onClick={() => { setSyncRequestedAt(new Date().toLocaleString('ko-KR')); onSyncPrices() }} type="button">{syncingPrices ? '갱신 중' : '가격 갱신'}</button>}
        </div>
        <p className="mt-2 text-xs text-[var(--muted-ink)]">{latestQuoteDate ? `가장 최근 시세 기준일 ${latestQuoteDate}` : '시세 기준일 없음'}{syncRequestedAt ? ` · 갱신 요청 ${syncRequestedAt}` : ''}</p>
        {(unknownCount > 0 || staleCount > 0) && <p className="mt-2 text-sm text-amber-300">{unknownCount > 0 ? `평가 불가 ${unknownCount}개 제외` : ''}{unknownCount > 0 && staleCount > 0 ? ' · ' : ''}{staleCount > 0 ? `오래된 시세·환율 ${staleCount}개 포함` : ''}</p>}
        {syncMessage && <p aria-live="polite" className="mt-2 text-sm" role="status">{syncMessage}</p>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-3 text-xs text-[var(--muted-ink)]">
          <span>{tagSummary.length ? tagSummary.map(([tag, value]) => `${tag} ${formatPercent(totalValue > 0 ? value / totalValue * 100 : NaN)}`).join(' · ') : '구성 정보가 없습니다.'}</span>
          <button className="min-h-11 text-sm font-semibold text-[var(--accent)]" onClick={() => onAssetViewChange('allocation')} type="button">전체 배분 보기 →</button>
        </div>
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
          : <div className="divide-y divide-[var(--line)]">{visibleRows.map((row) => <button className="grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4 text-left hover:bg-[var(--surface-2)] sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" key={row.ticker} onClick={() => setSelectedTicker(row.ticker)} type="button">
            <span className="min-w-0"><strong className="block break-words text-sm">{row.display_name ?? row.ticker}</strong><span className="text-xs text-[var(--muted-ink)]">{row.ticker}{accountId === 'all' && row.accountCount > 1 ? ` · ${row.accountCount}개 계좌` : ''}</span></span>
            <span className="hidden text-sm sm:block">{row.instrument_type === 'market' ? `수량 ${formatNumber(row.quantity)}` : row.instrument_type === 'valuation' ? '평가형' : '현금성'}</span>
            <span className="hidden text-sm sm:block">{row.instrument_type === 'market' ? `평균가 ${row.avgCost == null ? '-' : formatUnitPrice(row.avgCost, row.currency)}` : row.instrument_type === 'valuation' ? `매입 ${formatUnitPrice(row.cost_basis_native, row.currency)}` : ''}</span>
            <PositionValue row={row} />
            {row.instrument_type === 'market' && <span className="col-span-2 text-xs text-[var(--muted-ink)] sm:hidden">수량 {formatNumber(row.quantity)} · 평균가 {row.avgCost == null ? '-' : formatUnitPrice(row.avgCost, row.currency)}</span>}
          </button>)}</div>}
      </section>
      {canEdit && <PortfolioIntegritySummary supabase={supabase} />}
    {sheetOpen && canEdit && <SpreadsheetEditor accounts={sheetAccounts} canSave={canEdit} csvCopied={csvCopied} holdings={holdings} instrumentTags={instrumentTags} instruments={sheetInstruments} onClose={() => setSheetOpen(false)} onCopyCsv={onCopyCsv} onDirtyChange={onSheetDirtyChange} onSave={onSpreadsheetSave} saving={spreadsheetSaving} tags={tags} />}
    {selectedInstrument && <InstrumentDetail accounts={accounts} canEdit={canEdit} instrument={selectedInstrument} linkedHoldings={linkedHoldings} notes={privateNotes} onClose={() => setSelectedTicker(null)} onEditHolding={onEditHolding} onEditInstrument={onEditInstrument} onCreateHolding={onCreateHolding} onEditReason={(instrument, items) => setReasonEditor({ instrument, accounts: linkedAccounts(items) })} onRecordTrade={(instrument, items) => setTradeEditor({ instrument, accounts: linkedAccounts(items) })} onReconcileHolding={(instrument, holding) => setIntegrityEditor({ instrument, holding })} />}
    {reasonError && <p className="rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-100">{reasonError}</p>}
    {reasonEditor && <HoldingReasonModal accounts={reasonEditor.accounts} instrument={reasonEditor.instrument} notes={privateNotes} onClose={() => setReasonEditor(null)} onSave={saveReason} saving={reasonSaving} />}
    {tradeEditor && <TradeEntryModal accounts={tradeEditor.accounts} instrument={tradeEditor.instrument} onClose={() => setTradeEditor(null)} onSaved={onTradeSaved} supabase={supabase} />}
    {integrityEditor && <HoldingIntegrityModal holding={integrityEditor.holding} instrument={integrityEditor.instrument} onClose={() => setIntegrityEditor(null)} onSaved={onTradeSaved} supabase={supabase} />}
  </section>
}
