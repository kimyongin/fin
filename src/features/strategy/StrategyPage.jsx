import { useEffect, useMemo, useState } from 'react'

import AssetViewToolbar from '../assets/AssetViewToolbar'
import PrincipleJournal from './PrincipleJournal'
import { createEmptyStrategyState, fetchStrategyState, saveAllocationTargets } from './data'
import { formatKrw, formatPercent } from '../../lib/format'
import { PagePanel } from '../../components/PageControls'

function cents(value) {
  const text = String(value ?? '').trim()
  if (!text) return 0
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return amount <= 10000 ? amount : null
}

function sameTarget(left, right) {
  const first = String(left ?? '').trim()
  const second = String(right ?? '').trim()
  if (!first || !second) return first === second
  const firstCents = cents(first)
  return firstCents !== null && firstCents === cents(second)
}

function draftFromState(state, tags) {
  const saved = new Map(state.targets.map((target) => [String(target.tag_id), String(target.target_percentage)]))
  return Object.fromEntries(tags.map((tag) => [String(tag.id), saved.get(String(tag.id)) ?? (state.configured ? '0' : '')]))
}

function expectedTargets(state) {
  return state.targets.map((target) => ({ tag_id: Number(target.tag_id), target_percentage: Number(target.target_percentage) }))
    .sort((left, right) => left.tag_id - right.tag_id)
}

function differenceLabel(current, target) {
  if (current == null || target == null) return '계산 불가'
  const difference = current - target
  if (Math.abs(difference) < 0.005) return '일치'
  return `${formatPercent(Math.abs(difference))}p ${difference > 0 ? '초과' : '부족'}`
}

