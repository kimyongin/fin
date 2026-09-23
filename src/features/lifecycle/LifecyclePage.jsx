import { useEffect, useRef, useState } from 'react'

import ModalShell from '../../components/ModalShell'
import { FilterChips } from '../../components/PageControls'
import ActivityDetailModal from './ActivityDetailModal'
import ActivityTagPicker from './ActivityTagPicker'
import ActionTimeline from './ActionTimeline'
import { createRequestGate } from '../../lib/requestGate'
import { useDetailHistoryEntry } from '../../hooks/useDetailHistoryEntry'
import {
  fetchInvestmentDecision,
  fetchInvestmentDecisionPage,
  fetchGeneralTask,
  fetchActivity,
  fetchActivityTags,
  fetchPortfolioTask,
  fetchPortfolioTaskPage,
  recordManualActivity,
  saveGeneralTask,
  setActivityTags,
  setGeneralTaskTags,
  transitionGeneralTask,
} from './data'

const decisionStatus = { proposed: '제안', adopted: '내가 채택함', dismissed: '채택하지 않음', superseded: '새 판단으로 대체됨' }
const taskStatus = { open: '확인 필요', waiting: '자료 대기', resolved: '답을 확인함', closed: '종료' }
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

function GeneralActionModal({ kind, onClose, onKindChange, onSave, onTagsChanged, saving, supabase, tags }) {
  const today = new Date().toLocaleDateString('en-CA')
  const [draft, setDraft] = useState({ title: '', result: '', scheduleDate: '', occurredOn: today, triggerText: '', recurrenceKind: 'none', category: 'general', scope: '', sourceTitle: '', sourceUrl: '', tagIds: [] })
  const isTask = kind === 'task'
  const sourceComplete = (!draft.sourceTitle.trim() && !draft.sourceUrl.trim()) || Boolean(draft.sourceTitle.trim() && /^https?:\/\/\S+$/i.test(draft.sourceUrl.trim()))

  function setAlreadyDone(checked) {
    if (checked) {
      setDraft((current) => ({ ...current, scheduleDate: '', recurrenceKind: 'none' }))
      onKindChange('activity')
      return
    }
    onKindChange('task')
  }

  function submit() {
    const scope = draft.scope.trim()
    const sourceUrl = draft.sourceUrl.trim()
    const context = !isTask && (scope || sourceUrl) ? {
      ...(scope ? { scope } : {}),
      ...(sourceUrl ? { sources: [{ title: draft.sourceTitle.trim(), url: sourceUrl }] } : {}),
    } : null
    onSave({
      ...draft,
      context,
      dueDate: isTask && draft.recurrenceKind !== 'daily' ? draft.scheduleDate : '',
      recurrenceStartOn: isTask && draft.recurrenceKind === 'daily' ? (draft.scheduleDate || today) : null,
    })
  }

  return <ModalShell onClose={onClose} title="활동 추가">
    <div className="grid gap-4">
      <p className="text-sm leading-6 text-[var(--muted-ink)]">{isTask ? '앞으로 할 일을 등록합니다. 완료하면 실제 활동 기록이 연결됩니다.' : '앱 밖에서 이미 한 일을 기록합니다.'}</p>
      <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">{isTask ? '할 일' : '한 일'}</span><input autoFocus className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" onChange={(event) => setDraft({ ...draft, title: event.target.value })} value={draft.title} /></label>
      <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">{isTask ? '확인할 때' : '결과 또는 메모'}</span><textarea className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" onChange={(event) => setDraft({ ...draft, [isTask ? 'triggerText' : 'result']: event.target.value })} rows={3} value={isTask ? draft.triggerText : draft.result} /></label>
      <fieldset>
        <legend className="text-xs text-[var(--muted-ink)]">옵션</legend>
        <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
          <label className={`flex min-h-11 items-center gap-2 text-sm ${isTask ? '' : 'text-[var(--muted-ink)]'}`}><input checked={isTask && draft.recurrenceKind === 'daily'} disabled={!isTask} onChange={(event) => setDraft({ ...draft, recurrenceKind: event.target.checked ? 'daily' : 'none' })} type="checkbox" />매일 반복</label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input checked={!isTask} onChange={(event) => setAlreadyDone(event.target.checked)} type="checkbox" />이미 했음</label>
        </div>
      </fieldset>
      {isTask && <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">{draft.recurrenceKind === 'daily' ? '반복 시작일' : '예정일'}</span><input className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" onChange={(event) => setDraft({ ...draft, scheduleDate: event.target.value })} type="date" value={draft.recurrenceKind === 'daily' ? (draft.scheduleDate || today) : draft.scheduleDate} /></label>}
      {!isTask && <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">수행일</span><input className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" max={today} onChange={(event) => setDraft({ ...draft, occurredOn: event.target.value })} type="date" value={draft.occurredOn} /></label>}
      {!isTask && <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">활동 종류 (선택)</span><select className="min-h-11 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" onChange={(event) => setDraft({ ...draft, category: event.target.value })} value={draft.category}><option value="general">일반</option><option value="research">조사</option><option value="review">점검</option><option value="decision">판단</option><option value="retrospective">회고</option></select></label>}
      {!isTask && <section className="grid gap-3 rounded-2xl border border-[var(--line)] p-3"><p className="text-xs text-[var(--muted-ink)]">조사 범위와 출처 (선택)</p><label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">확인한 범위</span><input className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" maxLength={2000} onChange={(event) => setDraft({ ...draft, scope: event.target.value })} placeholder="예: 보유 종목의 오늘 공시" value={draft.scope} /></label><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">출처 제목</span><input className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" maxLength={300} onChange={(event) => setDraft({ ...draft, sourceTitle: event.target.value })} value={draft.sourceTitle} /></label><label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">출처 URL</span><input className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" maxLength={2000} onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })} placeholder="https://" type="url" value={draft.sourceUrl} /></label></div>{!sourceComplete && <p className="text-xs text-red-200">출처 제목과 http(s) URL을 함께 입력하세요.</p>}</section>}
      <ActivityTagPicker disabled={saving} onChange={(tagIds) => setDraft({ ...draft, tagIds })} onTagsChanged={(nextTags, tagIds) => { onTagsChanged(nextTags); setDraft((current) => ({ ...current, tagIds })) }} selectedIds={draft.tagIds} supabase={supabase} tags={tags} />
      <div className="flex justify-end gap-2"><button className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm" onClick={onClose} type="button">취소</button><button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!draft.title.trim() || saving || !sourceComplete} onClick={submit} type="button">{saving ? '저장 중' : '저장'}</button></div>
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

