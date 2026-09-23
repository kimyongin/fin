import { useEffect, useRef, useState } from 'react'
import ModalShell from '../../components/ModalShell'
import ModalActions from '../../components/ModalActions'
import { formatNumber, formatUnitPrice } from '../../lib/format'
import { confirmTrade, listTransactions, previewTrade } from './tradeData'
import { businessDate } from '../../lib/businessDate'

const inputClass = 'min-h-11 w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 text-base outline-none focus:border-[var(--accent)]'

export default function TradeEntryModal({ accounts, instrument, onClose, onSaved, supabase }) {
  const [draft, setDraft] = useState({ accountId: String(accounts[0]?.id ?? ''), side: 'buy', quantity: '', unitPrice: '', executedOn: businessDate() })
  const initialDraft = useRef(draft)
  const [attempt, setAttempt] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const [transactions, setTransactions] = useState([])

  useEffect(() => {
    let active = true
    listTransactions(supabase, { instrumentId: instrument.id })
      .then((items) => { if (active) setTransactions(items) })
      .catch((next) => { if (active) setError(next.message) })
    return () => { active = false }
  }, [instrument.id, supabase])

  function changeDraft(patch) {
    setDraft((current) => ({ ...current, ...patch }))
    setAttempt(null)
    setSavedMessage('')
  }

  async function handlePreview() {
    setSaving(true)
    setError('')
    try {
      const preview = await previewTrade(supabase, { ...draft, instrumentId: instrument.id })
      setAttempt({ preview, draft: { ...draft, instrumentId: instrument.id }, idempotencyKey: crypto.randomUUID(), committed: false })
    } catch (nextError) {
      setError(nextError.message)
    } finally {
      setSaving(false)
    }
  }

  async function refreshAndClose() {
    setSaving(true)
    setError('')
    try {
      await onSaved()
      onClose()
    } catch (nextError) {
      setError(`저장은 완료됐지만 화면을 새로 불러오지 못했습니다. 다시 불러오세요. (${nextError.message})`)
    } finally {
      setSaving(false)
    }
  }

  async function handleConfirm() {
    if (!attempt || attempt.committed) return refreshAndClose()
    setSaving(true)
    setError('')
    try {
      await confirmTrade(supabase, attempt.draft, attempt.preview, attempt.idempotencyKey)
      setAttempt((current) => ({ ...current, committed: true }))
      setSavedMessage('체결 기록은 저장되었습니다.')
      try {
        await onSaved()
        onClose()
      } catch (refreshError) {
        setError(`저장은 완료됐지만 화면을 새로 불러오지 못했습니다. 다시 불러오세요. (${refreshError.message})`)
      }
    } catch (nextError) {
      if (nextError.message?.includes('Trade estimate is stale')) {
        setAttempt(null)
        setError('그 사이 보유 수량이나 평균가가 바뀌었습니다. 변경 미리보기를 다시 확인해 주세요.')
      } else {
        setError(`저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도할 수 있습니다. (${nextError.message})`)
      }
    } finally {
      setSaving(false)
    }
  }

  const field = (key, label, props = {}) => <label className="grid gap-2"><span className="text-xs font-semibold text-[var(--muted-ink)]">{label}</span><input className={inputClass} onChange={(event) => changeDraft({ [key]: event.target.value })} value={draft[key]} {...props} /></label>
  const preview = attempt?.preview
  const dirty = !attempt?.committed && JSON.stringify(draft) !== JSON.stringify(initialDraft.current)

  return <ModalShell closeDisabled={saving && !attempt?.committed} dirty={dirty} footer={(requestClose) => <ModalActions disabled={saving} onClose={requestClose} onSave={preview ? handleConfirm : handlePreview} saveDisabled={!preview && (!draft.accountId || !draft.quantity || !draft.unitPrice || !draft.executedOn)} saveLabel={saving ? '처리 중' : preview ? attempt.committed ? '새로고침 후 닫기' : '체결 기록 확정' : '변경 미리보기'} />} onClose={onClose} title={`${instrument.display_name} 매매 기록`}><div className="grid gap-4">
    <p className="text-sm leading-6 text-[var(--muted-ink)]">이미 체결된 매매만 기록합니다. 증권사 주문이나 현금 이동은 실행하지 않습니다. 잘못 입력한 기록은 되돌리지 않고 증권사에서 확인한 현재 수량·평균가로 보정합니다.</p>
    <label className="grid gap-2"><span className="text-xs font-semibold text-[var(--muted-ink)]">계좌</span><select className={inputClass} onChange={(event) => changeDraft({ accountId: event.target.value })} value={draft.accountId}>{accounts.map((account) => <option key={account.id} value={String(account.id)}>{account.name}</option>)}</select></label>
    <div className="grid grid-cols-2 gap-3"><button className={`min-h-11 rounded-2xl border px-3 py-2 text-sm font-semibold ${draft.side === 'buy' ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)]'}`} onClick={() => changeDraft({ side: 'buy' })} type="button">매수</button><button className={`min-h-11 rounded-2xl border px-3 py-2 text-sm font-semibold ${draft.side === 'sell' ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)]'}`} onClick={() => changeDraft({ side: 'sell' })} type="button">매도</button></div>
    <div className="grid gap-4 sm:grid-cols-2">{field('quantity', '체결 수량', { inputMode: 'decimal', placeholder: '10' })}{field('unitPrice', `체결 단가 (${instrument.currency})`, { inputMode: 'decimal', placeholder: '70000' })}{field('executedOn', '체결일', { type: 'date' })}</div>
    {preview && <section className="rounded-2xl bg-[var(--surface-2)] p-4"><p className="text-xs font-semibold text-[var(--muted-ink)]">저장 후 예상</p><div className="mt-2 grid grid-cols-2 gap-3 text-sm"><div><span className="text-[var(--muted-ink)]">수량</span><p className="mt-1 font-semibold">{formatNumber(Number(preview.before.quantity))} → {formatNumber(Number(preview.after.quantity))}</p></div><div><span className="text-[var(--muted-ink)]">평균가</span><p className="mt-1 font-semibold">{preview.before.avg_price == null ? '-' : formatUnitPrice(Number(preview.before.avg_price), instrument.currency)} → {preview.after.avg_price == null ? '-' : formatUnitPrice(Number(preview.after.avg_price), instrument.currency)}</p></div></div></section>}
    {savedMessage && <p className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">{savedMessage}</p>}
    {error && <p className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">{error}</p>}
    {transactions.length > 0 && <section className="border-t border-[var(--line)] pt-4"><h3 className="text-sm font-semibold">최근 기록</h3><div className="mt-2 grid gap-2">{transactions.map((trade) => <div className="rounded-xl bg-[var(--surface-2)] p-3 text-sm" key={trade.id}><span>{trade.executed_on} · {trade.side === 'buy' ? '매수' : '매도'} {formatNumber(Number(trade.quantity))}주</span></div>)}</div></section>}
  </div></ModalShell>
}
