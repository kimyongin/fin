import { useEffect, useMemo, useState } from 'react'

import ModalShell from '../../components/ModalShell'
import ActivityTagPicker from './ActivityTagPicker'
import { createActivityFollowUp, fetchActivityTags, setActivityTags, updateActivity } from './data'

function localDate(value) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-CA')
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

const activityKindLabels = { general: '일반', research: '조사', review: '점검', decision: '판단', retrospective: '회고', trade: '매매', reconciliation: '보정', task: '할 일' }

export default function ActivityDetailModal({ activity, loading, onClose, onOpenDecision, onOpenTask, onSaved, ownerUserId, supabase }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({ title: '', note: '', result: '', conclusion: '', occurredOn: '', recordKind: 'general' })
  const [followUp, setFollowUp] = useState({ title: '', dueDate: '' })
  const [availableTags, setAvailableTags] = useState([])
  const [selectedTagIds, setSelectedTagIds] = useState([])
  const editable = useMemo(() => new Set(activity?.editable_fields ?? []), [activity])

  useEffect(() => {
    if (!activity) return
    setDraft({
      title: activity.title ?? '',
      note: activity.note ?? '',
      result: activity.result ?? '',
      conclusion: activity.conclusion ?? '',
      occurredOn: localDate(activity.occurred_at),
      recordKind: activity.record_kind ?? 'general',
    })
    setEditing(false)
    setError('')
    setSelectedTagIds((activity.tags ?? []).map((tag) => tag.id))
  }, [activity])

  useEffect(() => {
    if (ownerUserId) return
    fetchActivityTags(supabase).then(setAvailableTags).catch(() => setAvailableTags([]))
  }, [ownerUserId, supabase])

  async function save() {
    setSaving(true)
    setError('')
    try {
      const patch = {}
      if (editable.has('title')) patch.title = draft.title
      if (editable.has('note')) patch.note = draft.note || null
      if (editable.has('result')) patch.result = draft.result || null
      if (editable.has('conclusion')) patch.conclusion = draft.conclusion || null
      if (editable.has('record_kind') && draft.recordKind !== activity.record_kind) patch.record_kind = draft.recordKind
      if (editable.has('occurred_at') && draft.occurredOn !== localDate(activity.occurred_at)) {
        patch.occurred_at = `${draft.occurredOn}T12:00:00+09:00`
        patch.timezone = 'Asia/Seoul'
      }
      const saved = await updateActivity(supabase, activity, patch)
      onSaved(saved)
      setEditing(false)
    } catch (nextError) {
      setError(nextError.message ?? '활동을 수정하지 못했습니다.')
    } finally { setSaving(false) }
  }

  async function addFollowUp() {
    setSaving(true)
    setError('')
    try {
      await createActivityFollowUp(supabase, activity.id, {
        title: followUp.title,
        dueDate: followUp.dueDate,
        idempotencyKey: crypto.randomUUID(),
      })
      setFollowUp({ title: '', dueDate: '' })
      onSaved(activity, { reload: true })
    } catch (nextError) {
      setError(nextError.message ?? '후속 할 일을 추가하지 못했습니다.')
    } finally { setSaving(false) }
  }

  async function saveTags() {
    setSaving(true); setError('')
    try {
      const saved = await setActivityTags(supabase, activity, selectedTagIds)
      onSaved(saved)
    } catch (nextError) { setError(nextError.message ?? '활동 태그를 저장하지 못했습니다.') }
    finally { setSaving(false) }
  }

  return <ModalShell onClose={onClose} title="활동 상세" variant="detail">
    {loading || !activity ? <p className="py-8 text-sm text-[var(--muted-ink)]">활동을 불러오는 중입니다.</p> : <div className="grid gap-6">
      {error && <p className="rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-100">{error}</p>}
      <section className="grid gap-3">
        {editing && editable.has('title') ? <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">제목</span><input autoFocus className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" maxLength={500} onChange={(event) => setDraft({ ...draft, title: event.target.value })} value={draft.title} /></label> : <h3 className="break-words text-xl font-semibold leading-8">{activity.title || activity.after_data?.title || activity.action_type}</h3>}
        <p className="text-xs text-[var(--muted-ink)]">{formatDateTime(activity.occurred_at)} · {activityKindLabels[activity.record_kind] ?? '활동'} · {activity.source === 'agent' ? 'ChatGPT' : '앱'}</p>
      </section>

      {editing && editable.has('occurred_at') && <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">수행일</span><input className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" max={new Date().toLocaleDateString('en-CA')} onChange={(event) => setDraft({ ...draft, occurredOn: event.target.value })} type="date" value={draft.occurredOn} /></label>}
      {editing && editable.has('record_kind') && <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">활동 종류</span><select className="min-h-11 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" onChange={(event) => setDraft({ ...draft, recordKind: event.target.value })} value={draft.recordKind}>{['general','research','review','decision','retrospective'].map((kind) => <option key={kind} value={kind}>{activityKindLabels[kind]}</option>)}</select></label>}
      {['result', 'conclusion', 'note'].map((field) => {
        const labels = { result: '결과', conclusion: '결론', note: '메모' }
        const value = editing ? draft[field] : activity[field]
        if (!editing && !value) return null
        if (editing && !editable.has(field)) return value ? <section key={field}><h4 className="text-sm font-semibold">{labels[field]}</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted-ink)]">{value}</p></section> : null
        return <label className="grid gap-1.5" key={field}><span className="text-sm font-semibold">{labels[field]}</span>{editing ? <textarea className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2" maxLength={4000} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} rows={3} value={value} /> : <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--muted-ink)]">{value}</p>}</label>
      })}

      {activity.after_data?.context && <section><h4 className="text-sm font-semibold">조사 범위와 출처</h4>{activity.after_data.context.scope && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted-ink)]">{typeof activity.after_data.context.scope === 'string' ? activity.after_data.context.scope : JSON.stringify(activity.after_data.context.scope)}</p>}{Array.isArray(activity.after_data.context.sources) && <ul className="mt-2 grid gap-2">{activity.after_data.context.sources.filter((source) => /^https?:\/\//i.test(source?.url ?? '')).map((source, index) => <li key={`${source.url}-${index}`}><a className="break-words text-sm text-[var(--accent)] underline" href={source.url} rel="noreferrer" target="_blank">{String(source.title ?? source.url)}</a></li>)}</ul>}</section>}

      {!ownerUserId && editable.size > 0 && <div className="flex justify-end gap-2">{editing ? <><button className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm" disabled={saving} onClick={() => setEditing(false)} type="button">취소</button><button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={saving || (editable.has('title') && !draft.title.trim())} onClick={save} type="button">{saving ? '저장 중' : '저장'}</button></> : <button className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm" onClick={() => setEditing(true)} type="button">수정</button>}</div>}

      {!ownerUserId && <section className="rounded-2xl border border-[var(--line)] p-4"><ActivityTagPicker disabled={saving} onChange={setSelectedTagIds} onTagsChanged={(tags, ids) => { setAvailableTags(tags); setSelectedTagIds(ids) }} selectedIds={selectedTagIds} supabase={supabase} tags={availableTags} /><div className="mt-3 flex justify-end"><button className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={saving} onClick={saveTags} type="button">태그 저장</button></div></section>}

      {activity.target_table === 'investment_decisions' && activity.target_id && <button className="rounded-xl border border-[var(--line)] px-4 py-3 text-left text-sm font-semibold" onClick={() => onOpenDecision(activity.target_id)} type="button">판단 상세 보기</button>}
      {activity.origin_task && <button className="rounded-xl border border-[var(--line)] px-4 py-3 text-left text-sm font-semibold" onClick={() => onOpenTask(activity.origin_task.id)} type="button">원래 할 일 보기 · {activity.origin_task.title}</button>}
      {activity.follow_up_tasks?.length > 0 && <section><h4 className="text-sm font-semibold">이어진 할 일</h4><div className="mt-2 grid gap-2">{activity.follow_up_tasks.map((task) => <button className="rounded-2xl bg-[var(--surface-2)] p-3 text-left text-sm" key={task.id} onClick={() => onOpenTask(task.id)} type="button">{task.title}{task.due_date ? <span className="ml-2 text-xs text-[var(--muted-ink)]">{task.due_date}</span> : null}</button>)}</div></section>}
      {!ownerUserId && <section className="rounded-2xl border border-[var(--line)] p-4"><h4 className="text-sm font-semibold">후속 할 일</h4><p className="mt-1 text-xs text-[var(--muted-ink)]">이 활동을 계기로 다음에 할 일을 남깁니다.</p><div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"><input className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm" onChange={(event) => setFollowUp({ ...followUp, title: event.target.value })} placeholder="예: 다음 실적 발표 확인" value={followUp.title} /><input className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm" onChange={(event) => setFollowUp({ ...followUp, dueDate: event.target.value })} type="date" value={followUp.dueDate} /><button className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={saving || !followUp.title.trim()} onClick={addFollowUp} type="button">추가</button></div></section>}
    </div>}
  </ModalShell>
}
