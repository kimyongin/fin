import { activityUpperTextError } from './activityText'
import { useEffect, useRef, useState } from 'react'

import ModalShell from '../../components/ModalShell'
import ModalActions from '../../components/ModalActions'
import ActivityDocument from './ActivityDocument'
import ActivityTagPicker from '../../components/ActivityTagPicker'
import TaskScheduleFields, { scheduleSummary } from './TaskScheduleFields'
import ListItemAction from '../../components/ListItemAction'

function taskStatusLabel(task) {
  return { open: '할 일', done: '완료', cancelled: '취소' }[task.status] ?? task.status
}

function formatDate(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(value))
}

function subjectLabel(subject) {
  if (!subject) return '전체 포트폴리오'
  if (subject.kind === 'portfolio') return subject.label || '전체 포트폴리오'
  return subject.label || subject.instrument_ticker || '대상 종목'
}

function taskDraft(item) {
  return { title: item?.title ?? '', summary: item?.summary ?? '', triggerText: item?.trigger_text ?? '', dueDate: item?.due_date ?? '',
    recurrenceKind: item?.recurrence_kind ?? 'none', recurrenceStartOn: item?.recurrence_start_on ?? '',
    recurrenceWeekdays: item?.recurrence_weekdays ?? [], recurrenceTime: item?.recurrence_time?.slice(0, 5) ?? '',
    tagIds: (item?.tags ?? []).map((tag) => tag.id).sort() }
}

export default function GeneralTaskDetail({ availableTags = [], entry, historyGuardRef, loading, onBack, onClose, onDeleteTask, onEdit, onRetryTags, onSaveTask, ownerUserId, supabase, tagsError = '', tagsLoading = false, viewMode = 'read' }) {
  const { item } = entry ?? {}
  const [draft, setDraft] = useState(() => taskDraft(item))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const attempt = useRef(null)
  const deleteAttempt = useRef(null)
  useEffect(() => { setDraft(taskDraft(item)); setSaveError(''); attempt.current = null }, [item?.id, item?.version, item?.updated_at])
  const canEdit = !ownerUserId && Boolean(item) && item.control_state === 'active'
  const editable = canEdit && viewMode === 'edit'
  const dirty = editable && JSON.stringify(draft) !== JSON.stringify(taskDraft(item))
  const labelClass = 'form-field form-label'
  const upperError = activityUpperTextError(draft.title, draft.summary, item)
  const inputClass = 'form-control'

  async function save() {
    if (!dirty || saving || upperError || (!draft.title.trim() || !draft.summary.trim() || !draft.triggerText.trim())) return
    const fingerprint = JSON.stringify({ id: item.id, version: item.version, draft })
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() }
    setSaving(true); setSaveError('')
    try { await onSaveTask(item, { ...draft, idempotencyKey: attempt.current.key }); attempt.current = null }
    catch (error) { setSaveError(error.message ?? '할 일을 저장하지 못했습니다.') }
    finally { setSaving(false) }
  }


  async function remove() {
    if (saving || !item) return
    const fingerprint = `${item.id}:${item.version}`
    if (deleteAttempt.current?.fingerprint !== fingerprint) deleteAttempt.current = { fingerprint, key: crypto.randomUUID() }
    setSaving(true); setSaveError('')
    try { await onDeleteTask(item, deleteAttempt.current.key); deleteAttempt.current = null }
    catch (error) { setSaveError(error.message ?? '할 일을 삭제하지 못했습니다.') }
    finally { setSaving(false) }
  }

  return (
    <ModalShell closeDisabled={saving} dirty={dirty} historyGuardRef={historyGuardRef} footer={canEdit ? (requestClose) => <div className="grid gap-3">
      {saveError && <p className="text-sm text-red-200" role="alert">{saveError}</p>}
      {editable && item && <ModalActions canDelete deleteConfirmMessage={`${item.title} — 할 일을 삭제해도 이미 작성한 기록과 실제 잔고는 남고, 기록의 할 일 연결만 해제됩니다.${dirty ? ' 저장하지 않은 변경은 버려집니다.' : ''}`} deleteDialogTitle="할 일 삭제" deleteError={saveError} deleteLabel="할 일 삭제" disabled={saving} dirty={dirty} onClose={requestClose} onDelete={remove} onDeleteCancel={() => setSaveError('')} onDeleteOpen={() => setSaveError('')} onSave={save} saveDisabled={Boolean(upperError) || !dirty || (!draft.title.trim() || !draft.summary.trim() || !draft.triggerText.trim()) || (draft.recurrenceKind === 'weekly' && draft.recurrenceWeekdays.length === 0) || tagsLoading || Boolean(tagsError)} saveLabel={saving ? '저장 중' : '저장'} />}
      {!editable && canEdit && <div className="flex justify-end"><ListItemAction kind="edit" label={`할 일 편집: ${item.title}`} onClick={onEdit} /></div>}
    </div> : undefined} onBack={dirty ? null : onBack} onClose={onClose} title="할 일 상세">
      {loading || !item ? <p className="py-8 text-sm text-[var(--muted-ink)]">불러오는 중입니다.</p> : (
        editable ? <fieldset className="grid min-w-0 gap-4" disabled={saving}>
          <p className="type-meta text-[var(--muted-ink)]">제목 100자·요약 300자 이내로 작성해 주세요. 기존 초과 문구를 바꾸면 새 상한을 적용합니다.</p>
          {upperError && <p className="type-secondary text-red-200" role="alert">{upperError}</p>}
          <label className={labelClass}>할 일 제목<input className={inputClass} onChange={(event) => setDraft({ ...draft, title: event.target.value })} value={draft.title} /></label>
          <label className={labelClass}>요약<textarea className={inputClass} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} rows={3} value={draft.summary} /></label>
          <TaskScheduleFields draft={draft} onChange={setDraft} />
          <section className="border-t border-[var(--line)] pt-3">{tagsLoading && <p className="text-sm text-[var(--muted-ink)]">태그 목록을 불러오는 중입니다.</p>}{tagsError && <div className="flex items-center gap-3 text-sm text-red-200"><span>{tagsError}</span><button className="min-h-11 rounded-xl border border-red-400/40 px-3" onClick={onRetryTags} type="button">다시 시도</button></div>}{!tagsLoading && !tagsError && <ActivityTagPicker disabled={saving} onChange={(tagIds) => setDraft((current) => ({ ...current, tagIds: [...tagIds].sort() }))} selectedIds={draft.tagIds} tags={availableTags} />}</section>
          <label className={labelClass}>할 일 본문<textarea maxLength={25000} className={inputClass} onChange={(event) => setDraft({ ...draft, triggerText: event.target.value })} rows={3} value={draft.triggerText} /></label>
        </fieldset> : <ActivityDocument title={item.title} summary={item.summary} body={item.trigger_text} bodyLabel="할 일 본문" status={taskStatusLabel(item)} tags={item.tags}
          metadata={[
            { label: '대상', value: subjectLabel(item.subject) },
            { label: '일정', value: `${scheduleSummary(item)}${item.recurrence_start_on ? ` · ${formatDate(item.recurrence_start_on)}부터` : ''}` },
          ]} />
      )}
    </ModalShell>
  )
}
