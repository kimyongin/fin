import { useEffect, useRef, useState } from 'react'

import ActivityEventViewer from '../activity/ActivityEventViewer'
import { PageToolbar } from '../../components/PageControls'
import { createRequestGate } from '../../lib/requestGate'
import { fetchActionTimeline, searchActivities } from './data'
import ReviewHistoryPage from '../review/ReviewHistoryPage'

function formatDay(value) {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full' }).format(new Date(`${value}T00:00:00`))
}

function statusLabel(task) {
  return task.recurrence_kind === 'daily' ? '매일 반복' : '할 일'
}

const activityKindLabels = { general: '일반', research: '조사', review: '점검', decision: '판단', retrospective: '회고', trade: '매매', reconciliation: '잔고 보정' }

export default function ActionTimeline({ availableTags = [], canViewReviews = true, onAdd, onCompleteGeneralTask, onOpenActivity, onOpenTask, ownerUserId, refreshKey = 0, supabase }) {
  const [page, setPage] = useState({ pending: [], days: [], nextCursor: null })
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [collapsedDays, setCollapsedDays] = useState(new Set())
  const [searchDraft, setSearchDraft] = useState({ query: '', kind: 'all', from: '', to: '', conclusion: 'all', tagIds: [] })
  const [searchApplied, setSearchApplied] = useState(null)
  const [searchPage, setSearchPage] = useState({ items: [], nextCursor: null, semanticStatus: 'not_requested' })
  const requestGate = useRef(createRequestGate())
  const previousTagIds = useRef(new Set())

  useEffect(() => {
    const nextIds = new Set(availableTags.map((tag) => tag.id))
    const removed = new Set([...previousTagIds.current].filter((id) => !nextIds.has(id)))
    previousTagIds.current = nextIds
    if (removed.size === 0) return
    setSearchDraft((current) => ({ ...current, tagIds: current.tagIds.filter((id) => !removed.has(id)) }))
    setSearchApplied((current) => current ? { ...current, tagIds: current.tagIds.filter((id) => !removed.has(id)) } : null)
  }, [availableTags])

  async function load({ append = false, cursor = null } = {}) {
    const request = requestGate.current.begin()
    append ? setLoadingMore(true) : setLoading(true)
    setError('')
    try {
      const next = await fetchActionTimeline(supabase, { cursor, ownerUserId })
      if (!request.isCurrent()) return
      setPage((current) => append
        ? { pending: current.pending, days: [...current.days, ...next.days], nextCursor: next.nextCursor }
        : next)
    } catch (nextError) {
      if (request.isCurrent()) setError(nextError.message ?? '활동 목록을 불러오지 못했습니다.')
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
    } catch (nextError) {
      if (request.isCurrent()) setError(nextError.message ?? '활동을 검색하지 못했습니다.')
    } finally {
      if (request.isCurrent()) { setLoading(false); setLoadingMore(false) }
    }
  }

  useEffect(() => {
    if (searchApplied?.kind === 'review' && ownerUserId && canViewReviews) { setLoading(false); setError('') }
    else if (searchApplied) runSearch({ values: searchApplied })
    else load()
    return () => requestGate.current.invalidate()
  }, [canViewReviews, ownerUserId, refreshKey, searchApplied, supabase])

  function clearSearch() {
    requestGate.current.invalidate()
    setLoading(true)
    setLoadingMore(false)
    setSearchDraft({ query: '', kind: 'all', from: '', to: '', conclusion: 'all', tagIds: [] })
    setSearchApplied(null)
    setSearchPage({ items: [], nextCursor: null, semanticStatus: 'not_requested' })
  }

  function toggleDay(day) {
    setCollapsedDays((current) => {
      const next = new Set(current)
      next.has(day) ? next.delete(day) : next.add(day)
      return next
    })
  }

  return <section className="grid gap-5">
    <header className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-3 sm:p-4">
      <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); requestGate.current.invalidate(); setLoading(true); setSearchApplied({ ...searchDraft }) }}>
        <PageToolbar secondary={!ownerUserId && <button className="min-h-11 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white" onClick={onAdd} type="button">활동 추가</button>}>
          <div className="flex w-full min-w-0 gap-2 sm:w-96"><input aria-label="활동 검색" className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" onChange={(event) => setSearchDraft({ ...searchDraft, query: event.target.value })} placeholder="제목·메모·결과·결론 검색" value={searchDraft.query} /><button className="min-h-11 rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-semibold" type="submit">검색</button>{searchApplied && <button className="min-h-11 rounded-xl border border-[var(--line)] px-3 py-2 text-sm" onClick={clearSearch} type="button">해제</button>}</div>
        </PageToolbar>
        <details className="rounded-xl border border-[var(--line)] px-3 py-2"><summary className="cursor-pointer text-sm text-[var(--muted-ink)]">상세 필터</summary><div className="mt-3 grid gap-3 sm:grid-cols-4"><label className="grid gap-1 text-xs text-[var(--muted-ink)]">활동 종류<select className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm text-[var(--ink)]" onChange={(event) => setSearchDraft({ ...searchDraft, kind: event.target.value })} value={searchDraft.kind}><option value="all">전체</option><option value="task">할 일</option><option value="general">일반</option><option value="research">조사</option><option value="review">점검</option><option value="decision">판단</option><option value="retrospective">회고</option><option value="trade">매매</option><option value="reconciliation">잔고 보정</option></select></label><label className="grid gap-1 text-xs text-[var(--muted-ink)]">시작일<input className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm text-[var(--ink)]" onChange={(event) => setSearchDraft({ ...searchDraft, from: event.target.value })} type="date" value={searchDraft.from} /></label><label className="grid gap-1 text-xs text-[var(--muted-ink)]">종료일<input className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm text-[var(--ink)]" onChange={(event) => setSearchDraft({ ...searchDraft, to: event.target.value })} type="date" value={searchDraft.to} /></label><label className="grid gap-1 text-xs text-[var(--muted-ink)]">결론<select className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm text-[var(--ink)]" onChange={(event) => setSearchDraft({ ...searchDraft, conclusion: event.target.value })} value={searchDraft.conclusion}><option value="all">전체</option><option value="yes">결론 있음</option><option value="no">결론 없음</option></select></label></div>{availableTags.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{availableTags.map((tag) => <label className={`flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs ${searchDraft.tagIds.includes(tag.id) ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--line)]'}`} key={tag.id}><input checked={searchDraft.tagIds.includes(tag.id)} onChange={() => setSearchDraft({ ...searchDraft, tagIds: searchDraft.tagIds.includes(tag.id) ? searchDraft.tagIds.filter((id) => id !== tag.id) : [...searchDraft.tagIds, tag.id] })} type="checkbox" />{tag.name}</label>)}</div>}</details>
      </form>
    </header>

    {error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100"><span>{error}</span><button className="min-h-11 rounded-xl border border-red-400/40 px-3" onClick={() => searchApplied ? runSearch({ values: searchApplied }) : load()} type="button">다시 시도</button></div>}
    {loading ? <p className="py-8 text-sm text-[var(--muted-ink)]">활동 목록을 불러오는 중입니다.</p> : searchApplied?.kind === 'review' && ownerUserId && canViewReviews ? <><p className="text-sm text-[var(--muted-ink)]">공유된 점검은 공개 범위를 지키기 위해 별도 조회하며, 날짜·키워드·태그 조건은 적용되지 않습니다.</p><ReviewHistoryPage ownerUserId={ownerUserId} supabase={supabase} /></> : searchApplied ? <section className="grid gap-3"><div><h2 className="font-semibold">검색 결과</h2><p className="mt-1 text-sm text-[var(--muted-ink)]">할 일과 한 일을 같은 조건으로 찾았습니다. {searchPage.semanticStatus === 'active' ? '비슷한 표현도 함께 반영했습니다.' : searchApplied.query ? '현재는 조건·키워드 결과입니다.' : ''}</p></div>{searchPage.items.length === 0 ? <p className="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted-ink)]">조건에 맞는 활동이 없습니다.</p> : searchPage.items.map((item) => <button className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 text-left" key={`${item.record_type}-${item.record_id}`} onClick={() => item.record_type === 'activity' ? onOpenActivity({ id: item.activity_id }) : onOpenTask({ id: item.task_id, kind: item.task_kind })} type="button"><span className="text-xs text-[var(--muted-ink)]">{item.record_state === 'todo' ? '할 일' : activityKindLabels[item.record_kind] ?? '한 일'}{item.due_date ? ` · ${item.due_date}` : ''}</span><h3 className="mt-2 font-semibold">{item.title}</h3>{item.result && <p className="mt-2 text-sm text-[var(--muted-ink)]">{item.result}</p>}{item.conclusion && <p className="mt-1 text-sm text-[var(--accent)]">{item.conclusion}</p>}{item.tags?.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{item.tags.map((tag) => <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--muted-ink)]" key={tag.id}>{tag.name}</span>)}</div>}</button>)}{searchPage.nextCursor && <button className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-semibold" disabled={loadingMore} onClick={() => runSearch({ append: true, cursor: searchPage.nextCursor, values: searchApplied })} type="button">{loadingMore ? '불러오는 중' : '더 보기'}</button>}</section> : <>
      <section>
        <div className="mb-3"><h2 className="text-lg font-semibold">지금 할 일</h2><p className="mt-1 text-sm text-[var(--muted-ink)]">미완료 과제 {page.pending.length}개</p></div>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 sm:p-6">
        {page.pending.length === 0 ? <p className="text-sm text-[var(--muted-ink)]">현재 이어갈 일이 없습니다.</p> : <div className="grid gap-2">{page.pending.map((task) => <article className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--surface-2)] p-3" key={task.id}><button className="min-w-0 flex-1 text-left" onClick={() => onOpenTask(task)} type="button"><span className="block break-words text-sm font-semibold">{task.title}</span><span className="mt-1 block text-xs text-[var(--muted-ink)]">{statusLabel(task)}{task.due_date ? ` · ${task.due_date}` : ''}</span></button>{task.kind === 'general' && !ownerUserId && <button className="min-h-11 shrink-0 rounded-xl border border-[var(--line)] px-3 text-sm" onClick={() => onCompleteGeneralTask(task)} type="button">완료</button>}</article>)}</div>}
        </div>
      </section>

      <section className="grid gap-3">
        <div><h2 className="text-lg font-semibold">날짜별 한 일</h2><p className="mt-1 text-sm text-[var(--muted-ink)]">수행 사실과 변경 전후 값을 확인합니다.</p></div>
        {page.days.length === 0 ? <p className="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted-ink)]">조건에 맞는 활동 기록이 없습니다.</p> : page.days.map((day) => {
          const collapsed = collapsedDays.has(day.date)
          const summary = Object.entries(day.counts ?? {}).map(([label, count]) => `${label} ${count}`).join(' · ')
          return <article className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)] sm:p-6" key={day.date}>
            <button aria-expanded={!collapsed} className="flex min-h-11 w-full items-center justify-between gap-3 text-left" onClick={() => toggleDay(day.date)} type="button"><span><span className="block text-sm font-semibold">{formatDay(day.date)}</span><span className="mt-1 block text-xs text-[var(--muted-ink)]">{summary || `${day.item_count}건`}</span></span><span aria-hidden="true" className="text-[var(--muted-ink)]">{collapsed ? '펼치기' : '접기'}</span></button>
            {!collapsed && <div className="mt-3 border-t border-[var(--line)] pt-4"><ActivityEventViewer actions={day.items} loading={false} onOpenActivity={onOpenActivity} showDateGroups={false} /></div>}
          </article>
        })}
        {page.nextCursor && <button className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-semibold disabled:opacity-50" disabled={loadingMore} onClick={() => load({ append: true, cursor: page.nextCursor })} type="button">{loadingMore ? '불러오는 중' : '이전 기록 더 보기'}</button>}
      </section>
    </>}
  </section>
}