function AllocationPage({ canEdit, ownerUserId = null, supabase, tagCards = [], tags = [], totalValue = 0, valuationQuality, showStrategy = true, showAssets = true, onRefreshTags, onSharedViewReady }) {
  const [state, setState] = useState(createEmptyStrategyState)
  const [draft, setDraft] = useState({})
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [targetConflict, setTargetConflict] = useState(false)
  const tagRows = useMemo(() => {
    const byId = new Map(tags.map((tag) => [String(tag.id), tag]))
    for (const target of state.targets) if (!byId.has(String(target.tag_id))) byId.set(String(target.tag_id), { id: target.tag_id, name: target.tag_name })
    return [...byId.values()].sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || Number(left.id) - Number(right.id))
  }, [state.targets, tags])
  const savedDraft = useMemo(() => draftFromState(state, tagRows), [state, tagRows])
  const dirty = tagRows.some((tag) => !sameTarget(draft[String(tag.id)] ?? savedDraft[String(tag.id)], savedDraft[String(tag.id)]))
  const amounts = tagRows.map((tag) => cents(draft[String(tag.id)] ?? savedDraft[String(tag.id)]))
  const invalid = amounts.some((amount) => amount === null)
  const totalCents = invalid ? null : amounts.reduce((sum, amount) => sum + amount, 0)
  const valueByTag = new Map(tagCards.map((card) => [String(card.id), Number(card.value) || 0]))
  const unclassified = tagCards.find((card) => card.name === 'Untagged')
  const currentAvailable = showAssets && valuationQuality?.isComplete !== false && totalValue > 0

  useEffect(() => {
    let active = true
    if (!showStrategy) { setLoading(false); return () => { active = false } }
    setLoading(true)
    setError('')
    fetchStrategyState(supabase, ownerUserId).then((next) => {
      if (!active) return
      setState(next)
      setDraft(draftFromState(next, tags))
      setTargetConflict(false)
      setLoaded(true)
      if (ownerUserId) onSharedViewReady?.(ownerUserId)
    }).catch((cause) => { if (active) setError(cause.message ?? '배분 목표를 불러오지 못했습니다.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [ownerUserId, refreshKey, showStrategy, supabase])

  useEffect(() => {
    if (!dirty) return undefined
    const warn = (event) => { event.preventDefault(); event.returnValue = '' }
    const guardTab = () => {
      if (window.location.hash === '#allocation') return
      if (!window.confirm('저장하지 않은 목표 비중을 버리고 이동할까요?')) window.location.hash = '#allocation'
    }
    window.addEventListener('beforeunload', warn)
    window.addEventListener('hashchange', guardTab)
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('hashchange', guardTab) }
  }, [dirty])

  async function save() {
    if (targetConflict) { setError('다른 곳에서 목표 비중이 변경됐습니다. 최신 목표를 불러온 뒤 다시 입력해 주세요.'); return }
    if (invalid || totalCents !== 10000) { setError('목표 비중을 0~100%, 소수점 둘째 자리까지 입력하고 합계를 100%로 맞춰 주세요.'); return }
    setSaving(true)
    setError('')
    try {
      const targets = tagRows.map((tag) => ({ tag_id: Number(tag.id), target_percentage: cents(draft[String(tag.id)] ?? savedDraft[String(tag.id)]) / 100 }))
      const next = await saveAllocationTargets(supabase, { targets, expectedTargets: expectedTargets(state) })
      setState(next)
      setDraft(draftFromState(next, tagRows))
    } catch (cause) { setError(cause.message ?? '배분 목표를 저장하지 못했습니다.') }
    finally { setSaving(false) }
  }

  async function refreshAfterTagChange() {
    const nextTags = await onRefreshTags()
    const next = await fetchStrategyState(supabase, ownerUserId)
    const before = new Map(state.targets.map((target) => [String(target.tag_id), String(target.target_percentage)]))
    const changedElsewhere = dirty && next.targets.some((target) => before.has(String(target.tag_id)) && before.get(String(target.tag_id)) !== String(target.target_percentage))
    if (changedElsewhere) {
      setTargetConflict(true)
      setError('목표 비중이 다른 곳에서 바뀌었습니다. 현재 입력은 유지했습니다. 최신 목표를 불러온 뒤 다시 입력해 주세요.')
    }
    setState(next)
    setDraft((current) => {
      if (!dirty) return draftFromState(next, nextTags)
      return Object.fromEntries(nextTags.map((tag) => [String(tag.id), current[String(tag.id)] ?? '0']))
    })
    return nextTags
  }

  const assetToolbar = <AssetViewToolbar canEdit={canEdit} onTagsChanged={refreshAfterTagChange} supabase={supabase} tags={tags} />
  if (loading) return <PagePanel title="태그별 배분" supporting="배분 목표를 불러오는 중입니다." />
  if (error && !loaded && showStrategy) return <PagePanel title="태그별 배분" supporting={<div className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100" role="alert">{error}<button className="ml-3 min-h-11 rounded-xl border border-red-400/40 px-3" onClick={() => setRefreshKey((value) => value + 1)} type="button">다시 시도</button></div>} />

  return <section className="grid gap-5">
    <PagePanel title="태그별 배분" actions={canEdit ? assetToolbar : null} status={ownerUserId ? '공유 · 읽기 전용' : null} supporting={<>
      <p>전체 계좌 · {showAssets ? `확인 가능한 평가액 ${formatKrw(totalValue)}` : '현재 자산은 공유되지 않았습니다.'}</p>
      {showAssets && valuationQuality?.isComplete === false && <p className="mt-2 text-sm text-amber-200">시세 또는 환율이 빠져 현재 비중과 차이를 정확히 계산할 수 없습니다.</p>}
      {showAssets && valuationQuality?.hasStaleValues && <p className="mt-2 text-sm text-amber-200">오래된 시세·환율이 포함되어 있습니다. 현재 비중을 참고용으로 확인해 주세요.</p>}
      {showAssets && totalValue === 0 && <p className="mt-2 text-sm text-[var(--muted-ink)]">평가액이 없어 현재 비중을 계산할 수 없습니다. 목표는 설정할 수 있습니다.</p>}
      {!showStrategy && <p className="mt-2 text-sm text-[var(--muted-ink)]">목표 비중은 공유되지 않았습니다.</p>}
    </>} />
    {error && <div className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100" role="alert">{error}{targetConflict && <button className="ml-3 min-h-11 rounded-xl border border-red-400/40 px-3" onClick={() => { setDraft(draftFromState(state, tagRows)); setTargetConflict(false); setError('') }} type="button">최신 목표 불러오기</button>}</div>}
    <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel)]" aria-label="태그별 현재 및 목표 비중">
      <div className="list-column-header type-label hidden border-b border-[var(--line)] px-3 text-[var(--muted-ink)] sm:grid sm:grid-cols-[minmax(0,1fr)_7rem_8rem_7rem] sm:gap-3 sm:px-4"><span>태그</span><span>현재</span><span>목표</span><span>차이</span></div>
      {tagRows.length === 0 && <p className="p-4 text-sm text-[var(--muted-ink)]">등록된 종목 태그가 없습니다. 자산에서 태그를 먼저 추가해 주세요.</p>}
      {tagRows.map((tag) => {
        const value = valueByTag.get(String(tag.id)) ?? 0
        const current = currentAvailable ? value / totalValue * 100 : null
        const targetText = draft[String(tag.id)] ?? savedDraft[String(tag.id)]
        const targetCents = cents(targetText)
        const target = ((showStrategy && state.configured) || canEdit) && targetCents != null ? targetCents / 100 : null
        const hasTarget = state.configured || (canEdit && Boolean(String(targetText ?? '').trim()))
        return <div className="grid min-w-0 gap-2 border-b border-[var(--line)] px-3 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_7rem] sm:items-center sm:gap-3 sm:px-4" key={tag.id}>
          <div className="min-w-0"><strong className="type-item-title block break-words">{tag.name}</strong>{showAssets && <span className="type-secondary type-number mt-1 block text-[var(--muted-ink)]">{formatKrw(value)}</span>}</div>
          <div className="type-value type-number flex items-center justify-between sm:block"><span className="type-label text-[var(--muted-ink)] sm:hidden">현재</span><span>{current == null ? '—' : formatPercent(current)}</span></div>
          <div className="type-value type-number flex items-center justify-between gap-2 sm:block"><span className="type-label text-[var(--muted-ink)] sm:hidden">목표</span>{canEdit && showStrategy ? <label className="flex items-center gap-1"><span className="sr-only">{tag.name} 목표 비중</span><input aria-label={`${tag.name} 목표 비중`} className="type-input type-number min-h-11 w-24 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 text-right" inputMode="decimal" onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, [String(tag.id)]: event.target.value }))} value={targetText ?? ''} /><span>%</span></label> : <span>{showStrategy && state.configured ? formatPercent(target) : '미설정'}</span>}</div>
          <div className="type-value type-number flex items-center justify-between sm:block"><span className="type-label text-[var(--muted-ink)] sm:hidden">차이</span><span>{hasTarget ? `${differenceLabel(current, target)}${dirty ? ' · 미리보기' : ''}` : '미설정'}</span></div>
        </div>
      })}
      {unclassified && showAssets && <div className="grid gap-2 px-3 py-4 text-sm sm:grid-cols-[minmax(0,1fr)_7rem_8rem_7rem] sm:gap-3 sm:px-4"><div><strong>미분류</strong><span className="mt-1 block text-xs text-[var(--muted-ink)]">{formatKrw(unclassified.value)} · 종목에 태그를 지정해 주세요.</span></div><span>{currentAvailable ? formatPercent(unclassified.value / totalValue * 100) : '—'}</span><span>목표 없음</span><span>—</span></div>}
    </section>
    {canEdit && showStrategy && <footer className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 sm:p-6">
      <p className={`type-value type-number ${totalCents === 10000 ? 'text-[var(--ink)]' : 'text-amber-200'}`}>목표 합계 {totalCents === null ? '입력 확인 필요' : `${(totalCents / 100).toFixed(2)}%`} / 100%</p>
      {(dirty || saving) && <div className="flex gap-2"><button className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm" disabled={saving} onClick={() => { setDraft(savedDraft); setTargetConflict(false); setError('') }} type="button">취소</button><button className="min-h-11 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white" disabled={saving || targetConflict || tagRows.length === 0 || invalid || totalCents !== 10000} onClick={save} type="button">{saving ? '저장 중…' : '저장'}</button></div>}
    </footer>}
  </section>
}

export default function StrategyPage(props) {
  if (props.section === 'principles') return <PrincipleJournal key={props.ownerUserId ?? 'owner'} canEdit={props.canEdit} onSharedViewReady={props.onSharedViewReady} ownerUserId={props.ownerUserId} supabase={props.supabase} />
  return <AllocationPage {...props} />
}
