import { activityUpperTextError } from './activityText'
import { useRef, useState } from 'react'
import ModalShell from '../../components/ModalShell'
import ModalActions from '../../components/ModalActions'

export default function TaskCompletionModal({ task, onClose, onSave }) {
  const [draft, setDraft] = useState({ resultTitle: '', resultSummary: '', result: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const attempt = useRef(null)
  const upperError = activityUpperTextError(draft.resultTitle, draft.resultSummary)
  const valid = !upperError && Object.values(draft).every((value) => value.trim())

  async function save() {
    if (!valid || saving) return
    const fingerprint = JSON.stringify(draft)
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() }
    setSaving(true)
    setError('')
    try { await onSave(task, { ...draft, idempotencyKey: attempt.current.key }); onClose() }
    catch (nextError) { setError(nextError.message ?? '완료 결과를 저장하지 못했습니다.') }
    finally { setSaving(false) }
  }

  return <ModalShell closeDisabled={saving} dirty={Object.values(draft).some(Boolean)} onClose={onClose} title="할 일 완료" footer={(requestClose) => <div className="grid gap-3">
    {error && <p className="type-secondary text-red-200" role="alert">{error}</p>}
    <ModalActions disabled={saving} onClose={requestClose} onSave={save} saveDisabled={!valid} saveLabel={saving ? '저장 중' : '완료 기록 저장'} />
  </div>}>
    <fieldset className="grid min-w-0 gap-4" disabled={saving}>
      <p className="type-secondary break-words text-[var(--muted-ink)]">{task.title} — 실제 수행한 결과를 기록해 주세요.</p>
      <p className="type-meta text-[var(--muted-ink)]">결과 제목 100자·요약 300자 이내로 작성해 주세요.</p>
      {upperError && (draft.resultTitle || draft.resultSummary) && <p className="type-secondary text-red-200" role="alert">{upperError}</p>}
      <label className="form-field form-label">결과 제목<input autoFocus className="form-control" onChange={(event) => setDraft({ ...draft, resultTitle: event.target.value })} value={draft.resultTitle} /></label>
      <label className="form-field form-label">결과 요약<textarea className="form-control" rows={3} onChange={(event) => setDraft({ ...draft, resultSummary: event.target.value })} value={draft.resultSummary} /></label>
      <label className="form-field form-label">결과 본문<textarea className="form-control" maxLength={25000} rows={7} onChange={(event) => setDraft({ ...draft, result: event.target.value })} value={draft.result} /></label>
    </fieldset>
  </ModalShell>
}
