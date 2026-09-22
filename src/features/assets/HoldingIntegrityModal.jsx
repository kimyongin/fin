import { useEffect, useRef, useState } from 'react'
import ModalShell from '../../components/ModalShell'
import { confirmReconciliation, fetchHoldingIntegrity, previewReconciliation, verifyHolding } from './integrityData'

const inputClass = 'min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]'

export default function HoldingIntegrityModal({ holding, instrument, onClose, onSaved, supabase }) {
  const type = instrument.instrument_type
  const today = new Date().toISOString().slice(0, 10)
  const initial = type === 'market' ? { quantity: String(holding.quantity ?? ''), avg_price: String(holding.avg_price ?? '') } : type === 'valuation' ? { purchase_amount: String(holding.purchase_amount ?? ''), valuation_amount: String(holding.valuation_amount ?? '') } : { valuation_amount: String(holding.valuation_amount ?? '') }
  const allowed = Object.keys(initial)
  const [values, setValues] = useState(initial)
  const [fields, setFields] = useState([])
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [attempt, setAttempt] = useState(null)
  const [committed, setCommitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [integrity, setIntegrity] = useState(null)
  const [integrityError, setIntegrityError] = useState('')
  const verificationKey = useRef(null)
  const labels = { quantity: '수량', avg_price: '평균가', purchase_amount: '매입금액', valuation_amount: type === 'cash' ? '현금 잔액' : '평가금액' }

  useEffect(() => {
    let active = true
    setIntegrityError('')
    fetchHoldingIntegrity(supabase, holding.id)
      .then((value) => { if (active) setIntegrity(value) })
      .catch((next) => { if (active) setIntegrityError(next.message) })
    return () => { active = false }
  }, [holding.id, supabase])

  function invalidateAttempt() {
    setAttempt(null)
    setCommitted(false)
    verificationKey.current = null
  }

  function toggle(field) {
    setFields((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field])
    invalidateAttempt()
  }

  async function run(action) {
    setBusy(true)
    setError('')
    try { await action() } catch (next) { setError(next.message) } finally { setBusy(false) }
  }

  async function finishSaved(message) {
    setCommitted(true)
    try {
      await onSaved()
      onClose()
    } catch (next) {
      setError(`${message} 화면을 새로 불러오지 못했습니다. 다시 불러오세요. (${next.message})`)
    }
  }

  async function handleVerify() {
    await run(async () => {
      if (!committed) {
        verificationKey.current ||= crypto.randomUUID()
        await verifyHolding(supabase, { holdingId: holding.id, expectedVersion: holding.state_version, fields, verifiedOn: date, note }, verificationKey.current)
      }
      await finishSaved('확인 기록은 저장됐지만')
    })
  }

  async function handleReconcile() {
    await run(async () => {
      if (!committed) await confirmReconciliation(supabase, attempt.preview.preview_id, attempt.idempotencyKey)
      await finishSaved('보정은 저장됐지만')
    })
  }

  return <ModalShell closeDisabled={busy && !committed} onClose={onClose} title={`${instrument.display_name} 잔고 맞추기`}><div className="grid gap-4">
    <p className="text-sm leading-6 text-[var(--muted-ink)]">값을 바꾸면 새 기준점으로 보정합니다. 값이 맞는지만 확인했다면 아래 확인 범위만 기록할 수 있습니다.</p>
    {integrity?.last_verification && <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4 text-sm" aria-label="최근 잔고 확인">
      <p className="font-semibold">최근 확인 · {integrity.last_verification.verified_on}</p>
      <p className="mt-1 text-[var(--muted-ink)]">{integrity.last_verification.verified_fields.map((field) => labels[field] ?? field).join(', ')}{integrity.last_verification.changed_since ? ' · 확인 후 값 변경됨' : ' · 확인 후 값 변경 없음'}</p>
      {integrity.last_verification.note && <p className="mt-2 whitespace-pre-wrap">{integrity.last_verification.note}</p>}
    </section>}
    {integrityError && <p className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">최근 확인 기록을 불러오지 못했습니다. {integrityError}</p>}
    <div className="grid gap-3 sm:grid-cols-2">{allowed.map((field) => <label className="grid gap-1.5" key={field}><span className="text-xs text-[var(--muted-ink)]">{labels[field]}</span><input className={inputClass} inputMode="decimal" onChange={(event) => { setValues({ ...values, [field]: event.target.value }); invalidateAttempt() }} value={values[field]}/></label>)}</div>
    <fieldset><legend className="text-xs text-[var(--muted-ink)]">증권사와 실제로 확인한 항목만 선택</legend><div className="mt-2 flex flex-wrap gap-2">{allowed.map((field) => <label className="flex items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2 text-sm" key={field}><input checked={fields.includes(field)} onChange={() => toggle(field)} type="checkbox"/>{labels[field]}</label>)}</div></fieldset>
    <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">확인·보정일</span><input className={inputClass} onChange={(event) => { setDate(event.target.value); invalidateAttempt() }} type="date" value={date}/></label>
    <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">보정 이유</span><input className={inputClass} onChange={(event) => { setReason(event.target.value); invalidateAttempt() }} placeholder="값을 바꾸는 이유" value={reason}/></label>
    <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">확인 메모</span><input className={inputClass} onChange={(event) => { setNote(event.target.value); verificationKey.current = null; setCommitted(false) }} placeholder="선택 사항" value={note}/></label>
    {attempt?.preview && <div className="rounded-2xl bg-[var(--surface-2)] p-4 text-sm"><p className="font-semibold">보정 미리보기</p>{allowed.map((field) => <p className="mt-2" key={field}>{labels[field]}: {attempt.preview.before[field] ?? '-'} → {attempt.preview.after[field] ?? '-'}</p>)}</div>}
    {committed && <p className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">기록은 저장되었습니다.</p>}
    {error && <p className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2"><button className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm disabled:opacity-50" disabled={busy && !committed} onClick={onClose} type="button">취소</button>{fields.length > 0 && !attempt && <button className="rounded-xl border border-[var(--accent)] px-4 py-2 text-sm disabled:opacity-50" disabled={busy} onClick={handleVerify} type="button">{committed ? '새로고침 다시 시도' : '값 변경 없이 확인 기록'}</button>}{attempt ? <button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={handleReconcile} type="button">{committed ? '새로고침 다시 시도' : '보정 확정'}</button> : <button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || !reason.trim() || allowed.some((field) => values[field] === '')} onClick={() => run(async () => { const preview = await previewReconciliation(supabase, { holdingId: holding.id, values, reason, effectiveOn: date, confirmedFields: fields }); setAttempt({ preview, idempotencyKey: crypto.randomUUID() }); setCommitted(false) })} type="button">보정 미리보기</button>}</div>
  </div></ModalShell>
}
