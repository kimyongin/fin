import { useEffect, useRef, useState } from 'react'

import ModalShell from '../../components/ModalShell'
import ActivityDetailModal from './ActivityDetailModal'
import ActivityTagPicker from './ActivityTagPicker'
import ActionTimeline from './ActionTimeline'
import DecisionActivitiesPage from './DecisionActivitiesPage'
import { createRequestGate } from '../../lib/requestGate'
import { activityNoon, businessDate } from '../../lib/businessDate'
import { useDetailHistoryEntry } from '../../hooks/useDetailHistoryEntry'
import {
  fetchActivity,
  fetchActivityTags,
  fetchPortfolioTask,
  recordManualActivity,
  saveGeneralTask,
  transitionGeneralTask,
} from './data'

function taskStatusLabel(task) {
  return { open: '할 일', done: '완료', cancelled: '취소' }[task.status] ?? task.status
}

function GeneralActionModal({ kind, onClose, onKindChange, onSave, onTagsChanged, saving, supabase, tags }) {
  const today = businessDate()
  const [draft, setDraft] = useState({ title: '', result: '', scheduleDate: '', occurredOn: today, triggerText: '', recurrenceKind: 'none', category: 'general', decisionState: 'proposed', selectedOption: '', reason: '', scope: '', sourceTitle: '', sourceUrl: '', tagIds: [] })
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
    const context = !isTask && (scope || sourceUrl || draft.category === 'decision') ? {
      ...(scope ? { scope } : {}),
      ...(sourceUrl ? { sources: [{ title: draft.sourceTitle.trim(), url: sourceUrl }] } : {}),
      ...(draft.category === 'decision' ? { decision_state: draft.decisionState } : {}),
      ...(draft.category === 'decision' && draft.decisionState === 'adopted' ? { selected_option: draft.selectedOption.trim(), reason: draft.reason.trim() } : {}),
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
      {!isTask && draft.category === 'decision' && <section className="grid gap-3 rounded-2xl border border-[var(--line)] p-3"><label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">판단 구분</span><select className="min-h-11 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" onChange={(event) => setDraft({ ...draft, decisionState: event.target.value })} value={draft.decisionState}><option value="proposed">제안</option><option value="adopted">내가 채택함</option><option value="dismissed">채택하지 않음</option></select></label>{draft.decisionState === 'adopted' && <><label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">선택한 안</span><input className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" onChange={(event) => setDraft({ ...draft, selectedOption: event.target.value })} value={draft.selectedOption} /></label><label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">선택한 이유</span><textarea className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" onChange={(event) => setDraft({ ...draft, reason: event.target.value })} rows={2} value={draft.reason} /></label></>}</section>}
      {!isTask && <section className="grid gap-3 rounded-2xl border border-[var(--line)] p-3"><p className="text-xs text-[var(--muted-ink)]">조사 범위와 출처 (선택)</p><label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">확인한 범위</span><input className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" maxLength={2000} onChange={(event) => setDraft({ ...draft, scope: event.target.value })} placeholder="예: 보유 종목의 오늘 공시" value={draft.scope} /></label><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">출처 제목</span><input className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" maxLength={300} onChange={(event) => setDraft({ ...draft, sourceTitle: event.target.value })} value={draft.sourceTitle} /></label><label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">출처 URL</span><input className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" maxLength={2000} onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })} placeholder="https://" type="url" value={draft.sourceUrl} /></label></div>{!sourceComplete && <p className="text-xs text-red-200">출처 제목과 http(s) URL을 함께 입력하세요.</p>}</section>}
      <ActivityTagPicker disabled={saving} onChange={(tagIds) => setDraft({ ...draft, tagIds })} onTagsChanged={(nextTags, tagIds) => { onTagsChanged(nextTags); setDraft((current) => ({ ...current, tagIds })) }} selectedIds={draft.tagIds} supabase={supabase} tags={tags} />
      <div className="flex justify-end gap-2"><button className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm" onClick={onClose} type="button">취소</button><button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!draft.title.trim() || saving || !sourceComplete || (draft.category === 'decision' && draft.decisionState === 'adopted' && (!draft.selectedOption.trim() || !draft.reason.trim()))} onClick={submit} type="button">{saving ? '저장 중' : '저장'}</button></div>
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

