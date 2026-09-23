import { useEffect, useRef, useState } from 'react'

import ActivityDetailModal from './ActivityDetailModal'
import ActionTimeline from './ActionTimeline'
import DecisionActivitiesPage from './DecisionActivitiesPage'
import { createRequestGate } from '../../lib/requestGate'
import { activityNoon, businessDate } from '../../lib/businessDate'
import { useDetailHistoryEntry } from '../../hooks/useDetailHistoryEntry'
import GeneralActionModal from './GeneralActionModal'
import GeneralTaskDetail from './GeneralTaskDetail'
import {
  fetchActivity,
  fetchActivityTags,
  fetchPortfolioTask,
  recordManualActivity,
  saveGeneralTask,
  transitionGeneralTask,
} from './data'

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
      {detail && <GeneralTaskDetail entry={detail} loading={detailLoading} onBack={detailHistory.length ? () => { detailRequestGate.current.invalidate(); setDetailLoading(false); setDetail(detailHistory[detailHistory.length - 1]); setDetailHistory((history) => history.slice(0, -1)) } : null} onClose={requestDetailClose} onEndGeneralTask={ownerUserId ? null : endGeneralTask} />}
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
