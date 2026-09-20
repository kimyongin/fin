import { useState } from 'react'
import ModalShell from '../../components/ModalShell'
import { formatNumber, formatUnitPrice } from '../../lib/format'
import { confirmTrade, previewTrade } from './tradeData'

const inputClass = 'min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]'

export default function TradeEntryModal({ accounts, instrument, onClose, onSaved, supabase }) {
  const [draft, setDraft] = useState({ accountId: String(accounts[0]?.id ?? ''), side: 'buy', quantity: '', unitPrice: '', executedOn: new Date().toISOString().slice(0, 10) })
  const [preview, setPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function handlePreview() {
    setSaving(true); setError('')
    try { setPreview(await previewTrade(supabase, { ...draft, instrumentId: instrument.id })) }
    catch (nextError) { setError(nextError.message) }
    finally { setSaving(false) }
  }
  async function handleConfirm() {
    setSaving(true); setError('')
    try { await confirmTrade(supabase, preview.preview_id, crypto.randomUUID()); await onSaved(); onClose() }
    catch (nextError) { setError(nextError.message); setPreview(null) }
    finally { setSaving(false) }
  }
  const field = (key, label, props = {}) => <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">{label}</span><input className={inputClass} onChange={(event) => { setDraft({ ...draft, [key]: event.target.value }); setPreview(null) }} value={draft[key]} {...props} /></label>
  return <ModalShell onClose={onClose} title={`${instrument.display_name} 매매 기록`}><div className="grid gap-4">
    <p className="text-sm leading-6 text-[var(--muted-ink)]">이미 체결된 매매만 기록합니다. 증권사 주문이나 현금 이동은 실행하지 않습니다.</p>
    <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">계좌</span><select className={inputClass} onChange={(event) => { setDraft({ ...draft, accountId: event.target.value }); setPreview(null) }} value={draft.accountId}>{accounts.map((account) => <option key={account.id} value={String(account.id)}>{account.name}</option>)}</select></label>
    <div className="grid grid-cols-2 gap-3"><button className={`rounded-xl border px-3 py-2 text-sm ${draft.side === 'buy' ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)]'}`} onClick={() => { setDraft({ ...draft, side: 'buy' }); setPreview(null) }} type="button">매수</button><button className={`rounded-xl border px-3 py-2 text-sm ${draft.side === 'sell' ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)]'}`} onClick={() => { setDraft({ ...draft, side: 'sell' }); setPreview(null) }} type="button">매도</button></div>
    <div className="grid gap-4 sm:grid-cols-2">{field('quantity', '체결 수량', { inputMode: 'decimal', placeholder: '10' })}{field('unitPrice', `체결 단가 (${instrument.currency})`, { inputMode: 'decimal', placeholder: '70000' })}{field('executedOn', '체결일', { type: 'date' })}</div>
    {preview && <section className="rounded-2xl bg-[var(--surface-2)] p-4"><p className="text-xs font-semibold text-[var(--muted-ink)]">저장 후 예상</p><div className="mt-2 grid grid-cols-2 gap-3 text-sm"><div><span className="text-[var(--muted-ink)]">수량</span><p className="mt-1 font-semibold">{formatNumber(Number(preview.before.quantity))} → {formatNumber(Number(preview.after.quantity))}</p></div><div><span className="text-[var(--muted-ink)]">평균가</span><p className="mt-1 font-semibold">{preview.before.avg_price == null ? '-' : formatUnitPrice(Number(preview.before.avg_price), instrument.currency)} → {preview.after.avg_price == null ? '-' : formatUnitPrice(Number(preview.after.avg_price), instrument.currency)}</p></div></div></section>}
    {error && <p className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">{error}</p>}
    <div className="flex justify-end gap-2"><button className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm" onClick={onClose} type="button">취소</button>{preview ? <button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={saving} onClick={handleConfirm} type="button">{saving ? '저장 중' : '체결 기록 확정'}</button> : <button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={saving || !draft.accountId || !draft.quantity || !draft.unitPrice || !draft.executedOn} onClick={handlePreview} type="button">{saving ? '계산 중' : '변경 미리보기'}</button>}</div>
  </div></ModalShell>
}
