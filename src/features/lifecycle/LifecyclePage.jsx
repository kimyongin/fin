import { useEffect, useRef, useState } from 'react'

import ModalShell from '../../components/ModalShell'
import { FilterChips, PageToolbar, ViewTabs } from '../../components/PageControls'
import { createRequestGate } from '../../lib/requestGate'
import {
  fetchInvestmentDecision,
  fetchInvestmentDecisionPage,
  fetchPortfolioTask,
  fetchPortfolioTaskPage,
} from './data'

const decisionStatus = { proposed: '제안', adopted: '내가 채택함', dismissed: '채택하지 않음', superseded: '새 판단으로 대체됨' }
const taskStatus = { open: '확인 필요', waiting: '자료 대기', resolved: '답을 확인함', closed: '종료' }
const modeOptions = [{ id: 'tasks', label: '할 일' }, { id: 'decisions', label: '판단 기록' }]
const filterOptions = {
  tasks: [{ id: 'active', label: '미완료' }, { id: 'paused', label: '보류' }, { id: 'closed', label: '종료' }, { id: 'all', label: '전체' }],
  decisions: [{ id: 'current', label: '현재 판단' }, { id: 'closed', label: '종료된 판단' }, { id: 'all', label: '전체' }],
}

function taskStatusLabel(task) {
  if (task.kind === 'execution') {
    if (task.control_state === 'paused') return '보류'
    if (task.control_state === 'cancelled') return '취소'
    return { planned: '실행 예정', partial: '일부 체결', completed: '체결 완료' }[task.execution_plan?.progress] ?? '실행 예정'
  }
  if (task.research_state === 'closed') return taskStatus.closed
  if (task.control_state === 'paused') return '보류'
  if (task.control_state === 'cancelled') return '취소'
  return taskStatus[task.research_state] ?? task.research_state
}

function formatDate(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(value))
}

function subjectLabel(subject) {
  if (!subject || subject.kind === 'portfolio') return '전체 포트폴리오'
  return subject.label || subject.instrument_id || '대상 종목'
}

function EmptyState({ mode }) {
  return (
    <article className="rounded-[28px] border border-dashed border-[var(--line)] bg-[var(--panel)] p-7 text-center">
      <h2 className="text-lg font-semibold">조건에 맞는 {mode === 'decisions' ? '판단' : '할 일'}이 없습니다.</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--muted-ink)]">
        {mode === 'decisions' ? 'ChatGPT에게 “이 판단을 기록해줘”라고 명시하면 제안과 내가 채택한 결정을 구분해 저장합니다.' : '판단과 함께 다음에 확인할 질문을 기록하면 이곳에서 이어서 볼 수 있습니다.'}
      </p>
    </article>
  )
}

