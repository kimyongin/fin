import { useEffect, useRef, useState } from 'react'
import ModalShell, { ConfirmDialog } from '../../components/ModalShell'
import ModalActions from '../../components/ModalActions'
import TagChip, { SingleTagPicker } from '../../components/TagChip'
import ReadOnlyField from '../../components/ReadOnlyField'
import { formatUnitPrice } from '../../lib/format'

const input = 'form-control'

function makeDraft(instrument, holdings, selectedAccountId) {
  return {
    instrument: {
      display_name: instrument.display_name ?? '', currency: instrument.currency ?? 'KRW',
      instrument_type: instrument.instrument_type, tag_id: instrument.tagId ?? '',
      note: instrument.note ?? '',
    },
    holdings: [...holdings].sort((a, b) => Number(String(b.account_id) === String(selectedAccountId)) - Number(String(a.account_id) === String(selectedAccountId))).map((holding) => ({
      id: holding.id, account_id: String(holding.account_id), expected_account_id: holding.account_id,
      expected_state_version: holding.state_version,
      quantity: holding.quantity == null ? '' : String(holding.quantity),
      avg_price: holding.avg_price == null ? '' : String(holding.avg_price),
      purchase_amount: holding.purchase_amount == null ? '' : String(holding.purchase_amount),
      valuation_amount: holding.valuation_amount == null ? '' : String(holding.valuation_amount),
    })),
  }
}

function expectedInstrument(instrument) {
  return {
    display_name: instrument.display_name, currency: instrument.currency,
    instrument_type: instrument.instrument_type, note: instrument.note ?? null,
    tag_id: instrument.tagId ? Number(instrument.tagId) : null,
  }
}

function field(label, value, change, props = {}) {
  return <label className="form-field"><span className="form-label">{label}</span><input className={input} onChange={(event) => change(event.target.value)} value={value} {...props} /></label>
}

