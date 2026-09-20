import { useEffect, useState } from 'react'
import ModalShell from '../../components/ModalShell'
import { formatNumber, formatUnitPrice } from '../../lib/format'
import { confirmTrade, confirmTradeReversal, listTransactions, previewTrade, previewTradeReversal } from './tradeData'

const inputClass = 'min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]'

export default function TradeEntryModal({ accounts, instrument, onClose, onSaved, supabase }) {
  const [draft, setDraft] = useState({ accountId: String(accounts[0]?.id ?? ''), side: 'buy', quantity: '', unitPrice: '', executedOn: new Date().toISOString().slice(0, 10) })
  const [preview, setPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [transactions,setTransactions]=useState([])
  const [reversal,setReversal]=useState(null)
  useEffect(()=>{listTransactions(supabase).then((items)=>setTransactions(items.filter((item)=>Number(item.instrument_id)===Number(instrument.id)))).catch((next)=>setError(next.message))},[instrument.id,supabase])
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
  async function runReversal(action) { setSaving(true); setError(''); try { await action() } catch (nextError) { setError(nextError.message) } finally { setSaving(false) } }
  const field = (key, label, props = {}) => <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">{label}</span><input className={inputClass} onChange={(event) => { setDraft({ ...draft, [key]: event.target.value }); setPreview(null) }} value={draft[key]} {...props} /></label>
  return <ModalShell onClose={onClose} title={`${instrument.display_name} 매매 기록`}><div className="grid gap-4">
    <p className="text-sm leading-6 text-[var(--muted-ink)]">이미 체결된 매매만 기록합니다. 증권사 주문이나 현금 이동은 실행하지 않습니다.</p>
    <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">계좌</span><select className={inputClass} onChange={(event) => { setDraft({ ...draft, accountId: event.target.value }); setPreview(null) }} value={draft.accountId}>{accounts.map((account) => <option key={account.id} value={String(account.id)}>{account.name}</option>)}</select></label>
    <div className="grid grid-cols-2 gap-3"><button className={`rounded-xl border px-3 py-2 text-sm ${draft.side === 'buy' ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)]'}`} onClick={() => { setDraft({ ...draft, side: 'buy' }); setPreview(null) }} type="button">매수</button><button className={`rounded-xl border px-3 py-2 text-sm ${draft.side === 'sell' ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)]'}`} onClick={() => { setDraft({ ...draft, side: 'sell' }); setPreview(null) }} type="button">매도</button></div>
    <div className="grid gap-4 sm:grid-cols-2">{field('quantity', '체결 수량', { inputMode: 'decimal', placeholder: '10' })}{field('unitPrice', `체결 단가 (${instrument.currency})`, { inputMode: 'decimal', placeholder: '70000' })}{field('executedOn', '체결일', { type: 'date' })}</div>
    {preview && <section className="rounded-2xl bg-[var(--surface-2)] p-4"><p className="text-xs font-semibold text-[var(--muted-ink)]">저장 후 예상</p><div className="mt-2 grid grid-cols-2 gap-3 text-sm"><div><span className="text-[var(--muted-ink)]">수량</span><p className="mt-1 font-semibold">{formatNumber(Number(preview.before.quantity))} → {formatNumber(Number(preview.after.quantity))}</p></div><div><span className="text-[var(--muted-ink)]">평균가</span><p className="mt-1 font-semibold">{preview.before.avg_price == null ? '-' : formatUnitPrice(Number(preview.before.avg_price), instrument.currency)} → {preview.after.avg_price == null ? '-' : formatUnitPrice(Number(preview.after.avg_price), instrument.currency)}</p></div></div></section>}
    {error && <p className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">{error}</p>}
    <div className="flex justify-end gap-2"><button className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm" onClick={onClose} type="button">취소</button>{preview ? <button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={saving} onClick={handleConfirm} type="button">{saving ? '저장 중' : '체결 기록 확정'}</button> : <button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={saving || !draft.accountId || !draft.quantity || !draft.unitPrice || !draft.executedOn} onClick={handlePreview} type="button">{saving ? '계산 중' : '변경 미리보기'}</button>}</div>
    {transactions.length>0&&<section className="border-t border-[var(--line)] pt-4"><h3 className="text-sm font-semibold">최근 기록</h3><div className="mt-2 grid gap-2">{transactions.map((trade)=><div className="rounded-xl bg-[var(--surface-2)] p-3 text-sm" key={trade.id}><div className="flex items-center justify-between gap-3"><span>{trade.executed_on} · {trade.side==='buy'?'매수':'매도'} {formatNumber(Number(trade.quantity))}주</span>{trade.reversed_at?<span className="text-[var(--muted-ink)]">취소됨</span>:<button className="text-red-300" onClick={()=>setReversal({trade,reason:'',preview:null})} type="button">기록 취소</button>}</div>{reversal?.trade.id===trade.id&&<div className="mt-3 grid gap-2"><input className={inputClass} onChange={(e)=>setReversal({...reversal,reason:e.target.value,preview:null})} placeholder="취소 이유" value={reversal.reason}/>{reversal.preview?<><p className="text-xs text-[var(--muted-ink)]">{reversal.preview.affects_current?'현재 잔고를 다시 계산합니다.':'이후 보정값이 있어 현재 잔고는 유지합니다.'}</p><button className="rounded-xl bg-red-500/80 px-3 py-2" onClick={()=>runReversal(async()=>{await confirmTradeReversal(supabase,reversal.preview.preview_id);await onSaved();setTransactions((await listTransactions(supabase)).filter((item)=>Number(item.instrument_id)===Number(instrument.id)));setReversal(null)})} type="button">거래 기록 취소 확정</button></>:<button className="rounded-xl border border-[var(--line)] px-3 py-2" disabled={!reversal.reason.trim()} onClick={()=>runReversal(async()=>setReversal({...reversal,preview:await previewTradeReversal(supabase,trade.id,reversal.reason)}))} type="button">취소 영향 미리보기</button>}</div>}</div>)}</div></section>}
  </div></ModalShell>
}
