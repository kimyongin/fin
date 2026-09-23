import { useRef, useState } from 'react'

import ModalShell from '../../components/ModalShell'
import { businessDate } from '../../lib/businessDate'
import ActivityTagPicker from './ActivityTagPicker'

export default function GeneralActionModal({ kind, onClose, onKindChange, onRetryTags, onSave, onTagsChanged, saving, supabase, tags, tagsError = '', tagsLoading = false }) {
  const today = businessDate()
  const [draft, setDraft] = useState({ title: '', result: '', scheduleDate: '', occurredOn: today, triggerText: '', recurrenceKind: 'none', category: 'general', decisionState: 'proposed', selectedOption: '', reason: '', scope: '', sourceTitle: '', sourceUrl: '', tagIds: [] })
  const initialDraft = useRef(draft)
  const isTask = kind === 'task'
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft.current) || !isTask
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

  return <ModalShell closeDisabled={saving} dirty={dirty} footer={(requestClose) => <div className="flex justify-end gap-2"><button className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm" disabled={saving} onClick={requestClose} type="button">취소</button><button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!draft.title.trim() || saving || !sourceComplete || (draft.category === 'decision' && draft.decisionState === 'adopted' && (!draft.selectedOption.trim() || !draft.reason.trim()))} onClick={submit} type="button">{saving ? '저장 중' : '저장'}</button></div>} onClose={onClose} title="활동 추가">
    <fieldset className="grid min-w-0 gap-4" disabled={saving}>
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
      {tagsLoading && <p className="text-xs text-[var(--muted-ink)]">태그 목록을 불러오는 중입니다.</p>}
      {tagsError && <div className="flex items-center gap-3 text-xs text-red-200"><span>{tagsError}</span><button className="rounded-lg border border-red-400/40 px-3 py-2" onClick={onRetryTags} type="button">다시 시도</button></div>}
      <ActivityTagPicker disabled={saving || tagsLoading || Boolean(tagsError)} onChange={(tagIds) => setDraft({ ...draft, tagIds })} onTagsChanged={(nextTags, tagIds) => { onTagsChanged(nextTags); setDraft((current) => ({ ...current, tagIds })) }} selectedIds={draft.tagIds} supabase={supabase} tags={tags} />
    </fieldset>
  </ModalShell>
}
