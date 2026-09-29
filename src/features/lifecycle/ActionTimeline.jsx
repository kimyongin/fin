import { useEffect, useRef, useState } from 'react'

import ActivityEventViewer from '../activity/ActivityEventViewer'
import { PagePanel, pagePanelActionClass } from '../../components/PageControls'
import { createRequestGate } from '../../lib/requestGate'
import { fetchActionTimeline, searchActivities } from './data'
import { TimelineDayCard } from '../../components/Timeline'
import TagChip from '../../components/TagChip'
import CalendarDateField from '../../components/CalendarDateField'
import { businessDate } from '../../lib/businessDate'
import { scheduleSummary } from './TaskScheduleFields'
import GeneralTaskListActions from './GeneralTaskListActions'
import { ListItemActions } from '../../components/ListItemAction'
import { markdownPreview } from '../../lib/markdownPreview'

function statusLabel(task) {
  const state = task.status === 'not_scheduled' ? '예정' : task.status === 'done' ? '이번 완료됨' : ''
  return `${scheduleSummary(task)}${state ? ` · ${state}` : ''}`
}

function SearchExplanation({ page }) {
  if (page.searchMode === 'browse') return null
  const hybrid = page.searchMode === 'hybrid'
  const mode = hybrid ? `단어 포함 검색 + 유사도 검색 · ${page.embeddingModel}` : '단어 포함 검색만 사용'
  const reason = {
    embedding_timeout: '유사도 검색 응답 시간 초과',
    embedding_unavailable: '유사도 검색을 사용할 수 없음',
    search_service_unavailable: '검색 서비스에 연결하지 못함',
  }[page.fallbackReason]
  const hasSemanticHit = page.items.some((item) => item.matched_by?.includes('semantic'))
  return <div className="mt-1 grid gap-1 type-secondary text-[var(--muted-ink)]">
    <p>{mode}{reason ? ` · ${reason}` : ''}</p>
    {page.indexStatus === 'partial' && <p>일부 자료가 색인 대기 중이며, 해당 자료에는 단어 포함 검색만 적용됩니다.</p>}
    {page.indexStatus === 'unknown' && hybrid && <p>색인 준비 상태를 확인하지 못했습니다.</p>}
    {hybrid && page.items.length > 0 && page.items.every((item) => Array.isArray(item.matched_by)) && !hasSemanticHit && <p>현재 표시된 결과는 모두 단어 일치로 찾았습니다.</p>}
    {hybrid && <p>유사도는 정확도나 확률이 아닌 비교 점수입니다. 검색 기준: {page.semanticThreshold ?? '확인 불가'} · 관련 자료가 누락될 수 있으니 원문을 확인하세요.</p>}
  </div>
}

function SearchEvidence({ item, threshold }) {
  const matches = item.matched_by || []
  if (matches.length === 0) return null
  const keyword = matches.includes('keyword')
  const semantic = matches.includes('semantic')
  const label = keyword && semantic ? '단어·유사도 일치' : semantic ? '유사도 일치' : '단어 일치'
  const score = typeof item.semantic_score === 'number' && Number.isFinite(item.semantic_score)
    ? ` · 유사도 ${item.semantic_score.toFixed(3)}${!semantic && typeof threshold === 'number' ? ' (기준 미달)' : ''}` : ''
  return <span className="type-meta mt-2 block tabular-nums text-[var(--muted-ink)]">{label}{score}</span>
}

const emptySearch = () => {
  const to = businessDate()
  const from = businessDate(Date.parse(`${to}T12:00:00+09:00`) - 29 * 86400000)
  return { query: '', from, to, tagIds: [], tagMatch: 'any', periodExplicit: false }
}

function appendTimelinePage(current, next) {
  const days = current.days.map((day) => ({ ...day, items: [...day.items] }))
  for (const day of next.days) {
    const existing = days.find((item) => item.date === day.date)
    if (!existing) { days.push(day); continue }
    const ids = new Set(existing.items.map((item) => item.id))
    existing.items.push(...day.items.filter((item) => !ids.has(item.id)))
  }
  return { pending: current.pending, days, nextCursor: next.nextCursor }
}

