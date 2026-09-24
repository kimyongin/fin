import { useEffect, useMemo, useRef, useState } from 'react'

import ModalShell from '../../components/ModalShell'
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


export default function ActivityDetailModal({ activity, availableTags = [], historyGuardRef, loading, onClose, onDeleted, onRetryTags, onSaved, onTagsChanged, ownerUserId, supabase, tagsError = '', tagsLoading = false }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
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
      setConfirmDelete(false)
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
      if (activity.holding_id != null) patch.holding_id = null
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

  const footer = !loading && activity && !ownerUserId ? (requestClose) => (
    <fieldset className="grid min-w-0 gap-3" disabled={saving}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
            <button className="min-h-11 rounded-2xl border border-red-400/40 px-4 text-sm font-semibold text-red-200 disabled:opacity-50" disabled={dirty} onClick={() => confirmDelete ? removeActivity() : setConfirmDelete(true)} type="button">{confirmDelete ? '삭제 확인' : '기록 삭제'}</button>
            {confirmDelete && <button className="min-h-11 rounded-2xl border border-[var(--line)] px-4 text-sm font-semibold" onClick={() => setConfirmDelete(false)} type="button">취소</button>}
        </div>
        <div className="ml-auto grid grid-cols-2 gap-2 sm:flex">
          <button className="min-h-11 rounded-2xl border border-[var(--line)] px-4 text-sm font-semibold" onClick={requestClose} type="button">닫기</button>
          <button className="min-h-11 rounded-2xl bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-50" disabled={!dirty || saving || tagsLoading || Boolean(tagsError) || (editable.has('title') && !draft.title.trim())} onClick={save} type="button">{saving ? '저장 중' : '저장'}</button>
        </div>
      </div>
      {confirmDelete && <p className="text-sm text-[var(--muted-ink)]">기록을 삭제해도 관련 할 일이나 실제 잔고는 바뀌지 않습니다.</p>}
    </fieldset>
  ) : undefined

  return <ModalShell closeDisabled={saving} dirty={dirty} footer={footer} historyGuardRef={historyGuardRef} onClose={onClose} title="기록 상세">
    <fieldset className="min-w-0" disabled={saving}>
    {loading || !activity ? <p className="py-8 text-sm text-[var(--muted-ink)]">활동을 불러오는 중입니다.</p> : <div className="grid gap-6">
      {error && <p className="rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-100">{error}</p>}
      <section className="grid gap-3">
        {editing && editable.has('title') ? <label className="grid gap-2 text-xs font-semibold text-[var(--muted-ink)]">기록 제목<input autoFocus className="min-h-11 w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 text-base font-normal text-[var(--ink)] outline-none focus:border-[var(--accent)]" maxLength={500} onChange={(event) => setDraft({ ...draft, title: event.target.value })} value={draft.title} /></label> : <h3 className="break-words text-xl font-semibold leading-8">{activity.title || activity.after_data?.title || activity.action_type}</h3>}
        <p className="text-xs text-[var(--muted-ink)]">{formatDateTime(activity.occurred_at)} · {activity.source === 'agent' ? 'ChatGPT' : '앱'}</p>
        {ownerUserId && (activity.tags?.length ?? 0) > 0 && <div className="flex flex-wrap gap-1">{activity.tags.map((tag) => <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--muted-ink)]" key={tag.id}>{tag.name}</span>)}</div>}
      </section>

      {editing && editable.has('occurred_at') && <label className="grid gap-2 text-xs font-semibold text-[var(--muted-ink)]">수행일<input className="min-h-11 w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 text-base font-normal text-[var(--ink)] outline-none focus:border-[var(--accent)]" max={businessDate()} onChange={(event) => setDraft({ ...draft, occurredOn: event.target.value })} type="date" value={draft.occurredOn} /></label>}
      {!editing && activity.origin_task && <section className="rounded-2xl bg-[var(--surface-2)] p-4"><h4 className="text-xs font-semibold text-[var(--muted-ink)]">관련 할 일</h4><p className="mt-2 break-words text-sm font-semibold">{activity.origin_task.title}</p>{activity.origin_task.trigger_text && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{activity.origin_task.trigger_text}</p>}{(activity.origin_task.due_date || activity.origin_task.recurrence_kind === 'daily') && <p className="mt-2 text-xs text-[var(--muted-ink)]">{activity.origin_task.recurrence_kind === 'daily' ? '매일 반복' : `예정일 ${activity.origin_task.due_date}`}</p>}</section>}
      {(editing || activity.body) && <label className="grid gap-2"><span className="text-sm font-semibold">기록 내용</span>{editing && editable.has('body') ? <textarea className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 text-base outline-none focus:border-[var(--accent)]" maxLength={25000} onChange={(event) => setDraft({ ...draft, body: event.target.value })} rows={8} value={draft.body} /> : <p className="whitespace-pre-wrap break-words text-sm leading-6">{activity.body}</p>}</label>}

      {editing && <ActivityReferences disabled={saving} instrumentId={draft.instrumentId} instrumentSummary={activity.instrument_summary} onInstrumentChange={(instrumentId) => setDraft((current) => ({ ...current, instrumentId }))} onTaskChange={(taskId) => setDraft((current) => ({ ...current, taskId }))} supabase={supabase} taskId={draft.taskId} taskSummary={activity.origin_task} />}
      {!editing && activity.instrument_summary && <p className="text-xs text-[var(--muted-ink)]">관련 종목 · {activity.instrument_summary.display_name} · {activity.instrument_summary.ticker}</p>}



      {!ownerUserId && <section className="border-t border-[var(--line)] pt-4">{tagsLoading && <p className="mb-2 text-xs text-[var(--muted-ink)]">태그 목록을 불러오는 중입니다.</p>}{tagsError && <div className="mb-2 flex items-center gap-3 text-xs text-red-200"><span>{tagsError}</span><button className="min-h-11 rounded-lg border border-red-400/40 px-3" onClick={onRetryTags} type="button">다시 시도</button></div>}<ActivityTagPicker compact disabled={saving || tagsLoading || Boolean(tagsError)} onChange={setSelectedTagIds} onTagsChanged={(tags, ids) => { onTagsChanged(tags); setSelectedTagIds(ids) }} selectedIds={selectedTagIds} supabase={supabase} tags={availableTags} /></section>}

    </div>}
    </fieldset>
  </ModalShell>
}
