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
    <ModalShell closeDisabled={ending} onBack={onBack} onClose={onClose} title="할 일 상세">
      {loading || !item ? <p className="py-8 text-sm text-[var(--muted-ink)]">불러오는 중입니다.</p> : (
        <div className="grid gap-6">
          <section>
            <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs">{taskStatusLabel(item)}</span>
            <h3 className="mt-4 break-words text-xl font-semibold leading-8">{item.title}</h3>
            <p className="mt-2 text-xs text-[var(--muted-ink)]">{subjectLabel(item.subject)}</p>
          </section>
          {item.trigger_text && <section><h4 className="text-sm font-semibold">확인할 때</h4><p className="mt-2 text-sm leading-6">{item.trigger_text}</p></section>}
          {item.due_date && <section><h4 className="text-sm font-semibold">예정일</h4><p className="mt-2 text-sm">{formatDate(item.due_date)}</p></section>}
          {item.kind === 'general' && item.recurrence_kind === 'daily' && item.control_state === 'active' && onEndGeneralTask && <section className="rounded-2xl border border-[var(--line)] p-4"><h4 className="text-sm font-semibold">매일 반복</h4><p className="mt-1 text-sm text-[var(--muted-ink)]">앞으로 표시되는 반복만 종료합니다. 이미 완료한 날짜의 활동은 그대로 남습니다.</p>{endError && <p className="mt-2 text-sm text-red-300">{endError}</p>}<div className="mt-3 flex flex-wrap gap-2">{confirmEnding ? <><button className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" disabled={ending} onClick={() => setConfirmEnding(false)} type="button">취소</button><button className="rounded-xl border border-red-400/40 px-3 py-2 text-sm text-red-300 disabled:opacity-50" disabled={ending} onClick={endRepeat} type="button">{ending ? '종료 중' : '반복 종료 확인'}</button></> : <button className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" onClick={() => setConfirmEnding(true)} type="button">반복 종료</button>}</div></section>}
          <p className="rounded-2xl bg-[var(--surface-2)] p-4 text-sm leading-6 text-[var(--muted-ink)]">이 항목은 앞으로 할 일입니다. 완료하면 실제로 수행한 활동 기록이 연결됩니다.</p>
        </div>
      )}
    </ModalShell>
  )
}
