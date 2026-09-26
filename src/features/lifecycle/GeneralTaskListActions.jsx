import { useState } from 'react'

import { ConfirmDialog } from '../../components/ModalShell'

export default function GeneralTaskListActions({ onComplete, onStop, task }) {
  const repeating = task.recurrence_kind && task.recurrence_kind !== 'none'
  const status = task.status ?? task.task_status
  const canComplete = status === 'open'
  const [confirmStop, setConfirmStop] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function complete() {
    if (pending) return
    setPending(true)
    setError('')
    try { await onComplete(task) }
    catch (nextError) { setError(nextError.message ?? '할 일을 완료하지 못했습니다.') }
    finally { setPending(false) }
  }

  async function stop() {
    if (pending) return
    setPending(true)
    setError('')
    try { await onStop(task); setConfirmStop(false) }
    catch (nextError) { setError(nextError.message ?? '반복을 중단하지 못했습니다.') }
    finally { setPending(false) }
  }

  return <>
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {canComplete && <button className="type-action min-h-11 rounded-xl border border-[var(--line)] px-3 disabled:opacity-50" disabled={pending} onClick={complete} type="button">{repeating ? '이번 완료' : '완료'}</button>}
      {repeating && <button className="type-action min-h-11 rounded-xl border border-[var(--line)] px-3 text-[var(--muted-ink)] disabled:opacity-50" disabled={pending} onClick={() => { setError(''); setConfirmStop(true) }} type="button">중단</button>}
    </div>
    {error && !confirmStop && <p className="type-secondary w-full text-red-200" role="alert">{error}</p>}
    {confirmStop && <ConfirmDialog title="반복을 중단할까요?" description={`${task.title} — 앞으로 이 할 일을 반복하지 않습니다. 기존 기록은 남습니다.`} confirmLabel="중단" danger error={error} pending={pending} onCancel={() => { setConfirmStop(false); setError('') }} onConfirm={stop} />}
  </>
}
