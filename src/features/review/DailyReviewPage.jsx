import { useEffect, useRef, useState } from 'react'

import MarkdownContent from '../../components/MarkdownContent'
import ModalShell from '../../components/ModalShell'
import { fetchBriefingRelatedTasks, fetchDailyBriefing, fetchDailyBriefingPage } from './data'
import { fetchLinkedTodoTaskIds, fetchPortfolioTaskPage, fetchTodoBundlePage } from '../lifecycle/data'
import PortfolioIntegritySummary from './PortfolioIntegritySummary'
import { createRequestGate } from '../../lib/requestGate'
import { useDetailHistoryEntry } from '../../hooks/useDetailHistoryEntry'

const coverageLabels = {
  complete: '조사 완료',
  partial: '일부 조사',
  failed: '자료 부족',
}

const statusLabels = {
  no_action: '행동 불필요',
  attention: '확인 필요',
  insufficient_data: '판단 자료 부족',
}

function formatMoment(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function localDateKey(value, timezone = 'Asia/Seoul') {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

function summaryText(value) {
  if (typeof value === 'string') return value
  if (value?.summary || value?.title || value?.body) return value.summary ?? value.title ?? value.body
  if (value && typeof value === 'object') {
    const readable = Object.values(value).find((item) => typeof item === 'string' && item.trim())
    return readable ?? '이전 형식의 점검 항목'
  }
  return ''
}

function StatusPills({ briefing }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1 text-[var(--ink)]">
        {statusLabels[briefing.status] ?? briefing.status}
      </span>
      <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[var(--muted-ink)]">
        {coverageLabels[briefing.coverage_status] ?? briefing.coverage_status}
      </span>
    </div>
  )
}

function BriefingDetail({ briefing, loading, onClose }) {
  return (
    <ModalShell onClose={onClose} title="저장된 점검 상세" variant="detail">
      {loading || !briefing ? (
        <p className="py-8 text-sm text-[var(--muted-ink)]">브리핑을 불러오는 중입니다.</p>
      ) : (
        <div className="grid gap-7">
          <section className="grid gap-3">
            <StatusPills briefing={briefing} />
            <h3 className="text-xl font-semibold leading-8">{briefing.headline}</h3>
            <p className="text-xs text-[var(--muted-ink)]">분석 {formatMoment(briefing.analyzed_at)}</p>
          </section>

          <section className="grid gap-3">
            <h3 className="text-sm font-semibold">중요한 변화</h3>
            {briefing.changes?.length ? (
              <ul className="grid gap-2">
                {briefing.changes.map((change, index) => (
                  <li className="rounded-2xl bg-[var(--surface-2)] px-4 py-3 text-sm leading-6" key={index}>
                    {summaryText(change)}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-[var(--muted-ink)]">저장된 중요 변화가 없습니다.</p>}
          </section>

          {briefing.uncertainties?.length > 0 && (
            <section className="grid gap-3">
              <h3 className="text-sm font-semibold">불확실성과 추가 확인</h3>
              <ul className="grid gap-2 text-sm leading-6 text-[var(--muted-ink)]">
                {briefing.uncertainties.map((item, index) => <li key={index}>• {summaryText(item)}</li>)}
              </ul>
            </section>
          )}

          <section className="grid gap-3">
            <h3 className="text-sm font-semibold">확인한 범위</h3>
            <div className="grid gap-3">
              {briefing.scopes?.map((scope) => (
                <article className="rounded-2xl border border-[var(--line)] p-4" key={scope.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm">{scope.subject_ref || (scope.subject_kind === 'portfolio' ? '전체 포트폴리오' : scope.subject_kind)}</strong>
                    <span className="text-xs text-[var(--muted-ink)]">{scope.coverage === 'sufficient' ? '충분' : scope.coverage === 'partial' ? '일부' : '미확인'}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted-ink)]">
                    {formatMoment(scope.window_from)}부터 {formatMoment(scope.window_to)}까지
                  </p>
                  {scope.reason && <p className="mt-2 text-sm leading-6">{scope.reason}</p>}
                  {scope.checked_sources?.length > 0 && (
                    <p className="mt-2 text-xs text-[var(--muted-ink)]">확인 출처 {scope.checked_sources.length}개</p>
                  )}
                </article>
              ))}
            </div>
          </section>

          {briefing.evidence?.length > 0 && (
            <section className="grid gap-3">
              <h3 className="text-sm font-semibold">근거 자료</h3>
              <ul className="grid gap-3">
                {briefing.evidence.map((evidence) => (
                  <li className="rounded-2xl bg-[var(--surface-2)] p-4" key={evidence.id}>
                    <a className="text-sm font-semibold text-[var(--accent)] underline" href={evidence.source_url} rel="noreferrer" target="_blank">
                      {evidence.title}
                    </a>
                    <MarkdownContent className="mt-2 text-sm leading-6 text-[var(--muted-ink)]" content={evidence.summary} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </ModalShell>
  )
}

export default function DailyReviewPage({ onNavigate, onOpenTask, ownerUserId = null, supabase }) {
  const [briefings, setBriefings] = useState([])
  const [latestDetail, setLatestDetail] = useState(null)
  const [relatedTasks, setRelatedTasks] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [relatedTasksError, setRelatedTasksError] = useState('')
  const [todoOverview, setTodoOverview] = useState({ bundles: [], tasks: [], error: '' })
  const listRequestGate = useRef(createRequestGate())
  const detailRequestGate = useRef(createRequestGate())

  function dismissDetail() {
    detailRequestGate.current.invalidate()
    setSelected(null)
    setDetailLoading(false)
  }

  const requestDetailClose = useDetailHistoryEntry(Boolean(selected), dismissDetail)

  async function load() {
    const request = listRequestGate.current.begin()
    setLoading(true)
    setError('')
    setRelatedTasksError('')
    setBriefings([])
    setLatestDetail(null)
    setRelatedTasks([])
    setNextCursor(null)
    try {
      const page = await fetchDailyBriefingPage(supabase, { ownerUserId })
      if (!request.isCurrent()) return
      setBriefings(page.items)
      setNextCursor(page.nextCursor)
      if (!page.items[0]) return
      const detail = await fetchDailyBriefing(supabase, page.items[0].id, ownerUserId)
      if (!request.isCurrent()) return
      setLatestDetail(detail)
      try {
        const tasks = await fetchBriefingRelatedTasks(supabase, detail.id, ownerUserId)
        if (!request.isCurrent()) return
        setRelatedTasks(tasks)
      } catch (taskError) {
        if (!request.isCurrent()) return
        setRelatedTasks([])
        setRelatedTasksError(taskError.message ?? '연결된 과제를 불러오지 못했습니다.')
      }
    } catch (nextError) {
      if (!request.isCurrent()) return
      setError(nextError.message ?? '저장된 점검을 불러오지 못했습니다.')
    } finally {
      if (request.isCurrent()) setLoading(false)
    }
  }

  async function loadMore() {
    if (!nextCursor) return
    const request = listRequestGate.current.begin()
    setLoading(true)
    setError('')
    try {
      const page = await fetchDailyBriefingPage(supabase, { cursor: nextCursor, ownerUserId })
      if (!request.isCurrent()) return
      setBriefings((current) => [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()])
      setNextCursor(page.nextCursor)
    } catch (nextError) {
      if (!request.isCurrent()) return
      setError(nextError.message ?? '이전 점검을 불러오지 못했습니다.')
    } finally {
      if (request.isCurrent()) setLoading(false)
    }
  }

  useEffect(() => {
    detailRequestGate.current.invalidate()
    setSelected(null)
    setDetailLoading(false)
    load()
    return () => {
      listRequestGate.current.invalidate()
      detailRequestGate.current.invalidate()
    }
  }, [ownerUserId, supabase])

  useEffect(() => {
    if (ownerUserId) {
      setTodoOverview({ bundles: [], tasks: [], error: '' })
      return undefined
    }
    let active = true
    Promise.all([
      fetchTodoBundlePage(supabase, { filter: 'active', limit: 5 }),
      fetchPortfolioTaskPage(supabase, { filter: 'active', limit: 20 }),
      fetchLinkedTodoTaskIds(supabase),
    ]).then(([bundlePage, taskPage, linkedIds]) => {
      if (!active) return
      const linked = new Set(linkedIds)
      setTodoOverview({ bundles: bundlePage.items, tasks: taskPage.items.filter((task) => !linked.has(task.id)).slice(0, 5), error: '' })
    }).catch((nextError) => active && setTodoOverview({ bundles: [], tasks: [], error: nextError.message ?? '오늘 이어갈 일을 불러오지 못했습니다.' }))
    return () => { active = false }
  }, [ownerUserId, supabase])

  async function openDetail(briefingId) {
    const request = detailRequestGate.current.begin()
    setDetailLoading(true)
    setError('')
    setSelected({ id: briefingId })
    try {
      const detail = await fetchDailyBriefing(supabase, briefingId, ownerUserId)
      if (!request.isCurrent()) return
      setSelected(detail)
    } catch (nextError) {
      if (!request.isCurrent()) return
      setSelected(null)
      setError(nextError.message ?? '브리핑 상세를 불러오지 못했습니다.')
    } finally {
      if (request.isCurrent()) setDetailLoading(false)
    }
  }

  const latest = latestDetail ?? briefings[0]
  const relatedTaskIds = new Set(relatedTasks.map((task) => task.id))
  const visibleTodoTasks = todoOverview.tasks.filter((task) => !relatedTaskIds.has(task.id))
  const latestIsToday = latest
    ? localDateKey(latest.analyzed_at, latest.timezone) === localDateKey(new Date(), latest.timezone)
    : false

  return (
    <section className="grid gap-5">
      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)] sm:p-6">
        <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">{latestIsToday ? '오늘 저장한 점검' : '마지막 저장 점검'}</p>
            {latest ? (
              <>
                <div className="mt-3"><StatusPills briefing={latest} /></div>
                <h2 className="mt-4 break-words text-xl font-semibold leading-8 sm:text-2xl">{latest.headline}</h2>
                <p className="mt-2 text-xs text-[var(--muted-ink)]">분석 {formatMoment(latest.analyzed_at)}</p>
                {!latestIsToday && <p className="mt-2 text-sm leading-6 text-amber-200">오늘 분석이 아니라 마지막으로 저장된 당시 결론입니다.</p>}
                <section className="mt-5">
                  <h3 className="text-sm font-semibold">중요한 변화</h3>
                  {latest.changes?.length ? (
                    <ul className="mt-2 grid gap-2">{latest.changes.slice(0, 3).map((change, index) => <li className="break-words rounded-2xl bg-[var(--surface-2)] px-4 py-3 text-sm leading-6" key={index}>{summaryText(change)}</li>)}</ul>
                  ) : <p className="mt-2 text-sm text-[var(--muted-ink)]">저장된 중요 변화가 없습니다.</p>}
                </section>
                <section className="mt-5 rounded-2xl border border-[var(--line)] p-4">
                  <h3 className="text-sm font-semibold">이 점검에서 이어갈 과제</h3>
                  {relatedTasksError ? <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-100"><span>{relatedTasksError}</span><button className="min-h-11 rounded-lg border border-red-400/40 px-3" onClick={load} type="button">다시 시도</button></div> : relatedTasks.length ? (
                    <ul className="mt-2 grid gap-2">
                      {relatedTasks.map((task) => (
                        <li key={task.id}>
                          <button className="min-h-11 w-full rounded-xl bg-[var(--surface-2)] px-3 py-2 text-left text-sm font-semibold" onClick={() => onOpenTask?.(task.id)} type="button">{task.title}</button>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">브리핑과 명시적으로 연결된 과제가 없습니다. 관련성 근거 없이 다른 할 일을 오늘의 과제로 표시하지 않습니다.</p>}
                </section>
                <button className="mt-5 min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)]" onClick={() => openDetail(latest.id)} type="button">
                  전체 브리핑 보기
                </button>
              </>
            ) : !loading && (
              <>
                <h2 className="mt-3 text-xl font-semibold">아직 저장된 점검이 없습니다.</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted-ink)]">ChatGPT가 조사하고 설명한 결과를 Portfolio에 저장하면 여기에서 계속 확인할 수 있습니다.</p>
                {!ownerUserId && <div className="mt-4 flex flex-wrap gap-2"><button className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold" onClick={() => onNavigate?.('overview')} type="button">자산 입력하기</button><button className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold" onClick={() => onNavigate?.('guide')} type="button">연결 가이드 보기</button></div>}
              </>
            )}
        </div>
      </article>

      {!ownerUserId && <PortfolioIntegritySummary supabase={supabase} />}

      {!ownerUserId && <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold">오늘 이어갈 일</h2><p className="mt-1 text-sm text-[var(--muted-ink)]">ToDo 묶음과 아직 묶지 않은 기존 과제를 중복 없이 보여줍니다.</p></div><button className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" onClick={() => onNavigate?.('tasks')} type="button">전체 보기</button></div>
        {todoOverview.error ? <p className="mt-4 text-sm text-red-100">{todoOverview.error}</p> : todoOverview.bundles.length === 0 && visibleTodoTasks.length === 0 ? <p className="mt-4 text-sm text-[var(--muted-ink)]">현재 이어갈 일이 없습니다.</p> : <div className="mt-4 grid gap-4">
          {todoOverview.bundles.length > 0 && <section><h3 className="text-xs font-semibold text-[var(--muted-ink)]">ToDo 묶음</h3><div className="mt-2 grid gap-2">{todoOverview.bundles.map((bundle) => <button className="min-h-11 rounded-xl bg-[var(--surface-2)] px-3 text-left text-sm font-semibold" key={bundle.id} onClick={() => onNavigate?.('tasks')} type="button">{bundle.title} · {bundle.item_count}개</button>)}</div></section>}
          {visibleTodoTasks.length > 0 && <section><h3 className="text-xs font-semibold text-[var(--muted-ink)]">아직 묶지 않은 과제</h3><div className="mt-2 grid gap-2">{visibleTodoTasks.map((task) => <button className="min-h-11 rounded-xl bg-[var(--surface-2)] px-3 text-left text-sm font-semibold" key={task.id} onClick={() => onOpenTask?.(task.id)} type="button">{task.title}</button>)}</div></section>}
        </div>}
      </article>}

      {error && <p className="rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</p>}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">점검 이력</h2>
        <button className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold text-[var(--muted-ink)] disabled:opacity-60" disabled={loading} onClick={load} type="button">
          {loading ? '불러오는 중' : '새로고침'}
        </button>
      </div>

      {!loading && briefings.length > 0 && (
        <ol className="grid gap-3">
          {briefings.map((briefing) => (
            <li key={briefing.id}>
              <button className="min-h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 text-left transition hover:bg-[var(--surface-2)] sm:p-5" onClick={() => openDetail(briefing.id)} type="button">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <StatusPills briefing={briefing} />
                  <time className="text-xs text-[var(--muted-ink)]">{formatMoment(briefing.analyzed_at)}</time>
                </div>
                <strong className="mt-3 block text-sm leading-6 sm:text-base">{briefing.headline}</strong>
              </button>
            </li>
          ))}
          {nextCursor && <li><button className="min-h-11 w-full rounded-xl border border-[var(--line)] px-4 text-sm font-semibold disabled:opacity-60" disabled={loading} onClick={loadMore} type="button">{loading ? '불러오는 중' : '이전 점검 더 보기'}</button></li>}
        </ol>
      )}

      {selected && <BriefingDetail briefing={selected.headline ? selected : null} loading={detailLoading} onClose={requestDetailClose} />}
    </section>
  )
}
