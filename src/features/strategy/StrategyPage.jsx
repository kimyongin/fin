import { useEffect, useMemo, useState } from 'react'
import { formatKrw, formatPercent } from '../../lib/format'
import { createEmptyStrategyState, fetchStrategyState, saveStrategy } from './data'

function createDraft(strategyState) {
  const strategy = strategyState.strategy
  return {
    name: strategy?.name ?? '나의 전략',
    monthly_contribution: strategy?.monthly_contribution ?? 3000000,
    review_day: strategy?.review_day ?? 1,
    drift_threshold: strategy?.drift_threshold ?? 5,
    buckets: strategyState.buckets.map((bucket) => ({
      id: bucket.id,
      name: bucket.name,
      target_percentage: Number(bucket.target_percentage),
      tag_ids: bucket.tag_ids.map(String),
    })),
  }
}

function newBucket() {
  return { id: crypto.randomUUID(), name: '', target_percentage: 0, tag_ids: [] }
}

function emptyDraft() {
  return { name: '나의 전략', monthly_contribution: 3000000, review_day: 1, drift_threshold: 5, buckets: [newBucket()] }
}

function BucketEditor({ bucket, index, onChange, onRemove, selectedTagIds, tags }) {
  return (
    <article className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
        <label className="grid gap-1.5"><span className="text-xs font-medium text-[var(--muted-ink)]">버킷 이름</span><input className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]" onChange={(event) => onChange({ ...bucket, name: event.target.value })} value={bucket.name} /></label>
        <label className="grid gap-1.5"><span className="text-xs font-medium text-[var(--muted-ink)]">목표 비중</span><div className="flex items-center gap-2"><input className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]" min="0" max="100" onChange={(event) => onChange({ ...bucket, target_percentage: event.target.value })} step="0.1" type="number" value={bucket.target_percentage} /><span className="text-sm text-[var(--muted-ink)]">%</span></div></label>
        <button className="rounded-lg px-3 py-2 text-sm text-[var(--muted-ink)] transition hover:bg-[var(--surface-3)] hover:text-red-300" onClick={onRemove} type="button">삭제</button>
      </div>
      <fieldset className="mt-4"><legend className="text-xs font-medium text-[var(--muted-ink)]">연결 태그</legend><div className="mt-2 flex flex-wrap gap-2">{tags.map((tag) => {
        const tagId = String(tag.id)
        const selected = bucket.tag_ids.includes(tagId)
        const unavailable = !selected && selectedTagIds.has(tagId)
        return <label className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm ${selected ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]' : 'border-[var(--line)] text-[var(--muted-ink)]'} ${unavailable ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`} key={tag.id}><input checked={selected} disabled={unavailable} onChange={() => onChange({ ...bucket, tag_ids: selected ? bucket.tag_ids.filter((id) => id !== tagId) : [...bucket.tag_ids, tagId] })} type="checkbox" />{tag.name}</label>
      })}</div></fieldset>
    </article>
  )
}

function StrategyEditor({ draft, error, onCancel, onChange, onSave, saving, tags }) {
  const targetTotal = draft.buckets.reduce((sum, bucket) => sum + (Number(bucket.target_percentage) || 0), 0)
  const canSave = draft.name.trim() && draft.buckets.length > 0 && Math.abs(targetTotal - 100) < 0.01 && !saving

  return (
    <section className="grid gap-5">
      <article className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">전략 편집</h2><p className="mt-1 text-sm text-[var(--muted-ink)]">기존 태그를 전략 버킷에 연결해 목표 비중을 관리합니다.</p></div><button className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)]" onClick={onCancel} type="button">취소</button></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5"><span className="text-xs font-medium text-[var(--muted-ink)]">전략 이름</span><input className="rounded-lg border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]" onChange={(event) => onChange({ ...draft, name: event.target.value })} value={draft.name} /></label><label className="grid gap-1.5"><span className="text-xs font-medium text-[var(--muted-ink)]">월 적립금</span><input className="rounded-lg border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]" min="0" onChange={(event) => onChange({ ...draft, monthly_contribution: event.target.value })} type="number" value={draft.monthly_contribution} /></label><label className="grid gap-1.5"><span className="text-xs font-medium text-[var(--muted-ink)]">매월 점검일</span><input className="rounded-lg border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]" min="1" max="28" onChange={(event) => onChange({ ...draft, review_day: event.target.value })} type="number" value={draft.review_day} /></label><label className="grid gap-1.5"><span className="text-xs font-medium text-[var(--muted-ink)]">허용 이탈 폭</span><div className="flex items-center gap-2"><input className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]" min="0.1" max="100" onChange={(event) => onChange({ ...draft, drift_threshold: event.target.value })} step="0.1" type="number" value={draft.drift_threshold} /><span className="text-sm text-[var(--muted-ink)]">%p</span></div></label></div>
      </article>
      <section className="grid gap-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">전략 버킷</h2><p className={`mt-1 text-sm ${Math.abs(targetTotal - 100) < 0.01 ? 'text-emerald-300' : 'text-amber-300'}`}>목표 비중 합계 {formatPercent(targetTotal)} / 100%</p></div><button className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)]" onClick={() => onChange({ ...draft, buckets: [...draft.buckets, newBucket()] })} type="button">버킷 추가</button></div>{draft.buckets.map((bucket, index) => { const selectedTagIds = new Set(draft.buckets.filter((_, bucketIndex) => bucketIndex !== index).flatMap((item) => item.tag_ids)); return <BucketEditor bucket={bucket} index={index} key={bucket.id ?? index} onChange={(nextBucket) => onChange({ ...draft, buckets: draft.buckets.map((item, bucketIndex) => bucketIndex === index ? nextBucket : item) })} onRemove={() => onChange({ ...draft, buckets: draft.buckets.filter((_, bucketIndex) => bucketIndex !== index) })} selectedTagIds={selectedTagIds} tags={tags} /> })}</section>
      {error && <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</p>}
      <div className="flex justify-end"><button className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={!canSave} onClick={onSave} type="button">{saving ? '저장 중' : '전략 저장'}</button></div>
    </section>
  )
}