function Detail({ entry, loading, onBack, onClose, onEndGeneralTask, onOpenDecision, onOpenTask }) {
  const { item, mode } = entry ?? {}
  const latestTaskHistory = mode === 'tasks' && item?.history?.length ? item.history[item.history.length - 1] : null
  const [confirmEnding, setConfirmEnding] = useState(false)
  const [ending, setEnding] = useState(false)
  const [endError, setEndError] = useState('')
  useEffect(() => { setConfirmEnding(false); setEndError('') }, [item?.id])

  async function endRepeat() {
    setEnding(true); setEndError('')
    try { await onEndGeneralTask(item) }
    catch (error) { setEndError(error.message ?? '반복을 종료하지 못했습니다.') }
    finally { setEnding(false) }
  }
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
          {item.kind === 'general' && item.recurrence_kind === 'daily' && item.control_state === 'active' && onEndGeneralTask && <section className="rounded-2xl border border-[var(--line)] p-4"><h4 className="text-sm font-semibold">매일 반복</h4><p className="mt-1 text-sm text-[var(--muted-ink)]">앞으로 표시되는 반복만 종료합니다. 이미 완료한 날짜의 활동은 그대로 남습니다.</p>{endError && <p className="mt-2 text-sm text-red-300">{endError}</p>}<div className="mt-3 flex flex-wrap gap-2">{confirmEnding ? <><button className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" disabled={ending} onClick={() => setConfirmEnding(false)} type="button">취소</button><button className="rounded-xl border border-red-400/40 px-3 py-2 text-sm text-red-300 disabled:opacity-50" disabled={ending} onClick={endRepeat} type="button">{ending ? '종료 중' : '반복 종료 확인'}</button></> : <button className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" onClick={() => setConfirmEnding(true)} type="button">반복 종료</button>}</div></section>}
          <p className="rounded-2xl bg-[var(--surface-2)] p-4 text-sm leading-6 text-[var(--muted-ink)]">{item.kind === 'execution' ? '이 항목은 실행 계획입니다. 연결된 실제 체결만 진행도에 반영되며 계획 자체는 주문이나 체결이 아닙니다.' : item.kind === 'general' ? '이 항목은 앞으로 할 일입니다. 완료하면 실제로 수행한 활동 기록이 별도로 연결됩니다.' : '이 항목은 조사·점검할 질문입니다. 매매 주문이나 체결 기록이 아닙니다.'}</p>
        </div>
      )}
    </ModalShell>
  )
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
  const [generalEditor, setGeneralEditor] = useState(null)
  const [savingGeneral, setSavingGeneral] = useState(false)
  const [actionRefreshKey, setActionRefreshKey] = useState(0)
  const [activityTags, setActivityTagsState] = useState([])
  const [activityDetail, setActivityDetail] = useState(null)
  const [activityDetailLoading, setActivityDetailLoading] = useState(false)
  const scrollPositions = useRef({})
  const listRequestGate = useRef(createRequestGate())
  const detailRequestGate = useRef(createRequestGate())
  const effectiveMode = 'tasks'
  const filter = filterByMode[effectiveMode]

  async function saveGeneralAction(draft) {
    setSavingGeneral(true)
    setError('')
    try {
      if (generalEditor === 'task') {
        const task = await saveGeneralTask(supabase, { ...draft, idempotencyKey: crypto.randomUUID() })
        if (draft.tagIds.length > 0) await setGeneralTaskTags(supabase, task, draft.tagIds)
      } else {
        const occurredAt = draft.occurredOn && draft.occurredOn !== new Date().toLocaleDateString('en-CA')
          ? `${draft.occurredOn}T12:00:00+09:00`
          : null
        const activity = await recordManualActivity(supabase, { ...draft, occurredAt, idempotencyKey: crypto.randomUUID() })
        if (draft.tagIds.length > 0) await setActivityTags(supabase, activity, draft.tagIds)
        onRefreshActivity?.()
      }
      setActionRefreshKey((value) => value + 1)
      setGeneralEditor(null)
    } catch (nextError) {
      setError(nextError.message ?? '기록을 저장하지 못했습니다.')
    } finally { setSavingGeneral(false) }
  }

  useEffect(() => {
    if (ownerUserId) return
    fetchActivityTags(supabase).then(setActivityTagsState).catch(() => setActivityTagsState([]))
  }, [ownerUserId, supabase])

  async function completeGeneralTask(task) {
    setError('')
    try {
      await transitionGeneralTask(supabase, task, 'complete', { occurrenceOn: task.occurrence_on })
      setActionRefreshKey((value) => value + 1)
      onRefreshActivity?.()
    } catch (nextError) { setError(nextError.message ?? '할 일을 완료하지 못했습니다.') }
  }

  async function endGeneralTask(task) {
    await transitionGeneralTask(supabase, task, 'cancel', { reason: '사용자가 반복 종료' })
    setActionRefreshKey((value) => value + 1)
    onRefreshActivity?.()
    dismissDetail()
  }

  async function openActivity(action) {
    setActivityDetailLoading(true)
    setError('')
    setActivityDetail(action)
    try {
      setActivityDetail(await fetchActivity(supabase, action.id, ownerUserId))
    } catch (nextError) {
      setActivityDetail(null)
      setError(nextError.message ?? '활동을 불러오지 못했습니다.')
    } finally { setActivityDetailLoading(false) }
  }

  async function refreshActivityDetail(saved, options = {}) {
    setActivityDetail(saved)
    setActionRefreshKey((value) => value + 1)
    onRefreshActivity?.()
    if (options.reload || !saved?.follow_up_tasks) {
      try { setActivityDetail(await fetchActivity(supabase, saved.id, ownerUserId)) } catch { /* 목록 새로고침으로 복구 */ }
    }
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

  async function openActionTask(task) {
    if (task.kind !== 'general') return openDetail('tasks', task.id)
    const request = detailRequestGate.current.begin()
    setDetailLoading(true)
    setDetail({ mode: 'tasks', item: null })
    setError('')
    try {
      const item = await fetchGeneralTask(supabase, task.id)
      if (request.isCurrent()) setDetail({ mode: 'tasks', item })
    } catch (nextError) {
      if (request.isCurrent()) { setDetail(null); setError(nextError.message ?? '할 일을 불러오지 못했습니다.') }
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
  const displayItems = items

  return (
    <section className="grid gap-5">
      <header className="grid gap-3">
        <p className="text-sm leading-6 text-[var(--muted-ink)]">해야 할 일과 실제로 수행한 활동, 그 근거가 된 판단을 한곳에서 이어서 봅니다.</p>
        {!ownerUserId && <a className="w-fit text-xs text-[var(--muted-ink)] underline hover:text-[var(--ink)]" href="#tasks">활동에서 조사 보기</a>}
      </header>

      <div aria-labelledby={`lifecycle-view-${effectiveMode}`} className="grid gap-5" id="lifecycle-panel" role="tabpanel" tabIndex={0}>
      {effectiveMode === 'tasks' ? <ActionTimeline
        onAdd={() => setGeneralEditor('task')}
        onCompleteGeneralTask={completeGeneralTask}
        onOpenActivity={openActivity}
        onOpenTask={openActionTask}
        ownerUserId={ownerUserId}
        refreshKey={actionRefreshKey}
        supabase={supabase}
      /> : <>
      {error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100"><span>{error}</span><button className="min-h-11 rounded-xl border border-red-400/40 px-3" onClick={() => loadPage()} type="button">다시 시도</button></div>}
      {loading ? <p className="py-8 text-sm text-[var(--muted-ink)]">기록을 불러오는 중입니다.</p> : displayItems.length === 0 ? <EmptyState mode={effectiveMode} /> : (
        <div className="grid gap-3">
          {displayItems.map((item) => (
            <button className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 text-left transition hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] sm:p-5" key={item.id} onClick={() => openDetail('decisions', item.id)} type="button">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-[var(--muted-ink)]">{subjectLabel(item.subject)}</span><span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs">{decisionStatus[item.status]}</span></div>
              <h3 className="mt-3 break-words font-semibold leading-6">{item.question}</h3>
              {item.selected_option && <p className="mt-2 text-sm text-[var(--accent)]">{item.selected_option}</p>}
              <p className="mt-3 text-xs text-[var(--muted-ink)]">{item.due_date ? `예정 ${formatDate(item.due_date)}` : `갱신 ${formatDate(item.updated_at)}`}</p>
            </button>
          ))}
          {nextCursor && <button className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-semibold disabled:opacity-50" disabled={loadingMore} onClick={() => loadPage({ append: true, cursor: nextCursor })} type="button">{loadingMore ? '불러오는 중' : '더 보기'}</button>}
        </div>
      )}
      </>}
      </div>
      {detail && <Detail entry={detail} loading={detailLoading} onBack={detailHistory.length ? () => { detailRequestGate.current.invalidate(); setDetailLoading(false); setDetail(detailHistory[detailHistory.length - 1]); setDetailHistory((history) => history.slice(0, -1)) } : null} onClose={requestDetailClose} onEndGeneralTask={ownerUserId ? null : endGeneralTask} onOpenDecision={(id) => openDetail('decisions', id)} onOpenTask={(id) => openDetail('tasks', id)} />}
      {activityDetail && <ActivityDetailModal activity={activityDetail} loading={activityDetailLoading} onClose={() => setActivityDetail(null)} onDeleted={() => { setActivityDetail(null); setActionRefreshKey((value) => value + 1) }} onOpenDecision={(id) => { setActivityDetail(null); openDetail('decisions', id) }} onOpenTask={(id) => { setActivityDetail(null); openDetail('tasks', id) }} onSaved={refreshActivityDetail} ownerUserId={ownerUserId} supabase={supabase} />}
      {generalEditor && <GeneralActionModal kind={generalEditor} onClose={() => setGeneralEditor(null)} onKindChange={setGeneralEditor} onSave={saveGeneralAction} onTagsChanged={setActivityTagsState} saving={savingGeneral} supabase={supabase} tags={activityTags} />}
    </section>
  )
}
