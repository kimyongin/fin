import { useState } from 'react'
import ModalShell from '../../components/ModalShell'
import { confirmReconciliation, previewReconciliation, verifyHolding } from './integrityData'

const inputClass='min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]'
export default function HoldingIntegrityModal({ holding, instrument, onClose, onSaved, supabase }) {
  const type=instrument.instrument_type
  const today=new Date().toISOString().slice(0,10)
  const initial=type==='market'?{quantity:String(holding.quantity??''),avg_price:String(holding.avg_price??'')} : type==='valuation'?{purchase_amount:String(holding.purchase_amount??''),valuation_amount:String(holding.valuation_amount??'')}:{valuation_amount:String(holding.valuation_amount??'')}
  const allowed=Object.keys(initial)
  const [values,setValues]=useState(initial),[fields,setFields]=useState([]),[reason,setReason]=useState(''),[date,setDate]=useState(today),[note,setNote]=useState(''),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const labels={quantity:'수량',avg_price:'평균가',purchase_amount:'매입금액',valuation_amount:type==='cash'?'현금 잔액':'평가금액'}
  const toggle=(field)=>setFields(fields.includes(field)?fields.filter((item)=>item!==field):[...fields,field])
  async function run(action){setBusy(true);setError('');try{await action()}catch(next){setError(next.message)}finally{setBusy(false)}}
  return <ModalShell onClose={onClose} title={`${instrument.display_name} 잔고 맞추기`}><div className="grid gap-4">
    <p className="text-sm leading-6 text-[var(--muted-ink)]">값을 바꾸면 새 기준점으로 보정합니다. 값이 맞는지만 확인했다면 아래 확인 범위만 기록할 수 있습니다.</p>
    <div className="grid gap-3 sm:grid-cols-2">{allowed.map((field)=><label className="grid gap-1.5" key={field}><span className="text-xs text-[var(--muted-ink)]">{labels[field]}</span><input className={inputClass} inputMode="decimal" onChange={(event)=>{setValues({...values,[field]:event.target.value});setPreview(null)}} value={values[field]}/></label>)}</div>
    <fieldset><legend className="text-xs text-[var(--muted-ink)]">증권사와 실제로 확인한 항목만 선택</legend><div className="mt-2 flex flex-wrap gap-2">{allowed.map((field)=><label className="flex items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2 text-sm" key={field}><input checked={fields.includes(field)} onChange={()=>toggle(field)} type="checkbox"/>{labels[field]}</label>)}</div></fieldset>
    <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">확인·보정일</span><input className={inputClass} onChange={(e)=>{setDate(e.target.value);setPreview(null)}} type="date" value={date}/></label>
    <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">보정 이유</span><input className={inputClass} onChange={(e)=>{setReason(e.target.value);setPreview(null)}} placeholder="값을 바꾸는 이유" value={reason}/></label>
    <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">확인 메모</span><input className={inputClass} onChange={(e)=>setNote(e.target.value)} placeholder="선택 사항" value={note}/></label>
    {preview&&<div className="rounded-2xl bg-[var(--surface-2)] p-4 text-sm"><p className="font-semibold">보정 미리보기</p>{allowed.map((field)=><p className="mt-2" key={field}>{labels[field]}: {preview.before[field]??'-'} → {preview.after[field]??'-'}</p>)}</div>}
    {error&&<p className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2"><button className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm" onClick={onClose} type="button">취소</button>{fields.length>0&&!preview&&<button className="rounded-xl border border-[var(--accent)] px-4 py-2 text-sm" disabled={busy} onClick={()=>run(async()=>{await verifyHolding(supabase,{holdingId:holding.id,expectedVersion:holding.state_version,fields,verifiedOn:date,note});await onSaved();onClose()})} type="button">값 변경 없이 확인 기록</button>}{preview?<button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" disabled={busy} onClick={()=>run(async()=>{await confirmReconciliation(supabase,preview.preview_id);await onSaved();onClose()})} type="button">보정 확정</button>:<button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy||!reason.trim()||allowed.some((field)=>values[field]==='')} onClick={()=>run(async()=>setPreview(await previewReconciliation(supabase,{holdingId:holding.id,values,reason,effectiveOn:date,confirmedFields:fields})))} type="button">보정 미리보기</button>}</div>
  </div></ModalShell>
}