function StrategyDashboard({ canEdit, onEdit, strategyState, tagCards, totalValue }) {
  const { strategy, buckets } = strategyState
  const tagValueById = useMemo(() => new Map(tagCards.map((tag) => [String(tag.id), tag.value])), [tagCards])
  const rows = useMemo(() => buckets.map((bucket) => {
    const value = bucket.tag_ids.reduce((sum, id) => sum + (tagValueById.get(String(id)) ?? 0), 0)
    const currentPercentage = totalValue > 0 ? (value / totalValue) * 100 : 0
    const targetPercentage = Number(bucket.target_percentage)
    return { ...bucket, value, targetPercentage, currentPercentage, differencePercentage: targetPercentage - currentPercentage, differenceValue: totalValue * (targetPercentage / 100) - value }
  }), [buckets, tagValueById, totalValue])
  const deficits = rows.filter((row) => row.differenceValue > 0)
  const deficitTotal = deficits.reduce((sum, row) => sum + row.differenceValue, 0)
  const contribution = Number(strategy.monthly_contribution) || 0
  const needsRebalance = rows.some((row) => Math.abs(row.differencePercentage) >= Number(strategy.drift_threshold))
  const connectedCurrentPercentage = rows.reduce((sum, row) => sum + row.currentPercentage, 0)
  const unassignedCurrentPercentage = Math.max(0, 100 - connectedCurrentPercentage)

  return (
    <section className="grid gap-5">
      <article className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{strategy.name}</h2><span className={`rounded-full border px-2 py-0.5 text-xs ${needsRebalance ? 'border-amber-400/40 text-amber-300' : 'border-emerald-400/40 text-emerald-300'}`}>{needsRebalance ? '리밸런싱 필요' : '목표 범위 유지'}</span></div><p className="mt-2 text-sm text-[var(--muted-ink)]">매월 {strategy.review_day}일 점검 · 허용 이탈 폭 ±{formatPercent(Number(strategy.drift_threshold))}p · 월 적립금 {formatKrw(contribution)}</p></div>{canEdit && <button className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)]" onClick={onEdit} type="button">전략 편집</button>}</div></article>
      <article className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-soft)]">
        <div className="border-b border-[var(--line)] px-5 py-4"><h2 className="text-lg font-semibold">목표 대비 현재 비중</h2></div>
        <div className="px-5 py-5">
          <div className="grid min-w-0 divide-y divide-[var(--line)]">
            <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-3 pb-3 text-xs font-medium text-[var(--muted-ink)]"><span>버킷</span><span className="text-right">목표</span><span className="text-right">현재</span></div>
            {rows.map((row) => (
              <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-x-3 gap-y-1 py-3 text-sm last:pb-0" key={row.id}>
                <div className="min-w-0"><span className="truncate font-semibold">{row.name}</span></div>
                <span className="text-right text-[var(--muted-ink)]">{formatPercent(row.targetPercentage)}</span>
                <span className="text-right">{formatPercent(row.currentPercentage)}</span>
                <span className="col-span-3 text-xs text-[var(--muted-ink)]">{formatKrw(row.value)} · <span className={row.differencePercentage < 0 ? 'text-emerald-300' : row.differencePercentage > 0 ? 'text-amber-300' : ''}>{row.differencePercentage > 0 ? '부족 ' : row.differencePercentage < 0 ? '초과 ' : ''}{formatPercent(Math.abs(row.differencePercentage))}p</span></span>
              </div>
            ))}
            {unassignedCurrentPercentage > 0.01 && <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-x-3 gap-y-1 py-3 text-sm last:pb-0"><div className="min-w-0"><span className="truncate font-semibold">연결되지 않은 태그</span></div><span className="text-right text-[var(--muted-ink)]">-</span><span className="text-right">{formatPercent(unassignedCurrentPercentage)}</span><span className="col-span-3 text-xs text-[var(--muted-ink)]">전략 버킷에 아직 연결하지 않은 자산</span></div>}
          </div>
        </div>
      </article>
      <div className="grid gap-5 lg:grid-cols-2"><article className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]"><h2 className="text-lg font-semibold">이번 달 적립금 배분</h2><p className="mt-1 text-sm text-[var(--muted-ink)]">부족한 버킷의 목표 금액 차이에 비례해 배분합니다.</p><div className="mt-4 grid gap-2">{deficits.length === 0 ? <p className="text-sm text-[var(--muted-ink)]">부족한 버킷이 없습니다.</p> : deficits.map((row) => <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] pt-2" key={row.id}><span className="text-sm">{row.name}</span><span className="text-sm font-semibold">{formatKrw(contribution * (row.differenceValue / deficitTotal))}</span></div>)}</div></article><article className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]"><h2 className="text-lg font-semibold">리밸런싱 제안</h2>{needsRebalance ? <div className="mt-4 grid gap-2">{rows.filter((row) => Math.abs(row.differencePercentage) >= Number(strategy.drift_threshold)).map((row) => <p className="border-t border-[var(--line)] pt-2 text-sm" key={row.id}>{row.differencePercentage < 0 ? `${row.name} ${formatKrw(Math.abs(row.differenceValue))} 매도 후보` : `${row.name} ${formatKrw(Math.abs(row.differenceValue))} 매수 후보`}</p>)}</div> : <p className="mt-3 text-sm leading-6 text-[var(--muted-ink)]">모든 버킷이 허용 이탈 폭 안에 있습니다. 신규 적립금 배분만으로 목표 비중에 가까워집니다.</p>}</article></div>
    </section>
  )
}

