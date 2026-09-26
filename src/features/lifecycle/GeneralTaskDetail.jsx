import { useEffect, useRef, useState } from 'react'

import ModalShell from '../../components/ModalShell'
import ModalActions from '../../components/ModalActions'
import TagChip from '../../components/TagChip'
import ReadOnlyField from '../../components/ReadOnlyField'
import ActivityTagPicker from './ActivityTagPicker'
import TaskScheduleFields, { scheduleSummary } from './TaskScheduleFields'

function taskStatusLabel(task) {
  return { open: '할 일', done: '완료', cancelled: '취소' }[task.status] ?? task.status
}

function formatDate(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(value))
}

function subjectLabel(subject) {
  if (!subject || subject.kind === 'portfolio') return '전체 포트폴리오'
  return subject.label || subject.instrument_id || '대상 종목'
}

function taskDraft(item) {
  return { title: item?.title ?? '', triggerText: item?.trigger_text ?? '', dueDate: item?.due_date ?? '',
    recurrenceKind: item?.recurrence_kind ?? 'none', recurrenceStartOn: item?.recurrence_start_on ?? '',
    recurrenceWeekdays: item?.recurrence_weekdays ?? [], recurrenceTime: item?.recurrence_time?.slice(0, 5) ?? '',
    tagIds: (item?.tags ?? []).map((tag) => tag.id).sort() }
}

export default function GeneralTaskDetail({ availableTags = [], entry, historyGuardRef, loading, onBack, onClose, onDeleteTask, onRetryTags, onSaveTask, ownerUserId, supabase, tagsError = '', tagsLoading = false }) {
  const { item } = entry ?? {}
  const [draft, setDraft] = useState(() => taskDraft(item))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const attempt = useRef(null)
  const deleteAttempt = useRef(null)
  useEffect(() => { setDraft(taskDraft(item)); setSaveError(''); attempt.current = null }, [item?.id, item?.version, item?.updated_at])
  const editable = !ownerUserId && Boolean(item) && item.control_state === 'active'
  const dirty = editable && JSON.stringify(draft) !== JSON.stringify(taskDraft(item))
  const labelClass = 'form-field form-label'
  const inputClass = 'form-control'

  async function save() {
    if (!dirty || saving || !draft.title.trim()) return
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
    <ModalShell closeDisabled={saving} dirty={dirty} historyGuardRef={historyGuardRef} footer={(requestClose) => <div className="grid gap-3">
      {saveError && <p className="text-sm text-red-200" role="alert">{saveError}</p>}
      {!ownerUserId && item && <ModalActions canDelete deleteConfirmMessage={`${item.title} — 할 일을 삭제해도 이미 작성한 기록과 실제 잔고는 남고, 기록의 할 일 연결만 해제됩니다.${dirty ? ' 저장하지 않은 변경은 버려집니다.' : ''}`} deleteDialogTitle="할 일 삭제" deleteError={saveError} deleteLabel="할 일 삭제" disabled={saving} dirty={dirty} onClose={requestClose} onDelete={remove} onDeleteCancel={() => setSaveError('')} onDeleteOpen={() => setSaveError('')} onSave={save} saveDisabled={!editable || !dirty || !draft.title.trim() || (draft.recurrenceKind === 'weekly' && draft.recurrenceWeekdays.length === 0) || tagsLoading || Boolean(tagsError)} saveLabel={saving ? '저장 중' : '저장'} />}
    </div>} onBack={dirty ? null : onBack} onClose={onClose} title="할 일 상세">
      {loading || !item ? <p className="py-8 text-sm text-[var(--muted-ink)]">불러오는 중입니다.</p> : (
        editable ? <fieldset className="grid min-w-0 gap-4" disabled={saving}>
          <label className={labelClass}>할 일 제목<input className={inputClass} maxLength={500} onChange={(event) => setDraft({ ...draft, title: event.target.value })} value={draft.title} /></label>
          <label className={labelClass}>확인할 때<textarea className={inputClass} onChange={(event) => setDraft({ ...draft, triggerText: event.target.value })} rows={3} value={draft.triggerText} /></label>
          <TaskScheduleFields draft={draft} onChange={setDraft} />
          <section className="border-t border-[var(--line)] pt-3">{tagsLoading && <p className="text-sm text-[var(--muted-ink)]">태그 목록을 불러오는 중입니다.</p>}{tagsError && <div className="flex items-center gap-3 text-sm text-red-200"><span>{tagsError}</span><button className="min-h-11 rounded-xl border border-red-400/40 px-3" onClick={onRetryTags} type="button">다시 시도</button></div>}{!tagsLoading && !tagsError && <ActivityTagPicker disabled={saving} onChange={(tagIds) => setDraft((current) => ({ ...current, tagIds: [...tagIds].sort() }))} selectedIds={draft.tagIds} tags={availableTags} />}</section>
        </fieldset> : <div className="grid gap-6">
          <section>
            <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs">{taskStatusLabel(item)}</span>
            <ReadOnlyField className="mt-4" label="할 일 제목" value={item.title} />
            <p className="mt-2 text-xs text-[var(--muted-ink)]">{subjectLabel(item.subject)}</p>
          </section>
          {item.trigger_text && <section><h4 className="type-item-title">확인할 때</h4><p className="type-body type-long-body mt-2">{item.trigger_text}</p></section>}
          <ReadOnlyField label="일정" value={`${scheduleSummary(item)}${item.recurrence_start_on ? ` · ${formatDate(item.recurrence_start_on)}부터` : ''}`} />
          {item.tags?.length > 0 && <section><h4 className="mb-2 text-xs font-semibold text-[var(--muted-ink)]">태그</h4><div className="flex flex-wrap gap-2">{item.tags.map((tag) => <TagChip key={tag.id}>{tag.name}</TagChip>)}</div></section>}
        </div>
      )}
    </ModalShell>
  )
}