export default function ActionTimeline({ availableTags = [], canManageTags = true, onAdd, onCompleteGeneralTask, onManageTags, onOpenActivity, onOpenTask, onStopGeneralTask, onSharedViewReady, ownerUserId, refreshKey = 0, supabase }) {
  const [page, setPage] = useState({ pending: [], days: [], nextCursor: null })
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [retryMore, setRetryMore] = useState(false)
  const [collapsedDays, setCollapsedDays] = useState(new Set())
  const [searchDraft, setSearchDraft] = useState(emptySearch)
  const [timelineRange, setTimelineRange] = useState(emptySearch)
  const [searchApplied, setSearchApplied] = useState(null)
  const dateInvalid = Boolean(searchDraft.from && searchDraft.to && searchDraft.from > searchDraft.to)
  const [searchPage, setSearchPage] = useState({ items: [], nextCursor: null, searchMode: 'browse' })
  const requestGate = useRef(createRequestGate())
  const previousTagIds = useRef(new Set())
  const latestDraft = useRef(searchDraft)
  latestDraft.current = searchDraft

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = latestDraft.current
      if (next.from && next.to && next.from > next.to) return
      const query = next.query.trim()
      if (query) setSearchApplied({ ...next, query })
    }, 450)
    return () => clearTimeout(timer)
  }, [searchDraft.query])

  useEffect(() => {
    const nextIds = new Set(availableTags.map((tag) => tag.id))
    const removed = new Set([...previousTagIds.current].filter((id) => !nextIds.has(id)))
    previousTagIds.current = nextIds
    if (removed.size === 0) return
    setSearchDraft((current) => ({ ...current, tagIds: current.tagIds.filter((id) => !removed.has(id)) }))
    setSearchApplied((current) => {
      if (!current) return null
      const tagIds = current.tagIds.filter((id) => !removed.has(id))
      return current.query || tagIds.length ? { ...current, tagIds } : null
    })
  }, [availableTags])

  async function load({ append = false, cursor = null } = {}) {
    const request = requestGate.current.begin()
    append ? setLoadingMore(true) : setLoading(true)
    setError('')
    try {
      const next = await fetchActionTimeline(supabase, { cursor, ownerUserId, from: timelineRange.from || null, to: timelineRange.to || null })
      if (!request.isCurrent()) return
      setPage((current) => append ? appendTimelinePage(current, next) : next)
      setRetryMore(false)
      if (!append && ownerUserId) onSharedViewReady?.(ownerUserId)
    } catch (nextError) {
      if (request.isCurrent()) { setRetryMore(append); setError(nextError.message ?? '활동 목록을 불러오지 못했습니다.') }
    } finally {
      if (request.isCurrent()) { setLoading(false); setLoadingMore(false) }
    }
  }

  async function runSearch({ append = false, cursor = null, values = searchDraft } = {}) {
    const request = requestGate.current.begin()
    setError('')
    append ? setLoadingMore(true) : setLoading(true)
    try {
      const next = await searchActivities(supabase, {
        ...values,
        cursor,
        ownerUserId,
        state: 'all',
      })
      if (!request.isCurrent()) return
      setSearchPage((current) => append ? { ...next, items: [...current.items, ...next.items], fallbackReason: current.fallbackReason ?? next.fallbackReason } : next)
      setRetryMore(false)
      if (!append && ownerUserId) onSharedViewReady?.(ownerUserId)
    } catch (nextError) {
      if (request.isCurrent()) { setRetryMore(append); setError(nextError.message ?? '활동을 검색하지 못했습니다.') }
    } finally {
      if (request.isCurrent()) { setLoading(false); setLoadingMore(false) }
    }
  }

  useEffect(() => {
    if (searchApplied) runSearch({ values: searchApplied })
    else load()
    return () => requestGate.current.invalidate()
  }, [ownerUserId, refreshKey, searchApplied, supabase, timelineRange.from, timelineRange.to])

  function applyFilters(next, { explicitPeriod = false } = {}) {
    const periodExplicit = explicitPeriod || searchDraft.periodExplicit || next.from !== searchDraft.from || next.to !== searchDraft.to
    const selected = { ...next, periodExplicit }
    if (!periodExplicit && (next.query.trim() || next.tagIds.length)) {
      selected.from = ''
      selected.to = ''
    } else if (!periodExplicit) {
      const defaults = emptySearch()
      selected.from = defaults.from
      selected.to = defaults.to
    }
    setSearchDraft(selected)
    if (selected.from && selected.to && selected.from > selected.to) return
    setTimelineRange({ from: selected.from, to: selected.to })
    setSearchApplied((current) => {
      const query = current?.query ?? ''
      return query || selected.tagIds.length ? { ...selected, query } : null
    })
  }

  function updateQuery(query) {
    requestGate.current.invalidate()
    setSearchDraft((current) => {
      if (query.trim() && !current.periodExplicit) return { ...current, query, from: '', to: '' }
      if (!query.trim() && !current.tagIds.length && !current.periodExplicit) {
        const defaults = emptySearch()
        return { ...current, query, from: defaults.from, to: defaults.to }
      }
      return { ...current, query }
    })
    if (!query.trim()) {
      setSearchApplied((current) => current?.tagIds.length ? { ...current, query: '' } : null)
    }
  }

  function toggleDay(day) {
    setCollapsedDays((current) => {
      const next = new Set(current)
      next.has(day) ? next.delete(day) : next.add(day)
      return next
    })
  }

  return <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
    <PagePanel title="할 일과 기록" status={ownerUserId ? '공유 · 읽기 전용' : null} actions={!ownerUserId && <><button className={pagePanelActionClass} disabled={!canManageTags} onClick={onManageTags} type="button">태그 관리</button><button className={pagePanelActionClass} onClick={onAdd} type="button">활동 추가</button></>}>
          <div className="form-field"><label className="form-label" htmlFor="activity-search">검색</label><input aria-label="활동 검색" className="form-control" id="activity-search" onChange={(event) => updateQuery(event.target.value)} placeholder="제목·본문 검색" type="text" value={searchDraft.query} /></div>
          <div className="grid gap-2"><div className="flex items-center justify-between gap-2"><span className="form-label">기록 기간</span><button className="type-action min-h-11 rounded-xl px-2 text-[var(--muted-ink)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]" onClick={() => applyFilters({ ...searchDraft, from: '', to: '' }, { explicitPeriod: true })} type="button">전체 기간</button></div>
            <div className="record-date-grid">
              <CalendarDateField label="기록 시작일" labelClassName="form-label record-date-label" onChange={(value) => applyFilters({ ...searchDraft, from: value }, { explicitPeriod: true })} value={searchDraft.from} />
              <span aria-hidden="true" className="record-date-separator pb-3 text-[var(--muted-ink)]">~</span>
              <CalendarDateField label="기록 종료일" labelClassName="form-label record-date-label" onChange={(value) => applyFilters({ ...searchDraft, to: value }, { explicitPeriod: true })} value={searchDraft.to} />
            </div></div>
            {dateInvalid && <p className="text-sm text-red-200" role="alert">시작일은 종료일보다 늦을 수 없습니다.</p>}
            {availableTags.length > 0 && <fieldset className="min-w-0"><legend className="sr-only">태그</legend><span aria-hidden="true" className="form-label block">태그</span><div className="mt-2 flex flex-wrap gap-2">{availableTags.map((tag) => <TagChip key={tag.id} onClick={() => applyFilters({ ...searchDraft, tagIds: searchDraft.tagIds.includes(tag.id) ? searchDraft.tagIds.filter((id) => id !== tag.id) : [...searchDraft.tagIds, tag.id] })} selected={searchDraft.tagIds.includes(tag.id)}>{tag.name}</TagChip>)}{searchDraft.tagIds.length > 0 && <button className="type-action min-h-11 rounded-xl px-2 underline" onClick={() => applyFilters({ ...searchDraft, tagIds: [], tagMatch: 'any' })} type="button">선택 해제</button>}</div>{searchDraft.tagIds.length > 1 && <label className="mt-3 flex min-h-11 items-center gap-2 text-sm"><input checked={searchDraft.tagMatch === 'all'} onChange={(event) => applyFilters({ ...searchDraft, tagMatch: event.target.checked ? 'all' : 'any' })} type="checkbox" />선택한 태그 모두 포함</label>}</fieldset>}
    </PagePanel>

    {error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100"><span>{error}</span><button className="min-h-11 rounded-xl border border-red-400/40 px-3" onClick={() => searchApplied ? runSearch({ append: retryMore, cursor: retryMore ? searchPage.nextCursor : null, values: searchApplied }) : load({ append: retryMore, cursor: retryMore ? page.nextCursor : null })} type="button">다시 시도</button></div>}
        {loading ? <p className="py-8 text-sm text-[var(--muted-ink)]">활동 목록을 불러오는 중입니다.</p> : searchApplied ? <section className="grid min-w-0 gap-3"><div><h2 className="font-semibold">검색 결과</h2><SearchExplanation page={searchPage} /></div>{searchPage.items.length === 0 ? <p className="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted-ink)]">조건에 맞는 활동이 없습니다.</p> : ['todo', 'done'].map((state) => <section className="grid min-w-0 gap-2" key={state}><h3 className="text-sm font-semibold">{state === 'todo' ? '할 일' : '기록'}</h3>{searchPage.items.filter((item) => item.record_state === state).map((item) => {
          const isActivity = item.record_type === 'activity'
          const open = (mode) => isActivity ? onOpenActivity({ id: item.activity_id }, mode) : onOpenTask({ id: item.task_id, kind: item.task_kind }, mode)
          const noun = isActivity ? '기록' : '할 일'
          const canEdit = !ownerUserId && (isActivity || item.task_status === 'open')
          return <article className="min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4" key={`${item.record_type}-${item.record_id}`}>
            <div className="min-w-0"><span className="type-meta text-[var(--muted-ink)]">{isActivity ? '기록' : item.record_state === 'todo' ? '할 일' : '종료된 할 일'}{item.due_date ? ` · ${item.due_date}` : ''}</span><div className="list-item-title-line mt-2"><h4 className="list-item-title type-item-title">{item.title}</h4>{' '}<ListItemActions editLabel={`${noun} 편집: ${item.title}`} onEdit={canEdit ? () => open('edit') : null} onRead={() => open('read')} readLabel={`${noun} 보기: ${item.title}`} /></div></div>
            {(item.excerpt || item.body) && <p className="type-secondary mt-2 line-clamp-3 min-w-0 break-words text-[var(--muted-ink)]">{markdownPreview(item.body?.toLowerCase().includes(searchApplied.query?.toLowerCase()) ? item.body : (item.excerpt || item.body))}</p>}
            <SearchEvidence item={item} threshold={searchPage.semanticThreshold} />{!isActivity && item.task_kind === 'general' && item.recurrence_kind && item.recurrence_kind !== 'none' && <p className="type-meta mt-2 text-[var(--muted-ink)]">{statusLabel({ ...item, status: item.task_status })}</p>}{item.tags?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{item.tags.map((tag) => <TagChip key={tag.id}>{tag.name}</TagChip>)}</div>}
            {!isActivity && item.task_kind === 'general' && item.record_state === 'todo' && !ownerUserId && <div className="mt-3 flex justify-end"><GeneralTaskListActions onComplete={onCompleteGeneralTask} onStop={onStopGeneralTask} task={{ ...item, id: item.task_id, status: item.task_status }} /></div>}
          </article>
        })}</section>)}{searchPage.nextCursor && <button className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-semibold" disabled={loadingMore} onClick={() => runSearch({ append: true, cursor: searchPage.nextCursor, values: searchApplied })} type="button">{loadingMore ? '불러오는 중' : '더 보기'}</button>}</section> : <>
      <section className="min-w-0">
        <div className="mb-3"><h2 className="type-section-title">할 일</h2></div>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 sm:p-6">
        {page.pending.length === 0 ? <p className="type-secondary text-[var(--muted-ink)]">현재 이어갈 일이 없습니다.</p> : <div className="grid gap-2">{page.pending.map((task) => <article className="min-w-0 rounded-2xl bg-[var(--surface-2)] p-3" key={task.id}><div className="list-item-title-line"><span className="list-item-title type-item-title">{task.title}</span>{' '}<ListItemActions editLabel={`할 일 편집: ${task.title}`} onEdit={!ownerUserId && task.control_state === 'active' ? () => onOpenTask(task, 'edit') : null} onRead={() => onOpenTask(task, 'read')} readLabel={`할 일 보기: ${task.title}`} /></div><span className="type-meta mt-1 block break-words text-[var(--muted-ink)]">{statusLabel(task)}</span>{task.kind === 'general' && !ownerUserId && <div className="mt-3"><GeneralTaskListActions onComplete={onCompleteGeneralTask} onStop={onStopGeneralTask} task={task} /></div>}</article>)}</div>}
        </div>
      </section>

      <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
        <div><h2 className="type-section-title">기록</h2><p className="type-secondary mt-1 text-[var(--muted-ink)]">날짜별 수행 내용과 변경 전후 값을 확인합니다.</p></div>
        {page.days.length === 0 ? <p className="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted-ink)]">조건에 맞는 활동 기록이 없습니다.</p> : page.days.map((day) => {
          const collapsed = collapsedDays.has(day.date)
          return <TimelineDayCard collapsed={collapsed} day={day.date} key={day.date} onToggle={() => toggleDay(day.date)}>
            <ActivityEventViewer actions={day.items} canEdit={!ownerUserId} loading={false} onOpenActivity={onOpenActivity} showDateGroups={false} />
          </TimelineDayCard>
        })}
        {page.nextCursor && <button className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-semibold disabled:opacity-50" disabled={loadingMore} onClick={() => load({ append: true, cursor: page.nextCursor })} type="button">{loadingMore ? '불러오는 중' : '이전 기록 더 보기'}</button>}
      </section>
    </>}
  </section>
}