function Detail({ entry, loading, onBack, onClose, onOpenDecision, onOpenTask }) {
  const { item, mode } = entry ?? {}
  const latestTaskHistory = mode === 'tasks' && item?.history?.length ? item.history[item.history.length - 1] : null
  return (
    <ModalShell onClose={onClose} title={mode === 'decisions' ? '판단 상세' : '할 일 상세'}>
      {onBack && <button className="mb-4 rounded-xl border border-[var(--line)] px-3 py-2 text-sm" onClick={onBack} type="button">이전 기록으로</button>}
      {loading || !item ? <p className="py-8 text-sm text-[var(--muted-ink)]">불러오는 중입니다.</p> : mode === 'decisions' ? (
        <div className="grid gap-6">
          <section>
            <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs">{decisionStatus[item.status] ?? item.status}</span>
            <h3 className="mt-4 break-words text-xl font-semibold leading-8">{item.question}</h3>
            <p className="mt-2 text-xs text-[var(--muted-ink)]">{subjectLabel(item.subject)} · {formatDate(item.created_at)}</p>
          </section>
          {item.selected_option && <section><h4 className="text-sm font-semibold">선택</h4><p className="mt-2 text-sm leading-6">{item.selected_option}</p></section>}
          {item.reason && <section><h4 className="text-sm font-semibold">선택한 이유</h4><p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">{item.reason}</p></section>}
          {item.uncertainty && <section><h4 className="text-sm font-semibold">아직 불확실한 점</h4><p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">{item.uncertainty}</p></section>}
          {item.review_condition && <section><h4 className="text-sm font-semibold">다시 볼 조건</h4><p className="mt-2 text-sm leading-6">{item.review_condition}</p></section>}
          {item.tasks?.length > 0 && (
            <section>
              <h4 className="text-sm font-semibold">연결된 할 일</h4>
              <ul className="mt-2 grid gap-2">{item.tasks.map((task) => <li key={task.id}><button className="w-full rounded-2xl bg-[var(--surface-2)] p-3 text-left text-sm hover:bg-[var(--surface-3)]" onClick={() => onOpenTask(task.id)} type="button">{task.title}</button></li>)}</ul>
            </section>
          )}
        </div>
      ) : (
        <div className="grid gap-6">
          <section>
            <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs">{taskStatusLabel(item)}</span>
            <h3 className="mt-4 break-words text-xl font-semibold leading-8">{item.title}</h3>
            <p className="mt-2 text-xs text-[var(--muted-ink)]">{subjectLabel(item.subject)}</p>
          </section>
          {item.trigger_text && <section><h4 className="text-sm font-semibold">확인할 때</h4><p className="mt-2 text-sm leading-6">{item.trigger_text}</p></section>}
          {item.due_date && <section><h4 className="text-sm font-semibold">예정일</h4><p className="mt-2 text-sm">{formatDate(item.due_date)}</p></section>}
          {item.execution_plan && <section><h4 className="text-sm font-semibold">체결 진행</h4><p className="mt-2 text-sm leading-6">{item.execution_plan.side === 'buy' ? '매수' : '매도'} {Number(item.execution_plan.filled_quantity).toLocaleString()} / {Number(item.execution_plan.target_quantity).toLocaleString()}주</p>{Number(item.execution_plan.overfilled_quantity) > 0 && <p className="mt-1 text-xs text-[var(--muted-ink)]">계획보다 {Number(item.execution_plan.overfilled_quantity).toLocaleString()}주 더 체결됨</p>}</section>}
          {latestTaskHistory?.answer && <section><h4 className="text-sm font-semibold">확인한 답</h4><p className="mt-2 text-sm leading-6">{latestTaskHistory.answer}</p></section>}
          {latestTaskHistory?.evidence?.length > 0 && (
            <section>
              <h4 className="text-sm font-semibold">확인 근거</h4>
              <ul className="mt-2 grid gap-2">{latestTaskHistory.evidence.map((evidence) => <li className="rounded-2xl bg-[var(--surface-2)] p-3" key={evidence.id}><a className="break-words text-sm font-semibold text-[var(--accent)] underline" href={evidence.source_url} rel="noreferrer" target="_blank">{evidence.title}</a><p className="mt-1 break-words text-sm leading-6 text-[var(--muted-ink)]">{evidence.summary}</p></li>)}</ul>
            </section>
          )}
          {item.decision_ids?.length > 0 && (
            <section>
              <h4 className="text-sm font-semibold">연결된 판단</h4>
              <div className="mt-2 flex flex-wrap gap-2">{item.decision_ids.map((decisionId, index) => <button className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" key={decisionId} onClick={() => onOpenDecision(decisionId)} type="button">판단 {index + 1} 보기</button>)}</div>
            </section>
          )}
          <p className="rounded-2xl bg-[var(--surface-2)] p-4 text-sm leading-6 text-[var(--muted-ink)]">{item.kind === 'execution' ? '이 항목은 실행 계획입니다. 연결된 실제 체결만 진행도에 반영되며 계획 자체는 주문이나 체결이 아닙니다.' : '이 항목은 조사·점검할 질문입니다. 매매 주문이나 체결 기록이 아닙니다.'}</p>
        </div>
      )}
    </ModalShell>
  )
}

export default function LifecyclePage({ initialSelection = null, mode, onModeChange, onSelectionHandled, ownerUserId = null, supabase }) {
  const [filterByMode, setFilterByMode] = useState({ decisions: 'current', tasks: 'active' })
  const [items, setItems] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailHistory, setDetailHistory] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const scrollPositions = useRef({})
  const listRequestGate = useRef(createRequestGate())
  const detailRequestGate = useRef(createRequestGate())
  const filter = filterByMode[mode]

  async function loadPage({ append = false, cursor = null } = {}) {
    const request = listRequestGate.current.begin()
    append ? setLoadingMore(true) : setLoading(true)
    setError('')
    try {
      const page = mode === 'decisions'
        ? await fetchInvestmentDecisionPage(supabase, { cursor, filter, ownerUserId })
        : await fetchPortfolioTaskPage(supabase, { cursor, filter, ownerUserId })
      if (!request.isCurrent()) return
      setItems((current) => append ? [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()] : page.items)
      setNextCursor(page.nextCursor)
      if (!append) requestAnimationFrame(() => window.scrollTo(0, scrollPositions.current[mode] ?? 0))
    } catch (nextError) {
      if (!request.isCurrent()) return
      setError(nextError.message ?? '기록을 불러오지 못했습니다.')
    } finally {
      if (request.isCurrent()) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }

  useEffect(() => {
    const requestToken = listRequestGate.current.begin()
    detailRequestGate.current.invalidate()
    setLoading(true)
    setLoadingMore(false)
    setError('')
    setItems([])
    setNextCursor(null)
    const pageRequest = mode === 'decisions'
      ? fetchInvestmentDecisionPage(supabase, { filter, ownerUserId })
      : fetchPortfolioTaskPage(supabase, { filter, ownerUserId })
    pageRequest.then((page) => {
      if (!requestToken.isCurrent()) return
      setItems(page.items)
      setNextCursor(page.nextCursor)
      requestAnimationFrame(() => window.scrollTo(0, scrollPositions.current[mode] ?? 0))
    }).catch((nextError) => {
      if (requestToken.isCurrent()) setError(nextError.message ?? '기록을 불러오지 못했습니다.')
    }).finally(() => {
      if (requestToken.isCurrent()) setLoading(false)
    })
    setDetail(null)
    setDetailHistory([])
    return () => {
      listRequestGate.current.invalidate()
      detailRequestGate.current.invalidate()
    }
  }, [filter, mode, ownerUserId, supabase])

  async function openDetail(targetMode, id) {
    const request = detailRequestGate.current.begin()
    const previous = detail?.item ? detail : null
    setDetailLoading(true)
    setDetail({ mode: targetMode, item: null })
    setError('')
    try {
      const item = targetMode === 'decisions'
        ? await fetchInvestmentDecision(supabase, id, ownerUserId)
        : await fetchPortfolioTask(supabase, id, ownerUserId)
      if (!request.isCurrent()) return
      if (previous) setDetailHistory((history) => [...history, previous])
      setDetail({ mode: targetMode, item })
    } catch (nextError) {
      if (!request.isCurrent()) return
      setDetail(previous)
      setError(nextError.message ?? '상세 기록을 불러오지 못했습니다.')
    } finally {
      if (request.isCurrent()) setDetailLoading(false)
    }
  }

  useEffect(() => {
    if (!initialSelection || initialSelection.mode !== mode) return
    openDetail(initialSelection.mode, initialSelection.id)
    onSelectionHandled?.()
  }, [initialSelection, mode, onSelectionHandled])

  function changeMode(nextMode) {
    scrollPositions.current[mode] = window.scrollY
    onModeChange(nextMode)
  }

  return (
    <section className="grid gap-5">
      <header className="grid gap-3">
        <p className="text-sm leading-6 text-[var(--muted-ink)]">저장한 판단과 다음에 확인하거나 실행할 일을 이어서 봅니다.</p>
        <PageToolbar>
          <ViewTabs ariaLabel="판단과 할 일 전환" className="grid-cols-2" idBase="lifecycle-view" onChange={changeMode} options={modeOptions} panelId="lifecycle-panel" value={mode} />
        </PageToolbar>
        <FilterChips ariaLabel="목록 필터" onChange={(nextFilter) => setFilterByMode((current) => ({ ...current, [mode]: nextFilter }))} options={filterOptions[mode]} value={filter} />
      </header>

      <div aria-labelledby={`lifecycle-view-${mode}`} className="grid gap-5" id="lifecycle-panel" role="tabpanel" tabIndex={0}>
      {error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100"><span>{error}</span><button className="min-h-11 rounded-xl border border-red-400/40 px-3" onClick={() => loadPage()} type="button">다시 시도</button></div>}
      {loading ? <p className="py-8 text-sm text-[var(--muted-ink)]">기록을 불러오는 중입니다.</p> : items.length === 0 ? <EmptyState mode={mode} /> : (
        <div className="grid gap-3">
          {items.map((item) => (
            <button className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 text-left transition hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] sm:p-5" key={item.id} onClick={() => openDetail(mode, item.id)} type="button">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-[var(--muted-ink)]">{subjectLabel(item.subject)}</span><span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs">{mode === 'decisions' ? decisionStatus[item.status] : taskStatusLabel(item)}</span></div>
              <h3 className="mt-3 break-words font-semibold leading-6">{mode === 'decisions' ? item.question : item.title}</h3>
              {mode === 'decisions' && item.selected_option && <p className="mt-2 text-sm text-[var(--accent)]">{item.selected_option}</p>}
              <p className="mt-3 text-xs text-[var(--muted-ink)]">{item.due_date ? `예정 ${formatDate(item.due_date)}` : `갱신 ${formatDate(item.updated_at)}`}</p>
            </button>
          ))}
          {nextCursor && <button className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-semibold disabled:opacity-50" disabled={loadingMore} onClick={() => loadPage({ append: true, cursor: nextCursor })} type="button">{loadingMore ? '불러오는 중' : '더 보기'}</button>}
        </div>
      )}
      </div>
      {detail && <Detail entry={detail} loading={detailLoading} onBack={detailHistory.length ? () => { detailRequestGate.current.invalidate(); setDetailLoading(false); setDetail(detailHistory[detailHistory.length - 1]); setDetailHistory((history) => history.slice(0, -1)) } : null} onClose={() => { detailRequestGate.current.invalidate(); setDetailLoading(false); setDetail(null); setDetailHistory([]) }} onOpenDecision={(id) => openDetail('decisions', id)} onOpenTask={(id) => openDetail('tasks', id)} />}
    </section>
  )
}
