import { useEffect, useRef, useState } from 'react'

import ModalShell from '../../components/ModalShell'
import { FilterChips, PageToolbar, ViewTabs } from '../../components/PageControls'
import ActivityPage from '../activity/ActivityPage'
import { createRequestGate } from '../../lib/requestGate'
import { useDetailHistoryEntry } from '../../hooks/useDetailHistoryEntry'
import {
  fetchInvestmentDecision,
  fetchInvestmentDecisionPage,
  fetchGeneralTask,
  fetchGeneralTaskPage,
  fetchLinkedTodoTaskIds,
  fetchPortfolioTask,
  fetchPortfolioTaskPage,
  fetchTodoBundle,
  fetchTodoBundlePage,
  recordManualActivity,
  saveGeneralTask,
  saveTodoBundle,
  transitionGeneralTask,
} from './data'

const decisionStatus = { proposed: '제안', adopted: '내가 채택함', dismissed: '채택하지 않음', superseded: '새 판단으로 대체됨' }
const taskStatus = { open: '확인 필요', waiting: '자료 대기', resolved: '답을 확인함', closed: '종료' }
const modeOptions = [{ id: 'tasks', label: '할 일' }, { id: 'decisions', label: '판단 모아보기' }, { id: 'activity', label: '활동 내역' }]
const filterOptions = {
  tasks: [{ id: 'active', label: '미완료' }, { id: 'paused', label: '보류' }, { id: 'closed', label: '종료' }, { id: 'all', label: '전체' }],
  decisions: [{ id: 'current', label: '현재 판단' }, { id: 'closed', label: '종료된 판단' }, { id: 'all', label: '전체' }],
}

function taskStatusLabel(task) {
  if (task.kind === 'general') return { open: '할 일', done: '완료', paused: '보류', cancelled: '취소' }[task.status] ?? task.status
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

function GeneralActionModal({ kind, onClose, onSave, saving }) {
  const [draft, setDraft] = useState({ title: '', result: '', dueDate: '', triggerText: '' })
  const isTask = kind === 'task'
  return <ModalShell onClose={onClose} title={isTask ? '할 일 추가' : '한 일 기록'}>
    <div className="grid gap-4">
      <p className="text-sm leading-6 text-[var(--muted-ink)]">{isTask ? '앞으로 할 일을 등록합니다. 완료하면 실제 행동 기록이 연결됩니다.' : '앱 밖에서 이미 한 행동만 기록합니다. 예정된 일은 할 일로 등록하세요.'}</p>
      <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">{isTask ? '할 일' : '한 일'}</span><input autoFocus className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" onChange={(event) => setDraft({ ...draft, title: event.target.value })} value={draft.title} /></label>
      <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">{isTask ? '확인할 때' : '결과 또는 메모'}</span><textarea className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" onChange={(event) => setDraft({ ...draft, [isTask ? 'triggerText' : 'result']: event.target.value })} rows={3} value={isTask ? draft.triggerText : draft.result} /></label>
      {isTask && <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">예정일</span><input className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} type="date" value={draft.dueDate} /></label>}
      <div className="flex justify-end gap-2"><button className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm" onClick={onClose} type="button">취소</button><button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!draft.title.trim() || saving} onClick={() => onSave(draft)} type="button">{saving ? '저장 중' : '저장'}</button></div>
    </div>
  </ModalShell>
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
    <ModalShell onBack={onBack} onClose={onClose} title={mode === 'decisions' ? '판단 상세' : '할 일 상세'} variant="detail">
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
          <p className="rounded-2xl bg-[var(--surface-2)] p-4 text-sm leading-6 text-[var(--muted-ink)]">{item.kind === 'execution' ? '이 항목은 실행 계획입니다. 연결된 실제 체결만 진행도에 반영되며 계획 자체는 주문이나 체결이 아닙니다.' : item.kind === 'general' ? '이 항목은 앞으로 할 일입니다. 완료하면 실제로 수행한 행동 기록이 별도로 연결됩니다.' : '이 항목은 조사·점검할 질문입니다. 매매 주문이나 체결 기록이 아닙니다.'}</p>
        </div>
      )}
    </ModalShell>
  )
}