export default function StrategyPage({ canEdit, ownerUserId = null, supabase, tagCards, tags, totalValue }) {
  const [strategyState, setStrategyState] = useState(createEmptyStrategyState())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(emptyDraft())
  const [saving, setSaving] = useState(false)

  useEffect(() => { let active = true; setLoading(true); setError(''); fetchStrategyState(supabase, ownerUserId).then((nextState) => { if (!active) return; setStrategyState(nextState); setDraft(nextState.strategy ? createDraft(nextState) : emptyDraft()); setEditing(!nextState.strategy && canEdit) }).catch((nextError) => { if (active) setError(nextError.message ?? '전략을 불러오지 못했습니다.') }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [canEdit, ownerUserId, supabase])

  async function handleSave() { setSaving(true); setError(''); try { const nextState = await saveStrategy(supabase, draft); setStrategyState(nextState); setDraft(createDraft(nextState)); setEditing(false) } catch (saveError) { setError(saveError.message ?? '전략을 저장하지 못했습니다.') } finally { setSaving(false) } }

  if (loading) return <p className="mt-8 text-sm text-[var(--muted-ink)]">전략을 불러오는 중입니다.</p>
  if (!strategyState.strategy && !canEdit) return <p className="mt-8 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm text-[var(--muted-ink)]">공유된 전략이 아직 없습니다.</p>
  if (editing) return <div className="mt-8"><StrategyEditor draft={draft} error={error} onCancel={() => { setDraft(strategyState.strategy ? createDraft(strategyState) : emptyDraft()); setEditing(false); setError('') }} onChange={setDraft} onSave={handleSave} saving={saving} tags={tags} /></div>
  if (!strategyState.strategy) return <div className="mt-8 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]"><h2 className="text-lg font-semibold">아직 전략이 없습니다.</h2><p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">기존 태그를 전략 버킷에 연결하고 목표 비중을 설정하면 리밸런싱 제안을 확인할 수 있습니다.</p><button className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white" onClick={() => setEditing(true)} type="button">전략 만들기</button></div>
  return <div className="mt-8"><StrategyDashboard canEdit={canEdit} onEdit={() => { setDraft(createDraft(strategyState)); setEditing(true) }} strategyState={strategyState} tagCards={tagCards} totalValue={totalValue} /></div>
}
