import { useEffect, useRef, useState } from 'react'
import ModalShell from '../../components/ModalShell'
import ModalActions from '../../components/ModalActions'
import { formatUnitPrice, formattedValueWithConversion } from '../../lib/format'
import TradeEntryModal from './TradeEntryModal'
import HoldingIntegrityModal from './HoldingIntegrityModal'

const input = 'min-h-11 w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 text-base outline-none focus:border-[var(--accent)]'

function makeDraft(instrument, holdings, notes, selectedAccountId) {
  const privateNote = (accountId) => notes.find((item) => Number(item.instrument_id) === Number(instrument.id) && (accountId == null ? item.account_id == null : Number(item.account_id) === Number(accountId)))?.note ?? ''
  return {
    instrument: {
      display_name: instrument.display_name ?? '', currency: instrument.currency ?? 'KRW',
      instrument_type: instrument.instrument_type, tag_id: instrument.tagId ?? '',
      note: instrument.note ?? '', private_note: privateNote(null), manual_price: '',
      manual_price_date: instrument.latestPriceDate ?? new Date().toISOString().slice(0, 10),
    },
    holdings: [...holdings].sort((a, b) => Number(String(b.account_id) === String(selectedAccountId)) - Number(String(a.account_id) === String(selectedAccountId))).map((holding) => ({
      id: holding.id, account_id: String(holding.account_id), expected_account_id: holding.account_id,
      expected_state_version: holding.state_version, expected_note: holding.note ?? null,
      expected_private_note: privateNote(holding.account_id) || null,
      quantity: holding.quantity == null ? '' : String(holding.quantity),
      avg_price: holding.avg_price == null ? '' : String(holding.avg_price),
      purchase_amount: holding.purchase_amount == null ? '' : String(holding.purchase_amount),
      valuation_amount: holding.valuation_amount == null ? '' : String(holding.valuation_amount),
      note: holding.note ?? '', private_note: privateNote(holding.account_id),
    })),
  }
}

function expectedInstrument(instrument, draft) {
  return {
    display_name: instrument.display_name, currency: instrument.currency,
    instrument_type: instrument.instrument_type, note: instrument.note ?? null,
    private_note: draft.instrument.private_note.trim() || null,
    tag_id: instrument.tagId ? Number(instrument.tagId) : null,
  }
}

function field(label, value, change, props = {}) {
  return <label className="grid gap-2"><span className="text-xs font-semibold text-[var(--muted-ink)]">{label}</span><input className={input} onChange={(event) => change(event.target.value)} value={value} {...props} /></label>
}

