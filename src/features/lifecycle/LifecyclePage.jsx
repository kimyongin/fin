import { useEffect, useRef, useState } from 'react'

import ActivityDetailModal from './ActivityDetailModal'
import ActionTimeline from './ActionTimeline'
import { createRequestGate } from '../../lib/requestGate'
import { activityNoon, businessDate } from '../../lib/businessDate'
import { useDetailHistoryEntry } from '../../hooks/useDetailHistoryEntry'
import TagManagerModal from '../../components/TagManagerModal'
import GeneralActionModal from './GeneralActionModal'
import GeneralTaskDetail from './GeneralTaskDetail'
import {
  fetchActivity,
  fetchActivityTags,
  fetchPortfolioTask,
  deleteActivityTag,
  deleteGeneralTask,
  recordManualActivity,
  saveActivityTag,
  saveGeneralTask,
  transitionGeneralTask,
} from './data'

function LifecycleWorkbench({ canViewTimeline = true, initialSelection = null, mode, onSelectionHandled, onSharedViewReady, ownerUserId = null, supabase }) {
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailHistory, setDetailHistory] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [generalEditor, setGeneralEditor] = useState(null)
  const [savingGeneral, setSavingGeneral] = useState(false)
  const [actionRefreshKey, setActionRefreshKey] = useState(0)
  const [activityTags, setActivityTagsState] = useState([])
  const [activityTagsLoading, setActivityTagsLoading] = useState(false)
  const [activityTagsError, setActivityTagsError] = useState('')
  const [tagManagerOpen, setTagManagerOpen] = useState(false)
  const tagManagerHistoryGuard = useRef(null)
  const [activityDetail, setActivityDetail] = useState(null)
  const [activityDetailLoading, setActivityDetailLoading] = useState(false)
  const detailRequestGate = useRef(createRequestGate())
  const activityRequestGate = useRef(createRequestGate())
  const tagsRequestGate = useRef(createRequestGate())
  const activityHistoryGuard = useRef(null)
  const taskHistoryGuard = useRef(null)
  const activeActivityId = useRef(null)
  const createAttempt = useRef(null)
  const createInFlight = useRef(false)


  function updateActivityTags(tags) {
    tagsRequestGate.current.invalidate()
    setActivityTagsLoading(false)
    setActivityTagsError('')
    setActivityTagsState(tags)
    setActionRefreshKey((value) => value + 1)
  }

  async function refreshManagedTags() {
    const tags = await fetchActivityTags(supabase)
    updateActivityTags(tags)
    return tags
  }

  async function reloadActivityTags() {
    if (ownerUserId) return
    const request = tagsRequestGate.current.begin()
    setActivityTagsLoading(true)
    setActivityTagsError('')
    try {
      const tags = await fetchActivityTags(supabase)
      if (request.isCurrent()) setActivityTagsState(tags)
    } catch {
      if (request.isCurrent()) setActivityTagsError('태그 목록을 불러오지 못했습니다.')
    } finally {
      if (request.isCurrent()) setActivityTagsLoading(false)
    }
  }

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
    tagsRequestGate.current.invalidate()
    setActivityTagsState([])
    setActivityTagsError('')
    setActivityTagsLoading(false)
    if (!ownerUserId) reloadActivityTags()
    return () => tagsRequestGate.current.invalidate()
  }, [ownerUserId, supabase])

  async function completeGeneralTask(task) {
    await transitionGeneralTask(supabase, task, 'complete', { occurrenceOn: task.occurrence_on })
    setActionRefreshKey((value) => value + 1)
  }

  async function stopGeneralTask(task) {
    await transitionGeneralTask(supabase, task, 'cancel', { reason: '사용자가 반복 중단' })
    setActionRefreshKey((value) => value + 1)
  }

  async function saveTaskDetail(task, draft) {
    const saved = await saveGeneralTask(supabase, {
      ...draft, id: task.id, expectedVersion: task.version,
      subject: task.subject, timezone: task.timezone,
    })
    setDetail((current) => current?.item?.id === task.id ? { ...current, item: saved } : current)
    setActionRefreshKey((value) => value + 1)
  }

  async function removeTaskDetail(task, idempotencyKey) {
    await deleteGeneralTask(supabase, task, idempotencyKey)
    dismissDetail()
    setActionRefreshKey((value) => value + 1)
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

  async function refreshActivityDetail(saved) {
    setActionRefreshKey((value) => value + 1)
    if (activeActivityId.current !== saved?.id) return
    const request = activityRequestGate.current.begin()
    setActivityDetail(saved)
    try {
      const loaded = await fetchActivity(supabase, saved.id, ownerUserId)
      if (request.isCurrent()) setActivityDetail(loaded)
    } catch { /* 목록 새로고침으로 복구 */ }
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

  const requestDetailClose = useDetailHistoryEntry(Boolean(detail || activityDetail), (confirmed) => {
    if (!confirmed && activityDetail && activityHistoryGuard.current?.() === false) return false
    if (!confirmed && detail && taskHistoryGuard.current?.() === false) return false
    if (detail) dismissDetail()
    else dismissActivityDetail()
  })
  const requestTagManagerClose = useDetailHistoryEntry(tagManagerOpen, (confirmed) => {
    if (!confirmed && tagManagerHistoryGuard.current?.() === false) return false
    setTagManagerOpen(false)
  })

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
      <div className="grid gap-5" id="lifecycle-panel">
        {error && <p className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100" role="alert">{error}</p>}
        {canViewTimeline && activityTagsError && <div className="flex items-center justify-between gap-3 rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100" role="alert"><span>{activityTagsError}</span><button className="min-h-11 rounded-xl border border-red-400/40 px-3" onClick={reloadActivityTags} type="button">다시 시도</button></div>}
        {canViewTimeline ? <ActionTimeline
          availableTags={activityTags}
          canManageTags={!activityTagsLoading && !activityTagsError}
          key={ownerUserId ?? 'self'}
          onAdd={() => setGeneralEditor('task')}
          onCompleteGeneralTask={completeGeneralTask}
          onStopGeneralTask={stopGeneralTask}
          onManageTags={() => setTagManagerOpen(true)}
          onOpenActivity={openActivity}
          onOpenTask={openActionTask}
          onSharedViewReady={onSharedViewReady}
          ownerUserId={ownerUserId}
          refreshKey={actionRefreshKey}
          supabase={supabase}
        /> : null}
      </div>
      {detail && <GeneralTaskDetail availableTags={activityTags} entry={detail} historyGuardRef={taskHistoryGuard} loading={detailLoading} onBack={detailHistory.length ? () => { detailRequestGate.current.invalidate(); setDetailLoading(false); setDetail(detailHistory[detailHistory.length - 1]); setDetailHistory((history) => history.slice(0, -1)) } : null} onClose={requestDetailClose} onDeleteTask={ownerUserId ? null : removeTaskDetail} onRetryTags={reloadActivityTags} onSaveTask={ownerUserId ? null : saveTaskDetail} ownerUserId={ownerUserId} supabase={supabase} tagsError={activityTagsError} tagsLoading={activityTagsLoading} />}
      {activityDetail && <ActivityDetailModal activity={activityDetail} availableTags={activityTags} historyGuardRef={activityHistoryGuard} loading={activityDetailLoading} onClose={requestDetailClose} onDeleted={() => { dismissActivityDetail(); setActionRefreshKey((value) => value + 1) }} onRetryTags={reloadActivityTags} onSaved={refreshActivityDetail} ownerUserId={ownerUserId} supabase={supabase} tagsError={activityTagsError} tagsLoading={activityTagsLoading} />}
      {generalEditor && <GeneralActionModal kind={generalEditor} onClose={() => setGeneralEditor(null)} onKindChange={setGeneralEditor} onRetryTags={reloadActivityTags} onSave={saveGeneralAction} saving={savingGeneral} supabase={supabase} tags={activityTags} tagsError={activityTagsError} tagsLoading={activityTagsLoading} />}
      {tagManagerOpen && !ownerUserId && <TagManagerModal deleteImpact="기록과 할 일의 태그 연결이 해제되지만 원본 내용은 남습니다." historyGuardRef={tagManagerHistoryGuard} onClose={requestTagManagerClose} onDelete={(tag, key) => deleteActivityTag(supabase, { ...tag, idempotencyKey: key })} onRefresh={refreshManagedTags} onSave={(tag, key) => saveActivityTag(supabase, { ...tag, idempotencyKey: key })} showSearch={false} tags={activityTags} title="활동 태그 관리" />}
    </section>
  )
}

export default function LifecyclePage(props) {
  return <LifecycleWorkbench {...props} />
}
