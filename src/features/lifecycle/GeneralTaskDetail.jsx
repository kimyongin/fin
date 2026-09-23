import { useEffect, useState } from 'react'

import ModalShell from '../../components/ModalShell'

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

export default function GeneralTaskDetail({ entry, loading, onBack, onClose, onEndGeneralTask }) {
  const { item } = entry ?? {}
  const [confirmEnding, setConfirmEnding] = useState(false)
  const [ending, setEnding] = useState(false)
  const [endError, setEndError] = useState('')
  useEffect(() => { setConfirmEnding(false); setEndError('') }, [item?.id])

  async function endRepeat() {
    setEnding(true); setEndError('')
    try { await onEndGeneralTask(item) }
    catch (error) { setEndError(error.message ?? '반복을 종료하지 못했습니다.') }
    finally { setEnding(false) }
  }
  return (
    <ModalShell closeDisabled={ending} footer={item?.kind === 'general' && item.recurrence_kind === 'daily' && item.control_state === 'active' && onEndGeneralTask ? <div className="grid gap-3">
      {endError && <p className="text-sm text-red-200" role="alert">{endError}</p>}
      {confirmEnding && <p className="text-sm text-[var(--muted-ink)]">앞으로 표시되는 반복만 종료합니다. 이미 완료한 날짜의 기록은 남습니다.</p>}
      <div className="flex flex-wrap justify-end gap-2">{confirmEnding && <button className="min-h-11 rounded-2xl border border-[var(--line)] px-4 text-sm font-semibold" disabled={ending} onClick={() => setConfirmEnding(false)} type="button">취소</button>}<button className="min-h-11 rounded-2xl border border-red-400/40 px-4 text-sm font-semibold text-red-200 disabled:opacity-50" disabled={ending} onClick={confirmEnding ? endRepeat : () => setConfirmEnding(true)} type="button">{ending ? '종료 중' : confirmEnding ? '반복 종료 확인' : '반복 종료'}</button></div>
    </div> : undefined} onBack={onBack} onClose={onClose} title="할 일 상세">
      {loading || !item ? <p className="py-8 text-sm text-[var(--muted-ink)]">불러오는 중입니다.</p> : (
        <div className="grid gap-6">
          <section>
            <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs">{taskStatusLabel(item)}</span>
            <h3 className="mt-4 break-words text-xl font-semibold leading-8">{item.title}</h3>
            <p className="mt-2 text-xs text-[var(--muted-ink)]">{subjectLabel(item.subject)}</p>
          </section>
          {item.trigger_text && <section><h4 className="text-sm font-semibold">확인할 때</h4><p className="mt-2 text-sm leading-6">{item.trigger_text}</p></section>}
          {item.due_date && <section><h4 className="text-sm font-semibold">예정일</h4><p className="mt-2 text-sm">{formatDate(item.due_date)}</p></section>}
          {item.recurrence_kind === 'daily' && <section><h4 className="text-xs font-semibold text-[var(--muted-ink)]">반복</h4><p className="mt-2 text-sm">매일 반복{item.recurrence_start_on ? ` · ${formatDate(item.recurrence_start_on)}부터` : ''}</p></section>}
        </div>
      )}
    </ModalShell>
  )
}
