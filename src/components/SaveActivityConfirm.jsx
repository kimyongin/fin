import { useEffect, useState } from 'react'
import { ConfirmDialog } from './ModalShell'
import ActivityTagPicker from './ActivityTagPicker'

export default function SaveActivityConfirm({ children, danger = false, description, error, onCancel, onConfirm, onContextChange, open, pending = false, resetKey = 0, supabase, title = '변경 내용 저장' }) {
  const [note, setNote] = useState('')
  const [tagIds, setTagIds] = useState([])
  const [tags, setTags] = useState([])
  const [loading, setLoading] = useState(false)
  const [tagsError, setTagsError] = useState('')
  const [withoutTags, setWithoutTags] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => { setNote(''); setTagIds([]); setWithoutTags(false) }, [resetKey])
  useEffect(() => {
    if (!open) return undefined
    let active = true
    setLoading(true)
    setTagsError('')
    supabase.rpc('app_list_activity_tags', { input_query: null }).then(({ data, error }) => {
      if (error) throw error
      if (active) { setTags(Array.isArray(data) ? data : []); setWithoutTags(false) }
    })
      .catch((cause) => { if (active) setTagsError(cause.message ?? '활동 태그를 불러오지 못했습니다.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, retry, supabase])

  if (!open) return null
  return <ConfirmDialog title={title} description={description} confirmLabel={danger ? '초기화' : '저장'} danger={danger} confirmDisabled={loading || (Boolean(tagsError) && !withoutTags)} error={error} pending={pending} onCancel={onCancel} onConfirm={() => onConfirm({ changeNote: note.trim() || null, activityTagIds: withoutTags ? [] : tagIds })}>
    {children}
    <label className="form-field"><span className="form-label">변경 메모 (선택)</span><textarea className="form-control" disabled={pending} maxLength={1000} onChange={(event) => { setNote(event.target.value); onContextChange?.() }} rows={2} value={note} /></label>
    {loading && <p className="type-secondary text-[var(--muted-ink)]">활동 태그를 불러오는 중입니다.</p>}
    {tagsError && !withoutTags && <div className="type-secondary flex flex-wrap items-center gap-2 text-red-200" role="alert"><span>{tagsError}</span><button className="min-h-11 rounded-xl border border-[var(--line)] px-3" disabled={pending} onClick={() => setRetry((value) => value + 1)} type="button">다시 시도</button><button className="min-h-11 rounded-xl border border-[var(--line)] px-3" disabled={pending} onClick={() => { setTagIds([]); setWithoutTags(true); onContextChange?.() }} type="button">태그 없이 저장</button></div>}
    {withoutTags && <p className="type-secondary text-[var(--muted-ink)]">이번 기록은 태그 없이 저장합니다.</p>}
    {!loading && !tagsError && <ActivityTagPicker disabled={pending} onChange={(ids) => { setTagIds(ids); onContextChange?.() }} selectedIds={tagIds} tags={tags} />}
  </ConfirmDialog>
}