function TodoBundleModal({ availableTasks, onClose, onSave, saving }) {
  const [draft, setDraft] = useState({ title: '', summary: '', tags: '', items: '', completed: false, taskIds: [] })
  const valid = draft.title.trim() && (draft.items.split('\n').some((line) => line.trim()) || draft.taskIds.length > 0)
  return <ModalShell onClose={onClose} title="ToDo 묶음 추가">
    <div className="grid gap-4">
      <p className="text-sm leading-6 text-[var(--muted-ink)]">한 번의 작업에서 처리하거나 이어갈 항목을 한 묶음으로 기록합니다. 한 줄이 세부 항목 하나입니다.</p>
      <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">묶음 이름</span><input className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" onChange={(event) => setDraft({ ...draft, title: event.target.value })} value={draft.title} /></label>
      <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">요약</span><textarea className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" onChange={(event) => setDraft({ ...draft, summary: event.target.value })} rows={2} value={draft.summary} /></label>
      <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">세부 항목 · 한 줄에 하나</span><textarea className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" onChange={(event) => setDraft({ ...draft, items: event.target.value })} rows={6} value={draft.items} /></label>
      <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">태그 · 쉼표로 구분</span><input className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" onChange={(event) => setDraft({ ...draft, tags: event.target.value })} value={draft.tags} /></label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input checked={draft.completed} onChange={(event) => setDraft({ ...draft, completed: event.target.checked })} type="checkbox" />이미 수행한 결과로 기록</label>
      {availableTasks.length > 0 && <fieldset><legend className="text-xs text-[var(--muted-ink)]">기존 조사·실행 과제 편입</legend><div className="mt-2 grid gap-2">{availableTasks.map((task) => <label className="flex min-h-11 items-center gap-2 rounded-xl bg-[var(--surface-2)] px-3 text-sm" key={task.id}><input checked={draft.taskIds.includes(task.id)} onChange={() => setDraft({ ...draft, taskIds: draft.taskIds.includes(task.id) ? draft.taskIds.filter((id) => id !== task.id) : [...draft.taskIds, task.id] })} type="checkbox" />{task.title}</label>)}</div></fieldset>}
      <div className="flex justify-end gap-2"><button className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm" onClick={onClose} type="button">취소</button><button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!valid || saving} onClick={() => onSave(draft)} type="button">{saving ? '저장 중' : '묶음 저장'}</button></div>
    </div>
  </ModalShell>
}

function TodoBundleDetail({ bundle, onClose, onOpenTask }) {
  const statusLabel = { in_progress: '진행 중', paused: '보류', completed: '완료', cancelled: '취소' }
  return <ModalShell onClose={onClose} title="ToDo 묶음 상세" variant="detail">
    <div className="grid gap-5">
      <section><span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs">{statusLabel[bundle.status] ?? bundle.status}</span><h3 className="mt-4 text-xl font-semibold">{bundle.title}</h3>{bundle.summary && <p className="mt-2 text-sm text-[var(--muted-ink)]">{bundle.summary}</p>}</section>
      <ol className="grid gap-2">{bundle.items.map((item) => <li className="rounded-2xl bg-[var(--surface-2)] p-3" key={item.id}><div className="flex justify-between gap-3 text-sm">{item.kind === 'task' ? <button className="text-left font-semibold hover:text-[var(--accent)]" onClick={() => onOpenTask(item.task_id)} type="button">{item.task?.title}</button> : <span>{item.title}</span>}<span className="text-xs text-[var(--muted-ink)]">{item.kind === 'task' ? '연결 과제' : item.status}</span></div>{item.result && <p className="mt-1 text-xs text-[var(--muted-ink)]">{item.result}</p>}</li>)}</ol>
      {bundle.tags?.length > 0 && <div className="flex flex-wrap gap-2">{bundle.tags.map((tag) => <span className="rounded-full border border-[var(--line)] px-2 py-1 text-xs" key={tag}>{tag}</span>)}</div>}
    </div>
  </ModalShell>
}