function Detail({ entry, loading, onBack, onClose, onEndGeneralTask }) {
  const { item } = entry ?? {}
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
    <ModalShell onBack={onBack} onClose={onClose} title="할 일 상세" variant="detail">
      {loading || !item ? <p className="py-8 text-sm text-[var(--muted-ink)]">불러오는 중입니다.</p> : (
        <div className="grid gap-6">
          <section>
            <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs">{taskStatusLabel(item)}</span>
            <h3 className="mt-4 break-words text-xl font-semibold leading-8">{item.title}</h3>
            <p className="mt-2 text-xs text-[var(--muted-ink)]">{subjectLabel(item.subject)}</p>
          </section>
          {item.trigger_text && <section><h4 className="text-sm font-semibold">확인할 때</h4><p className="mt-2 text-sm leading-6">{item.trigger_text}</p></section>}
          {item.due_date && <section><h4 className="text-sm font-semibold">예정일</h4><p className="mt-2 text-sm">{formatDate(item.due_date)}</p></section>}
          {item.kind === 'general' && item.recurrence_kind === 'daily' && item.control_state === 'active' && onEndGeneralTask && <section className="rounded-2xl border border-[var(--line)] p-4"><h4 className="text-sm font-semibold">매일 반복</h4><p className="mt-1 text-sm text-[var(--muted-ink)]">앞으로 표시되는 반복만 종료합니다. 이미 완료한 날짜의 활동은 그대로 남습니다.</p>{endError && <p className="mt-2 text-sm text-red-300">{endError}</p>}<div className="mt-3 flex flex-wrap gap-2">{confirmEnding ? <><button className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" disabled={ending} onClick={() => setConfirmEnding(false)} type="button">취소</button><button className="rounded-xl border border-red-400/40 px-3 py-2 text-sm text-red-300 disabled:opacity-50" disabled={ending} onClick={endRepeat} type="button">{ending ? '종료 중' : '반복 종료 확인'}</button></> : <button className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" onClick={() => setConfirmEnding(true)} type="button">반복 종료</button>}</div></section>}
          <p className="rounded-2xl bg-[var(--surface-2)] p-4 text-sm leading-6 text-[var(--muted-ink)]">이 항목은 앞으로 할 일입니다. 완료하면 실제로 수행한 활동 기록이 연결됩니다.</p>
        </div>
      )}
    </ModalShell>
  )
}

