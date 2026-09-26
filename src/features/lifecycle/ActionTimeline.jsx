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

function statusLabel(task) {
  const state = task.status === 'not_scheduled' ? '예정' : task.status === 'done' ? '이번 완료됨' : ''
  return `${scheduleSummary(task)}${state ? ` · ${state}` : ''}`
}

const emptySearch = () => {
  const to = businessDate()
  const from = businessDate(Date.parse(`${to}T12:00:00+09:00`) - 29 * 86400000)
  return { query: '', from, to, tagIds: [], tagMatch: 'any' }
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
  const [searchPage, setSearchPage] = useState({ items: [], nextCursor: null, semanticStatus: 'not_requested' })
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
      setSearchPage((current) => append ? { items: [...current.items, ...next.items], nextCursor: next.nextCursor, semanticStatus: current.semanticStatus } : next)
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

  function applyFilters(next) {
    setSearchDraft(next)
    if (next.from && next.to && next.from > next.to) return
    setTimelineRange({ from: next.from, to: next.to })
    setSearchApplied((current) => {
      const query = current?.query ?? ''
      return query || next.tagIds.length ? { ...next, query } : null
    })
  }

  function updateQuery(query) {
    requestGate.current.invalidate()
    setSearchDraft((current) => ({ ...current, query }))
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

  return <section className="grid gap-5">
    <PagePanel title="할 일과 기록" status={ownerUserId ? '공유 · 읽기 전용' : null} actions={!ownerUserId && <><button className={pagePanelActionClass} disabled={!canManageTags} onClick={onManageTags} type="button">태그 관리</button><button className={pagePanelActionClass} onClick={onAdd} type="button">활동 추가</button></>}>
          <div className="form-field"><label className="form-label" htmlFor="activity-search">검색</label><input aria-label="활동 검색" className="form-control" id="activity-search" onChange={(event) => updateQuery(event.target.value)} placeholder="제목·본문 검색" type="text" value={searchDraft.query} /></div>
          <div className="grid gap-2"><div className="flex items-center justify-between gap-2"><span className="form-label">기록 기간</span><button className="type-action min-h-11 rounded-xl px-2 text-[var(--muted-ink)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]" onClick={() => applyFilters({ ...searchDraft, from: '', to: '' })} type="button">전체 기간</button></div>
            <div className="record-date-grid">
              <CalendarDateField label="기록 시작일" labelClassName="form-label record-date-label" onChange={(value) => applyFilters({ ...searchDraft, from: value })} value={searchDraft.from} />
              <span aria-hidden="true" className="record-date-separator pb-3 text-[var(--muted-ink)]">~</span>
              <CalendarDateField label="기록 종료일" labelClassName="form-label record-date-label" onChange={(value) => applyFilters({ ...searchDraft, to: value })} value={searchDraft.to} />
            </div></div>
            {dateInvalid && <p className="text-sm text-red-200" role="alert">시작일은 종료일보다 늦을 수 없습니다.</p>}
            {availableTags.length > 0 && <fieldset className="min-w-0"><legend className="sr-only">태그</legend><span aria-hidden="true" className="form-label block">태그</span><div className="mt-2 flex flex-wrap gap-2">{availableTags.map((tag) => <TagChip key={tag.id} onClick={() => applyFilters({ ...searchDraft, tagIds: searchDraft.tagIds.includes(tag.id) ? searchDraft.tagIds.filter((id) => id !== tag.id) : [...searchDraft.tagIds, tag.id] })} selected={searchDraft.tagIds.includes(tag.id)}>{tag.name}</TagChip>)}{searchDraft.tagIds.length > 0 && <button className="type-action min-h-11 rounded-xl px-2 underline" onClick={() => applyFilters({ ...searchDraft, tagIds: [], tagMatch: 'any' })} type="button">선택 해제</button>}</div>{searchDraft.tagIds.length > 1 && <label className="mt-3 flex min-h-11 items-center gap-2 text-sm"><input checked={searchDraft.tagMatch === 'all'} onChange={(event) => applyFilters({ ...searchDraft, tagMatch: event.target.checked ? 'all' : 'any' })} type="checkbox" />선택한 태그 모두 포함</label>}</fieldset>}
    </PagePanel>

    {error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100"><span>{error}</span><button className="min-h-11 rounded-xl border border-red-400/40 px-3" onClick={() => searchApplied ? runSearch({ append: retryMore, cursor: retryMore ? searchPage.nextCursor : null, values: searchApplied }) : load({ append: retryMore, cursor: retryMore ? page.nextCursor : null })} type="button">다시 시도</button></div>}
        {loading ? <p className="py-8 text-sm text-[var(--muted-ink)]">활동 목록을 불러오는 중입니다.</p> : searchApplied ? <section className="grid gap-3"><div><h2 className="font-semibold">검색 결과</h2>{searchPage.semanticStatus === 'active' && <p className="mt-1 type-secondary text-[var(--muted-ink)]">비슷한 표현도 함께 반영했습니다.</p>}</div>{searchPage.items.length === 0 ? <p className="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted-ink)]">조건에 맞는 활동이 없습니다.</p> : ['todo', 'done'].map((state) => <section className="grid gap-2" key={state}><h3 className="text-sm font-semibold">{state === 'todo' ? '할 일' : '기록'}</h3>{searchPage.items.filter((item) => item.record_state === state).map((item) => <article className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4" key={`${item.record_type}-${item.record_id}`}><button className="w-full text-left" onClick={() => item.record_type === 'activity' ? onOpenActivity({ id: item.activity_id }) : onOpenTask({ id: item.task_id, kind: item.task_kind })} type="button"><span className="text-xs text-[var(--muted-ink)]">{item.record_state === 'todo' ? '할 일' : '기록'}{item.due_date ? ` · ${item.due_date}` : ''}</span><h4 className="mt-2 font-semibold">{item.title}</h4>{item.body && <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-[var(--muted-ink)]">{item.body}</p>}{item.record_type === 'task' && item.task_kind === 'general' && item.recurrence_kind && item.recurrence_kind !== 'none' && <p className="type-meta mt-2 text-[var(--muted-ink)]">{statusLabel({ ...item, status: item.task_status })}</p>}{item.tags?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{item.tags.map((tag) => <TagChip key={tag.id}>{tag.name}</TagChip>)}</div>}</button>{item.record_type === 'task' && item.task_kind === 'general' && !ownerUserId && <div className="mt-3 flex justify-end"><GeneralTaskListActions onComplete={onCompleteGeneralTask} onStop={onStopGeneralTask} task={{ ...item, id: item.task_id, status: item.task_status }} /></div>}</article>)}</section>)}{searchPage.nextCursor && <button className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-semibold" disabled={loadingMore} onClick={() => runSearch({ append: true, cursor: searchPage.nextCursor, values: searchApplied })} type="button">{loadingMore ? '불러오는 중' : '더 보기'}</button>}</section> : <>
      <section>
        <div className="mb-3"><h2 className="type-section-title">할 일</h2></div>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 sm:p-6">
        {page.pending.length === 0 ? <p className="type-secondary text-[var(--muted-ink)]">현재 이어갈 일이 없습니다.</p> : <div className="grid gap-2">{page.pending.map((task) => <article className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[var(--surface-2)] p-3" key={task.id}><button className="min-w-0 w-full flex-1 text-left sm:w-auto" onClick={() => onOpenTask(task)} type="button"><span className="type-item-title block break-words">{task.title}</span><span className="type-meta mt-1 block text-[var(--muted-ink)]">{statusLabel(task)}</span></button>{task.kind === 'general' && !ownerUserId && <GeneralTaskListActions onComplete={onCompleteGeneralTask} onStop={onStopGeneralTask} task={task} />}</article>)}</div>}
        </div>
      </section>

      <section className="grid gap-3">
        <div><h2 className="type-section-title">기록</h2><p className="type-secondary mt-1 text-[var(--muted-ink)]">날짜별 수행 내용과 변경 전후 값을 확인합니다.</p></div>
        {page.days.length === 0 ? <p className="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted-ink)]">조건에 맞는 활동 기록이 없습니다.</p> : page.days.map((day) => {
          const collapsed = collapsedDays.has(day.date)
          return <TimelineDayCard collapsed={collapsed} day={day.date} key={day.date} onToggle={() => toggleDay(day.date)}>
            <ActivityEventViewer actions={day.items} loading={false} onOpenActivity={onOpenActivity} showDateGroups={false} />
          </TimelineDayCard>
        })}
        {page.nextCursor && <button className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-semibold disabled:opacity-50" disabled={loadingMore} onClick={() => load({ append: true, cursor: page.nextCursor })} type="button">{loadingMore ? '불러오는 중' : '이전 기록 더 보기'}</button>}
      </section>
    </>}
  </section>
}