export default function AssetDetailModal({ accounts, canEdit, holdings, instrument, notes, notesStatus, onClose, onRefresh, refreshRevision, selectedAccountId, supabase, tags }) {
  const initial = useRef(makeDraft(instrument, holdings, notes, selectedAccountId))
  const expected = useRef(expectedInstrument(instrument, initial.current))
  const [draft, setDraft] = useState(initial.current)
  const [stage, setStage] = useState(null)
  const [pendingStage, setPendingStage] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const retryKey = useRef(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.current)

  useEffect(() => {
    if (!refreshRevision || notesStatus !== 'ready') return
    const next = makeDraft(instrument, holdings, notes, selectedAccountId)
    initial.current = next
    expected.current = expectedInstrument(instrument, next)
    setDraft(next)
    retryKey.current = null
  }, [refreshRevision]) // Refresh is explicit; background price/list updates never discard a draft.

  function changeInstrument(key, value) {
    retryKey.current = null
    setMessage('')
    setDraft((current) => ({ ...current, instrument: { ...current.instrument, [key]: value } }))
  }
  function changeHolding(index, key, value) {
    retryKey.current = null
    setMessage('')
    setDraft((current) => ({ ...current, holdings: current.holdings.map((item, position) => position === index ? { ...item, [key]: value } : item) }))
  }
  function addHolding() {
    retryKey.current = null
    setDraft((current) => ({ ...current, holdings: [...current.holdings, {
      id: null, account_id: '', expected_account_id: null, expected_state_version: null,
      expected_note: null, expected_private_note: null, quantity: '', avg_price: '',
      purchase_amount: '', valuation_amount: '', note: '', private_note: '',
    }] }))
  }
  async function save() {
    if (!dirty || saving || notesStatus !== 'ready') return true
    if (!draft.instrument.display_name.trim()) { setError('종목명을 입력해 주세요.'); return false }
    setSaving(true)
    setError('')
    retryKey.current ||= crypto.randomUUID()
    const instrumentPayload = { ...draft.instrument, tag_id: draft.instrument.tag_id ? Number(draft.instrument.tag_id) : null }
    if (!instrumentPayload.manual_price.trim()) {
      delete instrumentPayload.manual_price
      delete instrumentPayload.manual_price_date
    }
    try {
      const { data, error: rpcError } = await supabase.rpc('app_save_asset_detail', {
        input_instrument_id: instrument.id, input_expected: expected.current,
        input_instrument: instrumentPayload, input_holdings: draft.holdings,
        input_idempotency_key: retryKey.current,
      })
      if (rpcError) throw rpcError
      const next = {
        instrument: { ...draft.instrument, manual_price: '' },
        holdings: data.holdings.map((item) => ({
          ...item, account_id: String(item.account_id), expected_account_id: item.account_id,
          expected_state_version: item.state_version, expected_note: item.note,
          expected_private_note: item.private_note, quantity: item.quantity == null ? '' : String(item.quantity),
          avg_price: item.avg_price == null ? '' : String(item.avg_price),
          purchase_amount: item.purchase_amount == null ? '' : String(item.purchase_amount),
          valuation_amount: item.valuation_amount == null ? '' : String(item.valuation_amount),
          note: item.note ?? '', private_note: item.private_note ?? '',
        })),
      }
      initial.current = next
      expected.current = {
        display_name: data.instrument.display_name, currency: data.instrument.currency,
        instrument_type: data.instrument.instrument_type, note: data.instrument.note,
        private_note: data.instrument.private_note, tag_id: data.instrument.tag_id,
      }
      setDraft(next)
      retryKey.current = null
      setMessage('저장되었습니다.')
      try { await onRefresh() } catch (refreshError) { setMessage(`저장은 완료됐지만 화면을 새로 불러오지 못했습니다. ${refreshError.message}`) }
      return true
    } catch (nextError) {
      setError(nextError.message ?? '저장하지 못했습니다. 같은 요청으로 다시 시도해 주세요.')
      return false
    } finally { setSaving(false) }
  }
  async function deleteHolding(holdingId) {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const { error: rpcError } = await supabase.rpc('app_delete_holding', {
        input_holding_id: holdingId, input_request: null, input_source: 'user',
      })
      if (rpcError) throw rpcError
      setStage(null)
      await onRefresh()
    } catch (nextError) {
      setError(nextError.message ?? '보유를 삭제하지 못했습니다.')
    } finally { setSaving(false) }
  }
  function openStage(next) { if (dirty) setPendingStage(next); else setStage(next) }
  function discardAndContinue() { setDraft(initial.current); retryKey.current = null; setPendingStage(null); setStage(pendingStage) }
  async function saveAndContinue() { if (await save()) { setStage(pendingStage); setPendingStage(null) } }
  if (stage?.kind === 'trade') return <TradeEntryModal accounts={accounts.filter((account) => draft.holdings.some((holding) => Number(holding.account_id) === Number(account.id)))} instrument={instrument} onClose={() => setStage(null)} onSaved={onRefresh} supabase={supabase} />
  if (stage?.kind === 'verify') return <HoldingIntegrityModal holding={stage.holding} instrument={instrument} onClose={() => setStage(null)} onSaved={onRefresh} supabase={supabase} />
  if (stage?.kind === 'deleteHolding') return <ModalShell closeDisabled={saving} footer={<div className="flex justify-end gap-2"><button className="min-h-11 rounded-xl border border-[var(--line)] px-4" disabled={saving} onClick={() => { setStage(null); setError('') }} type="button">취소</button><button className="min-h-11 rounded-xl bg-red-700 px-4 font-semibold text-white" disabled={saving} onClick={() => deleteHolding(stage.holding.id)} type="button">보유 삭제</button></div>} onClose={() => { setStage(null); setError('') }} title="보유 삭제"><p>{accounts.find((account) => Number(account.id) === Number(stage.holding.account_id))?.name}의 {instrument.display_name} 보유를 삭제할까요? 이 계좌의 현재 수량·메모가 제거됩니다.</p>{error && <p role="alert" className="mt-3 text-red-200">{error}</p>}</ModalShell>

  const setInstrument = (key) => (value) => changeInstrument(key, value)
  return <ModalShell closeDisabled={saving} dirty={dirty} footer={(requestClose) => pendingStage ? <div className="grid gap-3" role="alert"><p className="text-sm">저장하지 않은 변경이 있습니다. 어떻게 할까요?</p><div className="flex flex-wrap gap-2"><button className={input} onClick={() => setPendingStage(null)} type="button">계속 편집</button><button className={input} onClick={discardAndContinue} type="button">버리고 계속</button><button className={input} disabled={saving} onClick={saveAndContinue} type="button">저장 후 계속</button></div></div> : <ModalActions disabled={saving} onClose={requestClose} onSave={save} saveDisabled={!dirty || notesStatus !== 'ready'} saveLabel={saving ? '저장 중' : '저장'} />} onClose={onClose} title={instrument.display_name ?? instrument.ticker}>
    <div className="grid gap-6 text-sm">
      <p className="text-[var(--muted-ink)]">{instrument.ticker} · 자동 시세 {instrument.latestPrice == null ? '없음' : formatUnitPrice(instrument.latestPrice, instrument.currency)}{instrument.latestPriceDate ? ` · ${instrument.latestPriceDate}` : ''}</p>
      {notesStatus === 'loading' && canEdit && <p>비공개 메모를 불러오는 중입니다.</p>}
      {notesStatus === 'error' && canEdit && <p className="text-red-200">비공개 메모를 읽지 못해 편집을 막았습니다. 다시 열어 주세요.</p>}
      {canEdit ? <>
        <section className="grid gap-4"><h3 className="font-semibold">종목 공통 정보</h3>
          {field('종목명',draft.instrument.display_name,setInstrument('display_name'))}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2"><span className="text-xs font-semibold text-[var(--muted-ink)]">통화</span><select className={input} onChange={(event) => setInstrument('currency')(event.target.value)} value={draft.instrument.currency}>{['KRW','USD','JPY'].map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
            <label className="grid gap-2"><span className="text-xs font-semibold text-[var(--muted-ink)]">종류</span><select className={input} disabled={holdings.length > 0} onChange={(event) => setInstrument('instrument_type')(event.target.value)} value={draft.instrument.instrument_type}><option value="market">시세형</option><option value="valuation">평가형</option><option value="cash">현금성</option></select></label>
          </div>
          {holdings.length > 0 && <p className="text-xs text-[var(--muted-ink)]">보유가 있는 종목의 종류는 변경할 수 없습니다.</p>}
          <label className="grid gap-2"><span className="text-xs font-semibold text-[var(--muted-ink)]">대표 태그</span><select className={input} onChange={(event) => setInstrument('tag_id')(event.target.value)} value={draft.instrument.tag_id}><option value="">태그 없음</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
          <label className="grid gap-2"><span className="text-xs font-semibold text-[var(--muted-ink)]">일반 메모 · 공유 가능</span><textarea className={input} onChange={(event) => setInstrument('note')(event.target.value)} value={draft.instrument.note} /></label>
          <label className="grid gap-2"><span className="text-xs font-semibold text-[var(--muted-ink)]">보유 이유 · 나만 보기</span><textarea className={input} disabled={notesStatus !== 'ready'} onChange={(event) => setInstrument('private_note')(event.target.value)} value={draft.instrument.private_note} /></label>
          {draft.instrument.instrument_type === 'market' && <details><summary className="cursor-pointer">수동 가격 입력</summary><div className="mt-3 grid gap-4 sm:grid-cols-2">{field('가격',draft.instrument.manual_price,setInstrument('manual_price'),{ inputMode: 'decimal' })}{field('기준일',draft.instrument.manual_price_date,setInstrument('manual_price_date'),{ type: 'date' })}</div></details>}
        </section>
        <section className="grid gap-4 border-t border-[var(--line)] pt-5"><h3 className="font-semibold">계좌별 보유</h3>{draft.holdings.map((holding,index) => {
          const account = accounts.find((item) => Number(item.id) === Number(holding.account_id))
          const current = holdings.find((item) => Number(item.id) === Number(holding.id))
          return <div className="grid gap-4 rounded-2xl border border-[var(--line)] p-4" key={holding.id ?? `new-${index}`}>
            <strong>{account?.name ?? '새 보유'}</strong>
            {current && <span className="text-xs text-[var(--muted-ink)]">평가액 {formattedValueWithConversion(current.market_value_native,current.currency,current.market_value_krw)}</span>}
            <label className="grid gap-2"><span className="text-xs font-semibold text-[var(--muted-ink)]">계좌</span><select className={input} onChange={(event) => changeHolding(index,'account_id',event.target.value)} value={holding.account_id}><option value="">계좌 선택</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <div className="grid gap-4 sm:grid-cols-2">{draft.instrument.instrument_type === 'market' ? <>{field('수량',holding.quantity,(value) => changeHolding(index,'quantity',value),{ inputMode: 'decimal' })}{field('평균가',holding.avg_price,(value) => changeHolding(index,'avg_price',value),{ inputMode: 'decimal' })}</> : draft.instrument.instrument_type === 'valuation' ? <>{field('매입금액',holding.purchase_amount,(value) => changeHolding(index,'purchase_amount',value),{ inputMode: 'decimal' })}{field('평가금액',holding.valuation_amount,(value) => changeHolding(index,'valuation_amount',value),{ inputMode: 'decimal' })}</> : field('현금 잔액',holding.valuation_amount,(value) => changeHolding(index,'valuation_amount',value),{ inputMode: 'decimal' })}</div>
            <label className="grid gap-2"><span className="text-xs font-semibold text-[var(--muted-ink)]">계좌 메모 · 공유 가능</span><textarea className={input} onChange={(event) => changeHolding(index,'note',event.target.value)} value={holding.note} /></label>
            <label className="grid gap-2"><span className="text-xs font-semibold text-[var(--muted-ink)]">보유 이유 · 나만 보기</span><textarea className={input} disabled={notesStatus !== 'ready'} onChange={(event) => changeHolding(index,'private_note',event.target.value)} value={holding.private_note} /></label>
            {holding.id && <div className="flex flex-wrap gap-2"><button className="min-h-11 rounded-xl border border-[var(--line)] px-3" onClick={() => openStage({kind:'verify',holding:current})} type="button">증권사 확인·보정</button><button className="min-h-11 rounded-xl border border-red-500/50 px-3 text-red-200" onClick={() => openStage({kind:'deleteHolding',holding:current})} type="button">보유 삭제</button></div>}
          </div>
        })}<button className="min-h-11 rounded-xl border border-[var(--line)] px-3" onClick={addHolding} type="button">다른 계좌에 보유 추가</button></section>
        {draft.instrument.instrument_type === 'market' && <button className="min-h-11 rounded-xl border border-[var(--line)] px-3" onClick={() => openStage({kind:'trade'})} type="button">매매 기록</button>}
      </> : <div className="grid gap-3"><p>{instrument.display_name} · {instrument.currency} · {instrument.tagName ?? '태그 없음'}</p>{holdings.map((holding) => <p key={holding.id}>{accounts.find((item) => Number(item.id) === Number(holding.account_id))?.name ?? '계좌'} · {holding.quantity ?? holding.valuation_amount}</p>)}</div>}
      {message && <p aria-live="polite" className="text-emerald-200">{message}</p>}
      {error && <p role="alert" className="rounded-2xl border border-red-400/40 p-3 text-red-100">{error}</p>}
    </div>
  </ModalShell>
}
