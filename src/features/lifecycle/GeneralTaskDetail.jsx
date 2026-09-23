import { useEffect, useRef, useState } from 'react'

import ModalShell from '../../components/ModalShell'
import ModalActions from '../../components/ModalActions'
import ActivityTagPicker from './ActivityTagPicker'
import { businessDate } from '../../lib/businessDate'

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
    tagIds: (item?.tags ?? []).map((tag) => tag.id).sort() }
}

export default function GeneralTaskDetail({ availableTags = [], entry, historyGuardRef, loading, onBack, onClose, onEndGeneralTask, onRetryTags, onSaveTask, onTagsChanged, ownerUserId, supabase, tagsError = '', tagsLoading = false }) {
  const { item } = entry ?? {}
  const [draft, setDraft] = useState(() => taskDraft(item))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [tagsExpanded, setTagsExpanded] = useState(false)
  const attempt = useRef(null)
  const [confirmEnding, setConfirmEnding] = useState(false)
  const [ending, setEnding] = useState(false)
  const [endError, setEndError] = useState('')
  useEffect(() => { setDraft(taskDraft(item)); setConfirmEnding(false); setEndError(''); setSaveError(''); attempt.current = null }, [item?.id, item?.version, item?.updated_at])
  const editable = !ownerUserId && Boolean(item) && item.control_state === 'active'
  const dirty = editable && JSON.stringify(draft) !== JSON.stringify(taskDraft(item))
  const labelClass = 'grid min-w-0 gap-2 text-xs font-semibold text-[var(--muted-ink)]'
  const inputClass = 'min-h-11 w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 text-base font-normal text-[var(--ink)] outline-none focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40'

  async function save() {
    if (!dirty || saving || !draft.title.trim()) return
    const fingerprint = JSON.stringify({ id: item.id, version: item.version, draft })
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() }
    setSaving(true); setSaveError('')
    try { await onSaveTask(item, { ...draft, idempotencyKey: attempt.current.key }); attempt.current = null }
    catch (error) { setSaveError(error.message ?? '할 일을 저장하지 못했습니다.') }
    finally { setSaving(false) }
  }

  async function endRepeat() {
    setEnding(true); setEndError('')
    try { await onEndGeneralTask(item) }
    catch (error) { setEndError(error.message ?? '반복을 종료하지 못했습니다.') }
    finally { setEnding(false) }
  }
  return (
    <ModalShell closeDisabled={ending || saving} dirty={dirty} historyGuardRef={historyGuardRef} footer={(requestClose) => <div className="grid gap-3">
      {saveError && <p className="text-sm text-red-200" role="alert">{saveError}</p>}
      {endError && <p className="text-sm text-red-200" role="alert">{endError}</p>}
      {confirmEnding && <p className="text-sm text-[var(--muted-ink)]">앞으로 표시되는 반복만 종료합니다. 이미 완료한 날짜의 기록은 남습니다.</p>}
      {editable && <ModalActions disabled={saving || ending} onClose={requestClose} onSave={save} saveDisabled={!dirty || !draft.title.trim() || tagsLoading || Boolean(tagsError)} saveLabel={saving ? '저장 중' : '저장'} />}
      {item?.kind === 'general' && item.recurrence_kind === 'daily' && item.control_state === 'active' && onEndGeneralTask && <div className="flex flex-wrap justify-end gap-2">{confirmEnding && <button className="min-h-11 rounded-2xl border border-[var(--line)] px-4 text-sm font-semibold" disabled={ending} onClick={() => setConfirmEnding(false)} type="button">취소</button>}<button className="min-h-11 rounded-2xl border border-red-400/40 px-4 text-sm font-semibold text-red-200 disabled:opacity-50" disabled={ending || dirty} onClick={confirmEnding ? endRepeat : () => setConfirmEnding(true)} type="button">{ending ? '종료 중' : confirmEnding ? '반복 종료 확인' : '반복 종료'}</button></div>}
    </div>} onBack={dirty ? null : onBack} onClose={onClose} title="할 일 상세">
      {loading || !item ? <p className="py-8 text-sm text-[var(--muted-ink)]">불러오는 중입니다.</p> : (
        editable ? <fieldset className="grid min-w-0 gap-4" disabled={saving || ending}>
          <label className={labelClass}>할 일 제목<input className={inputClass} maxLength={500} onChange={(event) => setDraft({ ...draft, title: event.target.value })} value={draft.title} /></label>
          <label className={labelClass}>확인할 때<textarea className={inputClass} onChange={(event) => setDraft({ ...draft, triggerText: event.target.value })} rows={3} value={draft.triggerText} /></label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input checked={draft.recurrenceKind === 'daily'} onChange={(event) => setDraft({ ...draft, recurrenceKind: event.target.checked ? 'daily' : 'none', recurrenceStartOn: event.target.checked ? (draft.recurrenceStartOn || draft.dueDate || businessDate()) : '' })} type="checkbox" />매일 반복</label>
          <label className={labelClass}>{draft.recurrenceKind === 'daily' ? '반복 시작일' : '예정일'}<input className={inputClass} onChange={(event) => setDraft({ ...draft, [draft.recurrenceKind === 'daily' ? 'recurrenceStartOn' : 'dueDate']: event.target.value })} type="date" value={draft.recurrenceKind === 'daily' ? draft.recurrenceStartOn : draft.dueDate} /></label>
          <section className="border-t border-[var(--line)] pt-3"><button aria-expanded={tagsExpanded || Boolean(tagsError)} className="flex min-h-11 w-full items-center justify-between text-left text-sm font-semibold" onClick={() => setTagsExpanded((open) => !open)} type="button">태그{draft.tagIds.length ? ` · ${draft.tagIds.map((id) => availableTags.find((tag) => tag.id === id)?.name).filter(Boolean).join(', ')}` : ''}<span aria-hidden="true">{tagsExpanded ? '−' : '+'}</span></button>{(tagsExpanded || tagsError) && <div className="mt-3">{tagsLoading && <p className="text-sm text-[var(--muted-ink)]">태그 목록을 불러오는 중입니다.</p>}{tagsError && <div className="flex items-center gap-3 text-sm text-red-200"><span>{tagsError}</span><button className="min-h-11 rounded-xl border border-red-400/40 px-3" onClick={onRetryTags} type="button">다시 시도</button></div>}<ActivityTagPicker disabled={saving || tagsLoading || Boolean(tagsError)} onChange={(tagIds) => setDraft((current) => ({ ...current, tagIds: [...tagIds].sort() }))} onTagsChanged={(tags, tagIds) => { onTagsChanged(tags); setDraft((current) => ({ ...current, tagIds: [...tagIds].sort() })) }} selectedIds={draft.tagIds} supabase={supabase} tags={availableTags} /></div>}</section>
        </fieldset> : <div className="grid gap-6">
          <section>
            <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs">{taskStatusLabel(item)}</span>
            <h3 className="mt-4 break-words text-xl font-semibold leading-8">{item.title}</h3>
            <p className="mt-2 text-xs text-[var(--muted-ink)]">{subjectLabel(item.subject)}</p>
          </section>
          {item.trigger_text && <section><h4 className="text-sm font-semibold">확인할 때</h4><p className="mt-2 text-sm leading-6">{item.trigger_text}</p></section>}
          {item.due_date && <section><h4 className="text-sm font-semibold">예정일</h4><p className="mt-2 text-sm">{formatDate(item.due_date)}</p></section>}
          {item.recurrence_kind === 'daily' && <section><h4 className="text-xs font-semibold text-[var(--muted-ink)]">반복</h4><p className="mt-2 text-sm">매일 반복{item.recurrence_start_on ? ` · ${formatDate(item.recurrence_start_on)}부터` : ''}</p></section>}
          {item.tags?.length > 0 && <p className="text-sm">태그 · {item.tags.map((tag) => tag.name).join(', ')}</p>}
        </div>
      )}
    </ModalShell>
  )
}