export default function AssetDetailModal({ accounts, canEdit, holdings, instrument, onClose, onRefresh, refreshRevision, selectedAccountId, supabase, tags }) {
  const initial = useRef(makeDraft(instrument, holdings, selectedAccountId))
  const expected = useRef(expectedInstrument(instrument))
  const [draft, setDraft] = useState(initial.current)
  const [stage, setStage] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const retryKey = useRef(null)
  const deleteRetry = useRef(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.current)
  const financialChanges = draft.holdings.flatMap((holding) => {
    const before = initial.current.holdings.find((item) => item.id != null && item.id === holding.id)
    const keys = draft.instrument.instrument_type === 'market' ? ['quantity', 'avg_price'] : draft.instrument.instrument_type === 'valuation' ? ['purchase_amount', 'valuation_amount'] : ['valuation_amount']
    if (before && keys.every((key) => Number(before[key]) === Number(holding[key])) && before.account_id === holding.account_id) return []
    return [{ holding, before, keys }]
  })

  useEffect(() => {
    if (!refreshRevision || dirty || confirming) return
    const next = makeDraft(instrument, holdings, selectedAccountId)
    initial.current = next
    expected.current = expectedInstrument(instrument)
    setDraft(next)
    retryKey.current = null
  }, [refreshRevision]) // Refresh is explicit; background price/list updates never discard a draft.

  function changeInstrument(key, value) {
    retryKey.current = null
    setMessage('')
    setDraft((current) => ({ ...current, instrument: { ...current.instrument, [key]: value } }))
  }
  function changeReason(value) { retryKey.current = null; setReason(value) }
  function changeHolding(index, key, value) {
    retryKey.current = null
    setMessage('')
    setDraft((current) => ({ ...current, holdings: current.holdings.map((item, position) => position === index ? { ...item, [key]: value } : item) }))
  }
  function addHolding() {
    retryKey.current = null
    setDraft((current) => ({ ...current, holdings: [...current.holdings, {
      id: null, account_id: '', expected_account_id: null, expected_state_version: null,
      quantity: '', avg_price: '', purchase_amount: '', valuation_amount: '',
    }] }))
  }
  async function save() {
    if (!dirty || saving) return true
    if (!draft.instrument.display_name.trim()) { setError('종목명을 입력해 주세요.'); return false }
    setSaving(true)
    setError('')
    retryKey.current ||= crypto.randomUUID()
    const instrumentPayload = {
      display_name: draft.instrument.display_name, currency: draft.instrument.currency,
      instrument_type: draft.instrument.instrument_type, note: draft.instrument.note,
      tag_id: draft.instrument.tag_id ? Number(draft.instrument.tag_id) : null,
    }
    try {
      const { data, error: rpcError } = await supabase.rpc('app_save_asset_detail_current', {
        input_instrument_id: instrument.id, input_expected: expected.current,
        input_instrument: instrumentPayload, input_holdings: draft.holdings.map((holding) => ({
          id: holding.id, account_id: holding.account_id, expected_account_id: holding.expected_account_id,
          expected_state_version: holding.expected_state_version, quantity: holding.quantity,
          avg_price: holding.avg_price, purchase_amount: holding.purchase_amount,
          valuation_amount: holding.valuation_amount,
        })), input_reason: reason.trim() || null,
        input_idempotency_key: retryKey.current,
      })
      if (rpcError) throw rpcError
      const next = {
        instrument: { ...draft.instrument },
        holdings: data.holdings.map((item) => ({
          ...item, account_id: String(item.account_id), expected_account_id: item.account_id,
          expected_state_version: item.state_version, quantity: item.quantity == null ? '' : String(item.quantity),
          avg_price: item.avg_price == null ? '' : String(item.avg_price),
          purchase_amount: item.purchase_amount == null ? '' : String(item.purchase_amount),
          valuation_amount: item.valuation_amount == null ? '' : String(item.valuation_amount),
        })),
      }
      initial.current = next
      expected.current = {
        display_name: data.instrument.display_name, currency: data.instrument.currency,
        instrument_type: data.instrument.instrument_type, note: data.instrument.note,
        tag_id: data.instrument.tag_id,
      }
      setDraft(next)
      retryKey.current = null
      setReason('')
      setConfirming(false)
      setMessage('저장되었습니다.')
      try { await onRefresh() } catch (refreshError) { setMessage(`저장은 완료됐지만 화면을 새로 불러오지 못했습니다. ${refreshError.message}`) }
      return true
    } catch (nextError) {
      setError(nextError.message ?? '저장하지 못했습니다. 같은 요청으로 다시 시도해 주세요.')
      return false
    } finally { setSaving(false) }
  }
  async function deleteHolding(holding) {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      if (deleteRetry.current?.id !== holding.id) deleteRetry.current = { id: holding.id, key: crypto.randomUUID() }
      const { error: rpcError } = await supabase.rpc('app_delete_holding_checked', {
        input_holding_id: holding.id, input_expected_version: holding.state_version,
        input_idempotency_key: deleteRetry.current.key,
      })
      if (rpcError) throw rpcError
      deleteRetry.current = null
      initial.current = { ...initial.current, holdings: initial.current.holdings.filter((item) => item.id !== holding.id) }
      setDraft(initial.current)
      retryKey.current = null
      setStage(null)
      setMessage('보유를 삭제했습니다.')
      try { await onRefresh() } catch (refreshError) { setMessage(`삭제는 완료됐지만 화면을 새로 불러오지 못했습니다. ${refreshError.message}`) }
    } catch (nextError) {
      setError(nextError.message ?? '보유를 삭제하지 못했습니다.')
    } finally { setSaving(false) }
  }
  async function deleteInstrument() {
    if (saving || holdings.length) return
    setSaving(true)
    setError('')
    try {
      const { error: rpcError } = await supabase.rpc('app_delete_instrument', {
        input_instrument_id: instrument.id, input_request: null, input_source: 'user',
      })
      if (rpcError) throw rpcError
      await onRefresh()
      onClose()
    } catch (nextError) {
      setError(nextError.message ?? '종목을 삭제하지 못했습니다.')
    } finally { setSaving(false) }
  }
  function openStage(next) { setError(''); setStage(next) }

  const setInstrument = (key) => (value) => changeInstrument(key, value)
  return <ModalShell closeDisabled={saving} dirty={dirty} footer={(requestClose) => <ModalActions disabled={saving} onClose={requestClose} onSave={() => { setError(''); financialChanges.length ? setConfirming(true) : save() }} saveDisabled={!dirty} saveLabel={saving ? '저장 중' : '저장'} />} onClose={onClose} title={instrument.display_name ?? instrument.ticker}>
    {stage?.kind === 'deleteHolding' && <ConfirmDialog title="보유 삭제" description={`${dirty ? '저장하지 않은 변경은 버려집니다. ' : ''}${accounts.find((account) => Number(account.id) === Number(stage.holding.account_id))?.name}의 ${instrument.display_name} 보유를 삭제할까요? 이 계좌의 현재 보유값이 제거됩니다.`} confirmLabel="보유 삭제" danger error={error} pending={saving} onCancel={() => { setStage(null); setError('') }} onConfirm={() => deleteHolding(stage.holding)} />}
    {stage?.kind === 'deleteInstrument' && <ConfirmDialog title="종목 삭제" description={`${dirty ? '저장하지 않은 변경은 버려집니다. ' : ''}종목과 연결된 태그·가격 이력을 삭제할까요? 보유가 있는 종목은 삭제할 수 없습니다.`} confirmLabel="종목 삭제" danger error={error} pending={saving} onCancel={() => { setStage(null); setError('') }} onConfirm={deleteInstrument} />}
    {confirming && <ConfirmDialog title="보유값 변경 확인" description="현재 보유값을 다음과 같이 바꿉니다. 매매나 증권사 확인 완료로 자동 분류하지 않습니다." confirmLabel="저장" cancelLabel="계속 편집" error={error} pending={saving} onCancel={() => { setConfirming(false); setError('') }} onConfirm={save}>
      {financialChanges.map(({ holding, before, keys }, index) => <div className="rounded-xl border border-[var(--line)] p-3" key={holding.id ?? `new-${index}`}><strong>{accounts.find((account) => String(account.id) === String(holding.account_id))?.name ?? '계좌'}</strong>{keys.map((key) => <p className="mt-1" key={key}>{({ quantity: '수량', avg_price: '평균가', purchase_amount: '매입금액', valuation_amount: '평가금액/잔액' })[key]}: {before?.[key] || '—'} → {holding[key] || '—'}</p>)}</div>)}
      <label className="form-field"><span className="form-label">변경 사유 (선택)</span><textarea className={input} maxLength={1000} onChange={(event) => changeReason(event.target.value)} rows={3} value={reason} /></label>
    </ConfirmDialog>}
    <div className="type-body grid gap-6">
      {canEdit ? <>
        <section className="grid gap-4"><h3 className="type-item-title">종목 정보</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {field('종목명',draft.instrument.display_name,setInstrument('display_name'))}
            <ReadOnlyField label="티커" value={instrument.ticker} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="form-field"><span className="form-label">통화</span><select className={input} onChange={(event) => setInstrument('currency')(event.target.value)} value={draft.instrument.currency}>{['KRW','USD','JPY'].map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
            {holdings.length > 0 ? <ReadOnlyField label="종류" value={{ market: '시세형', valuation: '평가형', cash: '현금성' }[draft.instrument.instrument_type]} /> : <label className="form-field"><span className="form-label">종류</span><select className={input} onChange={(event) => setInstrument('instrument_type')(event.target.value)} value={draft.instrument.instrument_type}><option value="market">시세형</option><option value="valuation">평가형</option><option value="cash">현금성</option></select></label>}
          </div>
          {draft.instrument.instrument_type === 'market' && <><div className="grid gap-4 sm:grid-cols-2"><ReadOnlyField describedBy="quote-update-help" label="현재가" value={instrument.latestPrice == null ? '—' : formatUnitPrice(instrument.latestPrice, instrument.currency)} /><ReadOnlyField describedBy="quote-update-help" label="기준일" value={instrument.latestPriceDate ?? '—'} /></div><p className="type-secondary text-[var(--muted-ink)]" id="quote-update-help">시세는 자산 메뉴의 가격 갱신으로 갱신합니다.</p></>}
          <SingleTagPicker onChange={setInstrument('tag_id')} tags={tags} value={draft.instrument.tag_id} />
          <label className="form-field"><span className="form-label">메모</span><textarea className={input} onChange={(event) => setInstrument('note')(event.target.value)} rows={3} value={draft.instrument.note} /></label>
        </section>
        <section className="grid gap-4 border-t border-[var(--line)] pt-5"><h3 className="font-semibold">계좌별 보유</h3>{draft.holdings.map((holding,index) => {
          const account = accounts.find((item) => Number(item.id) === Number(holding.account_id))
          const current = holdings.find((item) => Number(item.id) === Number(holding.id))
          return <div className="grid gap-4 rounded-2xl border border-[var(--line)] p-4" key={holding.id ?? `new-${index}`}>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <strong className="min-w-0 break-words">{account?.name ?? '새 보유'}</strong>
              {holding.id && <button className="min-h-11 shrink-0 rounded-xl border border-red-500/50 px-3 text-red-200" onClick={() => openStage({kind:'deleteHolding',holding:current})} type="button">보유 삭제</button>}
            </div>
            <label className="form-field"><span className="form-label">계좌</span><select className={input} onChange={(event) => changeHolding(index,'account_id',event.target.value)} value={holding.account_id}><option value="">계좌 선택</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <div className="grid gap-4 sm:grid-cols-2">{draft.instrument.instrument_type === 'market' ? <>{field('수량',holding.quantity,(value) => changeHolding(index,'quantity',value),{ inputMode: 'decimal' })}{field('평균가',holding.avg_price,(value) => changeHolding(index,'avg_price',value),{ inputMode: 'decimal' })}</> : draft.instrument.instrument_type === 'valuation' ? <>{field('매입금액',holding.purchase_amount,(value) => changeHolding(index,'purchase_amount',value),{ inputMode: 'decimal' })}{field('평가금액',holding.valuation_amount,(value) => changeHolding(index,'valuation_amount',value),{ inputMode: 'decimal' })}</> : field('현금 잔액',holding.valuation_amount,(value) => changeHolding(index,'valuation_amount',value),{ inputMode: 'decimal' })}</div>
          </div>
        })}{accounts.length ? <button className="min-h-11 rounded-xl border border-[var(--line)] px-3" onClick={addHolding} type="button">{draft.holdings.length ? '다른 계좌에 보유 추가' : '보유 추가'}</button> : <p className="type-secondary text-[var(--muted-ink)]">보유를 추가하려면 먼저 자산 메뉴에서 계좌를 추가해 주세요.</p>}{holdings.length === 0 && <button className="min-h-11 justify-self-start rounded-xl border border-red-500/50 px-3 text-red-200" onClick={() => openStage({ kind: 'deleteInstrument' })} type="button">종목 삭제</button>}</section>
      </> : <div className="grid gap-4"><div className="grid gap-4 sm:grid-cols-2"><ReadOnlyField label="종목명" value={instrument.display_name} /><ReadOnlyField label="티커" value={instrument.ticker} /><ReadOnlyField label="통화" value={instrument.currency} /><ReadOnlyField label="종류" value={{ market: '시세형', valuation: '평가형', cash: '현금성' }[instrument.instrument_type]} />{instrument.instrument_type === 'market' && <><ReadOnlyField label="현재가" value={instrument.latestPrice == null ? '—' : formatUnitPrice(instrument.latestPrice, instrument.currency)} /><ReadOnlyField label="기준일" value={instrument.latestPriceDate ?? '—'} /></>}</div>{instrument.tagId ? <TagChip>{instrument.tagName}</TagChip> : <p className="type-secondary text-[var(--muted-ink)]">태그 없음</p>}{holdings.length > 0 && <section className="grid gap-4 border-t border-[var(--line)] pt-5"><h3 className="type-item-title">계좌별 보유</h3>{holdings.map((holding) => <div className="grid gap-4 rounded-2xl border border-[var(--line)] p-4" key={holding.id}><ReadOnlyField label="계좌" value={accounts.find((item) => Number(item.id) === Number(holding.account_id))?.name ?? '계좌'} /><div className="grid gap-4 sm:grid-cols-2">{instrument.instrument_type === 'market' ? <><ReadOnlyField label="수량" value={holding.quantity} /><ReadOnlyField label="평균가" value={holding.avg_price} /></> : instrument.instrument_type === 'valuation' ? <><ReadOnlyField label="매입금액" value={holding.purchase_amount} /><ReadOnlyField label="평가금액" value={holding.valuation_amount} /></> : <ReadOnlyField label="현금 잔액" value={holding.valuation_amount} />}</div></div>)}</section>}</div>}
      {message && <p aria-live="polite" className="type-secondary text-emerald-200">{message}</p>}
      {error && <p role="alert" className="type-secondary rounded-2xl border border-red-400/40 p-3 text-red-100">{error}</p>}
    </div>
  </ModalShell>
}
