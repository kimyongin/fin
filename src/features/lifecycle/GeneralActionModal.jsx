import { useRef, useState } from 'react'

import ModalShell from '../../components/ModalShell'
import ModalActions from '../../components/ModalActions'
import CalendarDateField from '../../components/CalendarDateField'
import { businessDate } from '../../lib/businessDate'
import ActivityTagPicker from './ActivityTagPicker'
import ActivityReferences from './ActivityReferences'
import TaskScheduleFields from './TaskScheduleFields'

export default function GeneralActionModal({ kind, onClose, onKindChange, onRetryTags, onSave, saving, supabase, tags, tagsError = '', tagsLoading = false }) {
  const today = businessDate()
  const [draft, setDraft] = useState({ title: '', body: '', dueDate: '', recurrenceStartOn: '', recurrenceWeekdays: [], recurrenceTime: '', occurredOn: today, triggerText: '', recurrenceKind: 'none', tagIds: [], taskId: null, instrumentId: null })
  const initialDraft = useRef(draft)
  const isTask = kind === 'task'
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft.current) || !isTask
  const labelClass = 'form-field form-label'
  const inputClass = 'form-control'

  function setAlreadyDone(checked) {
    if (checked) {
      setDraft((current) => ({ ...current, dueDate: '', recurrenceStartOn: '', recurrenceWeekdays: [], recurrenceTime: '', recurrenceKind: 'none' }))
      onKindChange('activity')
      return
    }
    onKindChange('task')
  }

  function submit() {
    onSave({
      ...draft,
      dueDate: isTask && draft.recurrenceKind === 'none' ? draft.dueDate : '',
      recurrenceStartOn: isTask && draft.recurrenceKind !== 'none' ? (draft.recurrenceStartOn || today) : null,
    })
  }

  return <ModalShell closeDisabled={saving} dirty={dirty} footer={(requestClose) => <ModalActions disabled={saving} onClose={requestClose} onSave={submit} saveDisabled={!draft.title.trim() || (isTask && draft.recurrenceKind === 'weekly' && draft.recurrenceWeekdays.length === 0)} saveLabel={saving ? '저장 중' : '저장'} />} onClose={onClose} title="활동 추가">
    <fieldset className="grid min-w-0 gap-4" disabled={saving}>
      <p className="type-secondary text-[var(--muted-ink)]">{isTask ? '앞으로 할 일을 등록합니다. 완료하면 기록이 연결됩니다.' : '이미 수행한 내용을 기록합니다.'}</p>
      <label className={labelClass}>{isTask ? '할 일 제목' : '기록 제목'}<input autoFocus className={inputClass} onChange={(event) => setDraft({ ...draft, title: event.target.value })} value={draft.title} /></label>
      <label className={labelClass}>{isTask ? '확인할 때' : '기록 내용'}<textarea className={inputClass} maxLength={isTask ? undefined : 25000} onChange={(event) => setDraft({ ...draft, [isTask ? 'triggerText' : 'body']: event.target.value })} rows={5} value={isTask ? draft.triggerText : draft.body} /></label>
      <fieldset>
        <legend className="text-xs text-[var(--muted-ink)]">옵션</legend>
        <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
          <label className="flex min-h-11 items-center gap-2 text-sm"><input checked={!isTask} onChange={(event) => setAlreadyDone(event.target.checked)} type="checkbox" />이미 했음</label>
        </div>
      </fieldset>
      {isTask && <TaskScheduleFields draft={draft} onChange={setDraft} />}
      {!isTask && <CalendarDateField label="수행일" max={today} onChange={(value) => setDraft({ ...draft, occurredOn: value })} value={draft.occurredOn} />}
      {!isTask && <ActivityReferences disabled={saving} instrumentId={draft.instrumentId} onInstrumentChange={(instrumentId) => setDraft((current) => ({ ...current, instrumentId }))} onTaskChange={(taskId) => setDraft((current) => ({ ...current, taskId }))} supabase={supabase} taskId={draft.taskId} />}
      <section className="border-t border-[var(--line)] pt-3">{tagsLoading && <p className="text-sm text-[var(--muted-ink)]">태그 목록을 불러오는 중입니다.</p>}{tagsError && <div className="flex items-center gap-3 text-sm text-red-200"><span>{tagsError}</span><button className="min-h-11 rounded-2xl border border-red-400/40 px-3" onClick={onRetryTags} type="button">다시 시도</button></div>}{!tagsLoading && !tagsError && <ActivityTagPicker disabled={saving} onChange={(tagIds) => setDraft((current) => ({ ...current, tagIds }))} selectedIds={draft.tagIds} tags={tags} />}</section>
    </fieldset>
  </ModalShell>
}