export default function LifecyclePage({ actions = [], activityError = '', activityLoading = false, initialSelection = null, mode, onModeChange, onRefreshActivity, onSelectionHandled, ownerUserId = null, supabase }) {
  const [filterByMode, setFilterByMode] = useState({ decisions: 'current', tasks: 'active' })
  const [items, setItems] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailHistory, setDetailHistory] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [todoBundles, setTodoBundles] = useState([])
  const [todoFilter, setTodoFilter] = useState('active')
  const [linkedTodoTaskIds, setLinkedTodoTaskIds] = useState(new Set())
  const [todoEditorOpen, setTodoEditorOpen] = useState(false)
  const [todoDetail, setTodoDetail] = useState(null)
  const [savingTodo, setSavingTodo] = useState(false)
  const [generalTasks, setGeneralTasks] = useState([])
  const [generalEditor, setGeneralEditor] = useState(null)
  const [savingGeneral, setSavingGeneral] = useState(false)
  const scrollPositions = useRef({})
  const listRequestGate = useRef(createRequestGate())
  const detailRequestGate = useRef(createRequestGate())
  const filter = filterByMode[mode]

  useEffect(() => {
    if (mode !== 'tasks' || ownerUserId) return
    Promise.all([fetchTodoBundlePage(supabase, { filter: todoFilter, limit: 20 }), fetchLinkedTodoTaskIds(supabase)])
      .then(([page, taskIds]) => { setTodoBundles(page.items); setLinkedTodoTaskIds(new Set(taskIds)) })
      .catch((nextError) => setError(nextError.message ?? 'ToDo 묶음을 불러오지 못했습니다.'))
  }, [mode, ownerUserId, supabase, todoFilter])

  useEffect(() => {
    if (mode !== 'tasks' || ownerUserId) return
    fetchGeneralTaskPage(supabase, { filter: 'active', limit: 100 })
      .then((page) => setGeneralTasks(page.items))
      .catch((nextError) => setError(nextError.message ?? '일반 할 일을 불러오지 못했습니다.'))
  }, [mode, ownerUserId, supabase])

  async function saveGeneralAction(draft) {
    setSavingGeneral(true)
    setError('')
    try {
      if (generalEditor === 'task') {
        const saved = await saveGeneralTask(supabase, { ...draft, idempotencyKey: crypto.randomUUID() })
        setGeneralTasks((current) => [saved, ...current])
      } else {
        await recordManualActivity(supabase, { ...draft, idempotencyKey: crypto.randomUUID() })
        onRefreshActivity?.()
      }
      setGeneralEditor(null)
    } catch (nextError) {
      setError(nextError.message ?? '기록을 저장하지 못했습니다.')
    } finally { setSavingGeneral(false) }
  }

  async function completeGeneralTask(task) {
    setError('')
    try {
      await transitionGeneralTask(supabase, task, 'complete')
      setGeneralTasks((current) => current.filter((item) => item.id !== task.id))
      onRefreshActivity?.()
    } catch (nextError) { setError(nextError.message ?? '할 일을 완료하지 못했습니다.') }
  }

  async function createTodo(draft) {
    setSavingTodo(true)
    setError('')
    try {
      const performedAt = draft.completed ? new Date().toISOString() : null
      const bundle = await saveTodoBundle(supabase, {
        idempotencyKey: crypto.randomUUID(), title: draft.title, summary: draft.summary,
        tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        items: [
          ...draft.items.split('\n').map((title) => title.trim()).filter(Boolean).map((title, sortOrder) => ({
          kind: 'general', sort_order: sortOrder, title, status: draft.completed ? 'done' : 'open',
          result: draft.completed ? '완료' : null, performed_at: performedAt,
          })),
          ...draft.taskIds.map((taskId, index) => ({ kind: 'task', task_id: taskId, sort_order: 1000 + index })),
        ],
      })
      setTodoBundles((current) => [bundle, ...current])
      setLinkedTodoTaskIds((current) => new Set([...current, ...draft.taskIds]))
      setTodoEditorOpen(false)
    } catch (nextError) {
      setError(nextError.message ?? 'ToDo 묶음을 저장하지 못했습니다.')
    } finally { setSavingTodo(false) }
  }

  async function openTodo(bundleId) {
    try { setTodoDetail(await fetchTodoBundle(supabase, bundleId)) }
    catch (nextError) { setError(nextError.message ?? 'ToDo 묶음을 불러오지 못했습니다.') }
  }

  function dismissDetail() {
    detailRequestGate.current.invalidate()
    setDetailLoading(false)
    setDetail(null)
    setDetailHistory([])
  }

  const requestDetailClose = useDetailHistoryEntry(Boolean(detail), dismissDetail)

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
    if (mode === 'activity') {
      setLoading(false)
      setItems([])
      setNextCursor(null)
      setDetail(null)
      return undefined
    }
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
  const displayItems = mode === 'tasks' && !ownerUserId ? items.filter((item) => !linkedTodoTaskIds.has(item.id)) : items

  return (
    <section className="grid gap-5">
      <header className="grid gap-3">
        <p className="text-sm leading-6 text-[var(--muted-ink)]">여러 작업의 묶음, 판단 근거, 원본 활동 내역을 한곳에서 이어서 봅니다.</p>
        <PageToolbar>
          <ViewTabs ariaLabel="ToDo 보기 전환" className="grid-cols-3" idBase="lifecycle-view" onChange={changeMode} options={modeOptions} panelId="lifecycle-panel" value={mode} />
        </PageToolbar>
        {mode !== 'activity' && <FilterChips ariaLabel="목록 필터" onChange={(nextFilter) => setFilterByMode((current) => ({ ...current, [mode]: nextFilter }))} options={filterOptions[mode]} value={filter} />}
      </header>

      {mode === 'tasks' && !ownerUserId && <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">지금 할 일</h2><p className="mt-1 text-sm text-[var(--muted-ink)]">해야 할 일과 실제로 한 일을 구분해 기록합니다.</p></div><div className="flex gap-2"><button className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" onClick={() => setGeneralEditor('activity')} type="button">한 일 기록</button><button className="rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white" onClick={() => setGeneralEditor('task')} type="button">할 일 추가</button></div></div>
        {generalTasks.length === 0 ? <p className="mt-4 text-sm text-[var(--muted-ink)]">현재 할 일이 없습니다.</p> : <div className="mt-4 grid gap-2">{generalTasks.map((task) => <div className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--surface-2)] p-3" key={task.id}><button className="min-w-0 flex-1 text-left" onClick={async () => { try { setDetail({ mode: 'tasks', item: await fetchGeneralTask(supabase, task.id) }) } catch (nextError) { setError(nextError.message) } }} type="button"><span className="block truncate text-sm font-semibold">{task.title}</span>{task.due_date && <span className="mt-1 block text-xs text-[var(--muted-ink)]">예정 {formatDate(task.due_date)}</span>}</button><button className="min-h-11 rounded-xl border border-[var(--line)] px-3 text-sm" onClick={() => completeGeneralTask(task)} type="button">완료</button></div>)}</div>}
      </section>}

      {mode === 'tasks' && !ownerUserId && <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
        <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">ToDo 묶음</h2><p className="mt-1 text-sm text-[var(--muted-ink)]">한 번에 한 일과 이어갈 일을 여러 항목으로 모읍니다.</p></div><button className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" onClick={() => setTodoEditorOpen(true)} type="button">묶음 추가</button></div>
        <div className="mt-4"><FilterChips ariaLabel="ToDo 묶음 필터" onChange={setTodoFilter} options={[{ id: 'active', label: '할 일' }, { id: 'completed', label: '완료' }, { id: 'paused', label: '보류' }, { id: 'cancelled', label: '취소' }]} value={todoFilter} /></div>
        {todoBundles.length === 0 ? <p className="mt-4 text-sm text-[var(--muted-ink)]">조건에 맞는 묶음이 없습니다.</p> : <div className="mt-4 grid gap-2">{todoBundles.map((bundle) => <button className="rounded-2xl bg-[var(--surface-2)] p-3 text-left" key={bundle.id} onClick={() => openTodo(bundle.id)} type="button"><div className="flex justify-between gap-3"><span className="text-sm font-semibold">{bundle.title}</span><span className="text-xs text-[var(--muted-ink)]">{bundle.item_count ?? bundle.items?.length ?? 0}개 · {{ in_progress: '진행 중', paused: '보류', completed: '완료', cancelled: '취소' }[bundle.status] ?? bundle.status}</span></div></button>)}</div>}
      </section>}

      <div aria-labelledby={`lifecycle-view-${mode}`} className="grid gap-5" id="lifecycle-panel" role="tabpanel" tabIndex={0}>
      {mode === 'activity' ? <ActivityPage actions={actions} error={activityError} loading={activityLoading} onRefresh={onRefreshActivity} /> : <>
      {mode === 'tasks' && <h2 className="text-sm font-semibold text-[var(--muted-ink)]">기존 조사·실행 과제</h2>}
      {error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100"><span>{error}</span><button className="min-h-11 rounded-xl border border-red-400/40 px-3" onClick={() => loadPage()} type="button">다시 시도</button></div>}
      {loading ? <p className="py-8 text-sm text-[var(--muted-ink)]">기록을 불러오는 중입니다.</p> : displayItems.length === 0 ? <EmptyState mode={mode} /> : (
        <div className="grid gap-3">
          {displayItems.map((item) => (
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
      </>}
      </div>
      {detail && <Detail entry={detail} loading={detailLoading} onBack={detailHistory.length ? () => { detailRequestGate.current.invalidate(); setDetailLoading(false); setDetail(detailHistory[detailHistory.length - 1]); setDetailHistory((history) => history.slice(0, -1)) } : null} onClose={requestDetailClose} onOpenDecision={(id) => openDetail('decisions', id)} onOpenTask={(id) => openDetail('tasks', id)} />}
      {todoEditorOpen && <TodoBundleModal availableTasks={displayItems} onClose={() => setTodoEditorOpen(false)} onSave={createTodo} saving={savingTodo} />}
      {todoDetail && <TodoBundleDetail bundle={todoDetail} onClose={() => setTodoDetail(null)} onOpenTask={(id) => { setTodoDetail(null); openDetail('tasks', id) }} />}
      {generalEditor && <GeneralActionModal kind={generalEditor} onClose={() => setGeneralEditor(null)} onSave={saveGeneralAction} saving={savingGeneral} />}
    </section>
  )
}
