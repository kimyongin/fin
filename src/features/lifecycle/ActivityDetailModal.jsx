import { useEffect, useMemo, useRef, useState } from 'react'

import ModalShell from '../../components/ModalShell'
import ModalActions from '../../components/ModalActions'
import TagChip from '../../components/TagChip'
import ReadOnlyField from '../../components/ReadOnlyField'
import CalendarDateField from '../../components/CalendarDateField'
import ActivityTagPicker from './ActivityTagPicker'
import ActivityReferences from './ActivityReferences'
import { activityNoon, businessDate } from '../../lib/businessDate'
import { deleteActivity, saveActivityDetail } from './data'

function localDate(value) {
  if (!value) return ''
  return businessDate(value)
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value))
}


export default function ActivityDetailModal({ activity, availableTags = [], historyGuardRef, loading, onClose, onDeleted, onRetryTags, onSaved, ownerUserId, supabase, tagsError = '', tagsLoading = false }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({ title: '', body: '', occurredOn: '', taskId: null, instrumentId: null })
  const previousActivityId = useRef(null)
  const previousActivityVersion = useRef(null)
  const previousLoading = useRef(false)
  const saveAttempt = useRef(null)
  const [selectedTagIds, setSelectedTagIds] = useState([])
  const editable = useMemo(() => new Set(activity?.editable_fields ?? []), [activity])
  const editing = !ownerUserId && editable.size > 0
  const editingDirty = editing && activity && (
    draft.title !== (activity.title ?? '') || draft.body !== (activity.body ?? '') ||
    draft.occurredOn !== localDate(activity.occurred_at) ||
    draft.taskId !== (activity.task_id ?? null) || draft.instrumentId !== (activity.instrument_id ?? null)
  )
  const availableTagIds = new Set(availableTags.map((tag) => tag.id))
  const tagsDirty = !ownerUserId && !tagsLoading && !tagsError && JSON.stringify([...selectedTagIds].sort()) !== JSON.stringify([...(activity?.tags ?? []).map((tag) => tag.id).filter((id) => availableTagIds.has(id))].sort())
  const dirty = Boolean(editingDirty || tagsDirty)

  useEffect(() => {
    if (!activity) return
    const changedActivity = previousActivityId.current !== activity.id
    const refreshed = previousActivityVersion.current !== activity.version || (previousLoading.current && !loading)
    previousActivityId.current = activity.id
    previousActivityVersion.current = activity.version
    previousLoading.current = loading
    if (changedActivity || refreshed || !editingDirty) setDraft({
      title: activity.title ?? '',
      body: activity.body ?? '',
      occurredOn: localDate(activity.occurred_at),
      taskId: activity.task_id ?? null,
      instrumentId: activity.instrument_id ?? null,
    })
    if (changedActivity) {
      setError('')
    }
    if (changedActivity || refreshed || !tagsDirty) setSelectedTagIds((activity.tags ?? []).map((tag) => tag.id))
  }, [activity, loading])

  async function save() {
    if (!dirty || saving) return
    setSaving(true)
    setError('')
    try {
      const patch = {}
      if (editable.has('title') && draft.title !== (activity.title ?? '')) patch.title = draft.title
      if (editable.has('body') && draft.body !== (activity.body ?? '')) patch.body = draft.body || null
      if (editable.has('occurred_at') && draft.occurredOn !== localDate(activity.occurred_at)) {
        patch.occurred_at = activityNoon(draft.occurredOn)
        patch.timezone = 'Asia/Seoul'
      }
      if (editable.has('task_id') && draft.taskId !== (activity.task_id ?? null)) patch.task_id = draft.taskId
      if (editable.has('instrument_id') && draft.instrumentId !== (activity.instrument_id ?? null)) patch.instrument_id = draft.instrumentId
      const fingerprint = JSON.stringify({ id: activity.id, version: activity.version, patch, selectedTagIds })
      if (saveAttempt.current?.fingerprint !== fingerprint) saveAttempt.current = { fingerprint, key: crypto.randomUUID() }
      const saved = await saveActivityDetail(supabase, activity, patch, selectedTagIds, saveAttempt.current.key)
      saveAttempt.current = null
      onSaved(saved)
    } catch (nextError) {
      setError(nextError.message ?? '활동을 수정하지 못했습니다.')
    } finally { setSaving(false) }
  }

  async function removeActivity() {
    setSaving(true); setError('')
    try {
      await deleteActivity(supabase, activity)
      onDeleted()
    } catch (nextError) {
      setError(nextError.message ?? '활동을 삭제하지 못했습니다.')
    } finally { setSaving(false) }
  }

  const footer = !loading && activity && !ownerUserId ? (requestClose) => <ModalActions
    canDelete
    deleteConfirmMessage="이 기록을 삭제해도 관련 할 일이나 실제 잔고는 바뀌지 않습니다."
    deleteDialogTitle="기록 삭제"
    deleteError={error}
    deleteLabel="기록 삭제"
    disabled={saving}
    dirty={dirty}
    onClose={requestClose}
    onDelete={removeActivity}
    onDeleteCancel={() => setError('')}
    onDeleteOpen={() => setError('')}
    onSave={save}
    saveDisabled={!dirty || tagsLoading || Boolean(tagsError) || (editable.has('title') && !draft.title.trim())}
    saveLabel={saving ? '저장 중' : '저장'}
  /> : undefined

  return <ModalShell closeDisabled={saving} dirty={dirty} footer={footer} historyGuardRef={historyGuardRef} onClose={onClose} title="기록 상세">
    <fieldset className="min-w-0" disabled={saving}>
    {loading || !activity ? <p className="py-8 text-sm text-[var(--muted-ink)]">활동을 불러오는 중입니다.</p> : <div className="grid gap-6">
      {error && <p className="rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-100">{error}</p>}
      <section className="grid gap-3">
        {editing && editable.has('title') ? <label className="form-field"><span className="form-label">기록 제목</span><input autoFocus className="form-control" maxLength={500} onChange={(event) => setDraft({ ...draft, title: event.target.value })} value={draft.title} /></label> : <ReadOnlyField label="기록 제목" value={activity.title || activity.after_data?.title || activity.action_type} />}
        <p className="text-xs text-[var(--muted-ink)]">{formatDateTime(activity.occurred_at)} · {activity.source === 'agent' ? 'ChatGPT' : '앱'}</p>
        {ownerUserId && (activity.tags?.length ?? 0) > 0 && <div className="flex flex-wrap gap-2">{activity.tags.map((tag) => <TagChip key={tag.id}>{tag.name}</TagChip>)}</div>}
      </section>

      {editing && editable.has('occurred_at') && <CalendarDateField label="수행일" max={businessDate()} onChange={(value) => setDraft({ ...draft, occurredOn: value })} value={draft.occurredOn} />}
      {!editing && activity.origin_task && <section className="rounded-2xl bg-[var(--surface-2)] p-4"><h4 className="text-xs font-semibold text-[var(--muted-ink)]">관련 할 일</h4><p className="mt-2 break-words text-sm font-semibold">{activity.origin_task.title}</p>{activity.origin_task.trigger_text && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{activity.origin_task.trigger_text}</p>}{(activity.origin_task.due_date || activity.origin_task.recurrence_kind === 'daily') && <p className="mt-2 text-xs text-[var(--muted-ink)]">{activity.origin_task.recurrence_kind === 'daily' ? '매일 반복' : `예정일 ${activity.origin_task.due_date}`}</p>}</section>}
      {(editing || activity.body) && (editing && editable.has('body') ? <label className="form-field"><span className="form-label">기록 내용</span><textarea className="form-control" maxLength={25000} onChange={(event) => setDraft({ ...draft, body: event.target.value })} rows={8} value={draft.body} /></label> : <section><h4 className="form-label">기록 내용</h4><p className="type-body type-long-body mt-2 whitespace-pre-wrap break-words">{activity.body}</p></section>)}

      {editing && <ActivityReferences disabled={saving} instrumentId={draft.instrumentId} instrumentSummary={activity.instrument_summary} onInstrumentChange={(instrumentId) => setDraft((current) => ({ ...current, instrumentId }))} onTaskChange={(taskId) => setDraft((current) => ({ ...current, taskId }))} supabase={supabase} taskId={draft.taskId} taskSummary={activity.origin_task} />}
      {!editing && activity.instrument_summary && <p className="text-xs text-[var(--muted-ink)]">관련 종목 · {activity.instrument_summary.display_name} · {activity.instrument_summary.ticker}</p>}



      {!ownerUserId && <section className="border-t border-[var(--line)] pt-4">{tagsLoading && <p className="mb-2 text-xs text-[var(--muted-ink)]">태그 목록을 불러오는 중입니다.</p>}{tagsError && <div className="mb-2 flex items-center gap-3 text-xs text-red-200"><span>{tagsError}</span><button className="min-h-11 rounded-lg border border-red-400/40 px-3" onClick={onRetryTags} type="button">다시 시도</button></div>}{!tagsLoading && !tagsError && <ActivityTagPicker disabled={saving} onChange={setSelectedTagIds} selectedIds={selectedTagIds} tags={availableTags} />}</section>}

    </div>}
    </fieldset>
  </ModalShell>
}
