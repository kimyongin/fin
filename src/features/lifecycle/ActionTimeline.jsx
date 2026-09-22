import { useEffect, useRef, useState } from 'react'

import ActivityEventViewer from '../activity/ActivityEventViewer'
import { FilterChips } from '../../components/PageControls'
import { createRequestGate } from '../../lib/requestGate'
import { fetchActionTimeline, fetchActivityReports } from './data'

const filters = [
  { id: 'all', label: '전체' },
  { id: 'pending', label: '할 일' },
  { id: 'done', label: '한 일' },
]

function formatDay(value) {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full' }).format(new Date(`${value}T00:00:00`))
}

function statusLabel(task) {
  if (task.kind === 'general') return task.recurrence_kind === 'daily' ? '매일 반복' : '할 일'
  if (task.kind === 'research') return task.status === 'waiting' ? '자료 대기' : '확인 필요'
  return task.status === 'partial' ? '일부 체결' : '실행 예정'
}

export default function ActionTimeline({ onAdd, onCompleteGeneralTask, onOpenTask, ownerUserId, refreshKey = 0, supabase }) {
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState({ pending: [], days: [], nextCursor: null })
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [collapsedDays, setCollapsedDays] = useState(new Set())
  const [reports, setReports] = useState([])
  const requestGate = useRef(createRequestGate())

  async function load({ append = false, cursor = null } = {}) {
    const request = requestGate.current.begin()
    append ? setLoadingMore(true) : setLoading(true)
    setError('')
    try {
      const next = await fetchActionTimeline(supabase, { cursor, filter, ownerUserId })
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

  useEffect(() => {
    load()
    if (!ownerUserId) fetchActivityReports(supabase).then((result) => setReports(result.items)).catch(() => setReports([]))
    return () => requestGate.current.invalidate()
  }, [filter, ownerUserId, refreshKey, supabase])

  function toggleDay(day) {
    setCollapsedDays((current) => {
      const next = new Set(current)
      next.has(day) ? next.delete(day) : next.add(day)
      return next
    })
  }

  return <section className="grid gap-5">
    <header className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm leading-6 text-[var(--muted-ink)]">앞으로 할 일은 위에서 놓치지 않고, 실제로 한 일은 날짜별 기록으로 이어서 봅니다.</p>
        {!ownerUserId && <button className="rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white" onClick={onAdd} type="button">활동 추가</button>}
      </div>
      <FilterChips ariaLabel="활동 목록 필터" onChange={setFilter} options={filters} value={filter} />
    </header>

    {error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100"><span>{error}</span><button className="min-h-11 rounded-xl border border-red-400/40 px-3" onClick={() => load()} type="button">다시 시도</button></div>}
    {loading ? <p className="py-8 text-sm text-[var(--muted-ink)]">활동 목록을 불러오는 중입니다.</p> : <>
      {filter !== 'done' && <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
        <div className="flex items-end justify-between gap-3"><div><h2 className="font-semibold">지금 할 일</h2><p className="mt-1 text-sm text-[var(--muted-ink)]">미완료 과제 {page.pending.length}개</p></div></div>
        {page.pending.length === 0 ? <p className="mt-4 text-sm text-[var(--muted-ink)]">현재 이어갈 일이 없습니다.</p> : <div className="mt-4 grid gap-2">{page.pending.map((task) => <article className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--surface-2)] p-3" key={task.id}><button className="min-w-0 flex-1 text-left" onClick={() => onOpenTask(task)} type="button"><span className="block break-words text-sm font-semibold">{task.title}</span><span className="mt-1 block text-xs text-[var(--muted-ink)]">{statusLabel(task)}{task.due_date ? ` · ${task.due_date}` : ''}</span></button>{task.kind === 'general' && !ownerUserId && <button className="min-h-11 shrink-0 rounded-xl border border-[var(--line)] px-3 text-sm" onClick={() => onCompleteGeneralTask(task)} type="button">완료</button>}</article>)}</div>}
      </section>}

      {filter !== 'pending' && <section className="grid gap-3">
        <div><h2 className="font-semibold">날짜별 한 일</h2><p className="mt-1 text-sm text-[var(--muted-ink)]">수행 사실과 변경 전후 값을 확인합니다.</p></div>
        {page.days.length === 0 ? <p className="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted-ink)]">조건에 맞는 활동 기록이 없습니다.</p> : page.days.map((day) => {
          const collapsed = collapsedDays.has(day.date)
          const summary = Object.entries(day.counts ?? {}).map(([label, count]) => `${label} ${count}`).join(' · ')
          return <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]" key={day.date}>
            <button aria-expanded={!collapsed} className="flex min-h-11 w-full items-center justify-between gap-3 text-left" onClick={() => toggleDay(day.date)} type="button"><span><span className="block text-sm font-semibold">{formatDay(day.date)}</span><span className="mt-1 block text-xs text-[var(--muted-ink)]">{summary || `${day.item_count}건`}</span></span><span aria-hidden="true" className="text-[var(--muted-ink)]">{collapsed ? '펼치기' : '접기'}</span></button>
            {!collapsed && <div className="mt-3 border-t border-[var(--line)] pt-4"><ActivityEventViewer actions={day.items} loading={false} showDateGroups={false} /></div>}
          </article>
        })}
        {page.nextCursor && <button className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-semibold disabled:opacity-50" disabled={loadingMore} onClick={() => load({ append: true, cursor: page.nextCursor })} type="button">{loadingMore ? '불러오는 중' : '이전 기록 더 보기'}</button>}
      </section>}
      {filter === 'all' && !ownerUserId && reports.length > 0 && <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
        <h2 className="font-semibold">저장된 활동 리포트</h2>
        <p className="mt-1 text-sm text-[var(--muted-ink)]">ChatGPT가 기간 원본을 검토해 저장한 일간·주간·월간 회고입니다.</p>
        <div className="mt-4 grid gap-3">{reports.map((report) => <article className="rounded-2xl bg-[var(--surface-2)] p-4" key={report.id}><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{report.title}</h3><span className="text-xs text-[var(--muted-ink)]">{report.period_start} ~ {report.period_end}</span></div><p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">{report.summary}</p>{report.needs_regeneration && <p className="mt-2 text-xs font-semibold text-amber-300">이 기간에 새 기록이 있어 다시 생성해야 합니다.</p>}</article>)}</div>
      </section>}
    </>}
  </section>
}