function LifecycleWorkbench({ initialSelection = null, mode, onSelectionHandled, ownerUserId = null, supabase }) {
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
  const detailRequestGate = useRef(createRequestGate())
  const activityRequestGate = useRef(createRequestGate())
  const activeActivityId = useRef(null)
  const createAttempt = useRef(null)
  const createInFlight = useRef(false)

  async function saveGeneralAction(draft) {
    if (createInFlight.current) return
    createInFlight.current = true
    setSavingGeneral(true)
    setError('')
    try {
      const fingerprint = JSON.stringify({ kind: generalEditor, draft })
      if (createAttempt.current?.fingerprint !== fingerprint) {
        createAttempt.current = { fingerprint, key: crypto.randomUUID() }
      }
      const idempotencyKey = createAttempt.current.key
      if (generalEditor === 'task') {
        await saveGeneralTask(supabase, { ...draft, idempotencyKey })
      } else {
        const occurredAt = draft.occurredOn && draft.occurredOn !== businessDate()
          ? activityNoon(draft.occurredOn)
          : null
        await recordManualActivity(supabase, { ...draft, occurredAt, idempotencyKey })
      }
      createAttempt.current = null
      setActionRefreshKey((value) => value + 1)
      setGeneralEditor(null)
    } catch (nextError) {
      setError(nextError.message ?? '기록을 저장하지 못했습니다.')
    } finally { createInFlight.current = false; setSavingGeneral(false) }
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
    } catch (nextError) { setError(nextError.message ?? '할 일을 완료하지 못했습니다.') }
  }

  async function endGeneralTask(task) {
    await transitionGeneralTask(supabase, task, 'cancel', { reason: '사용자가 반복 종료' })
    setActionRefreshKey((value) => value + 1)
    dismissDetail()
  }

  async function openActivity(action) {
    const request = activityRequestGate.current.begin()
    activeActivityId.current = action.id
    setActivityDetailLoading(true)
    setError('')
    setActivityDetail(action)
    try {
      const loaded = await fetchActivity(supabase, action.id, ownerUserId)
      if (request.isCurrent()) setActivityDetail(loaded)
    } catch (nextError) {
      if (request.isCurrent()) {
        setActivityDetail(null)
        setError(nextError.message ?? '활동을 불러오지 못했습니다.')
      }
    } finally { if (request.isCurrent()) setActivityDetailLoading(false) }
  }

  async function refreshActivityDetail(saved, options = {}) {
    setActionRefreshKey((value) => value + 1)
    if (activeActivityId.current !== saved?.id) return
    const request = activityRequestGate.current.begin()
    setActivityDetail(saved)
    if (options.reload || !saved?.follow_up_tasks) {
      try {
        const loaded = await fetchActivity(supabase, saved.id, ownerUserId)
        if (request.isCurrent()) setActivityDetail(loaded)
      } catch { /* 목록 새로고침으로 복구 */ }
    }
  }

  function dismissActivityDetail() {
    activeActivityId.current = null
    activityRequestGate.current.invalidate()
    setActivityDetailLoading(false)
    setActivityDetail(null)
  }

  useEffect(() => {
    activityRequestGate.current.invalidate()
    activeActivityId.current = null
    detailRequestGate.current.invalidate()
    setActivityDetail(null)
    setDetail(null)
    return () => {
      activityRequestGate.current.invalidate()
      detailRequestGate.current.invalidate()
    }
  }, [ownerUserId, supabase])

  function dismissDetail() {
    detailRequestGate.current.invalidate()
    setDetailLoading(false)
    setDetail(null)
    setDetailHistory([])
  }

  const requestDetailClose = useDetailHistoryEntry(Boolean(detail), dismissDetail)

  async function openDetail(targetMode, id) {
    const request = detailRequestGate.current.begin()
    const previous = detail?.item ? detail : null
    setDetailLoading(true)
    setDetail({ mode: targetMode, item: null })
    setError('')
    try {
      const item = await fetchPortfolioTask(supabase, id, ownerUserId)
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
    return openDetail('tasks', task.id)
  }

  useEffect(() => {
    if (!initialSelection || initialSelection.mode !== mode) return
    openDetail(initialSelection.mode, initialSelection.id)
    onSelectionHandled?.()
  }, [initialSelection, mode, onSelectionHandled])

  return (
    <section className="grid gap-5">
      <header className="grid gap-3">
        <p className="text-sm leading-6 text-[var(--muted-ink)]">해야 할 일과 실제로 수행한 활동, 그 근거가 된 판단을 한곳에서 이어서 봅니다.</p>
        {!ownerUserId && <a className="w-fit text-xs text-[var(--muted-ink)] underline hover:text-[var(--ink)]" href="#tasks">활동에서 조사 보기</a>}
      </header>

      <div className="grid gap-5" id="lifecycle-panel">
        {error && <p className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100" role="alert">{error}</p>}
        <ActionTimeline
          onAdd={() => setGeneralEditor('task')}
          onCompleteGeneralTask={completeGeneralTask}
          onOpenActivity={openActivity}
          onOpenTask={openActionTask}
          ownerUserId={ownerUserId}
          refreshKey={actionRefreshKey}
          supabase={supabase}
        />
      </div>
      {detail && <Detail entry={detail} loading={detailLoading} onBack={detailHistory.length ? () => { detailRequestGate.current.invalidate(); setDetailLoading(false); setDetail(detailHistory[detailHistory.length - 1]); setDetailHistory((history) => history.slice(0, -1)) } : null} onClose={requestDetailClose} onEndGeneralTask={ownerUserId ? null : endGeneralTask} />}
      {activityDetail && <ActivityDetailModal activity={activityDetail} loading={activityDetailLoading} onClose={dismissActivityDetail} onDeleted={() => { dismissActivityDetail(); setActionRefreshKey((value) => value + 1) }} onOpenTask={(id) => { dismissActivityDetail(); openDetail('tasks', id) }} onSaved={refreshActivityDetail} ownerUserId={ownerUserId} supabase={supabase} />}
      {generalEditor && <GeneralActionModal kind={generalEditor} onClose={() => setGeneralEditor(null)} onKindChange={setGeneralEditor} onSave={saveGeneralAction} onTagsChanged={setActivityTagsState} saving={savingGeneral} supabase={supabase} tags={activityTags} />}
    </section>
  )
}

export default function LifecyclePage(props) {
  return props.mode === 'decisions'
    ? <DecisionActivitiesPage ownerUserId={props.ownerUserId} supabase={props.supabase} />
    : <LifecycleWorkbench {...props} />
}
