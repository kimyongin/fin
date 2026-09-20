import { useEffect, useState } from 'react'

import ModalShell from '../../components/ModalShell'
import {
  fetchInvestmentDecision,
  fetchInvestmentDecisions,
  fetchPortfolioTask,
  fetchPortfolioTasks,
} from './data'

const decisionStatus = {
  proposed: '제안',
  adopted: '내가 채택함',
  dismissed: '채택하지 않음',
  superseded: '새 판단으로 대체됨',
}

const taskStatus = {
  open: '확인 필요',
  waiting: '자료 대기',
  resolved: '답을 확인함',
  closed: '종료',
}

function taskStatusLabel(task) {
  if (task.kind === 'execution') {
    if (task.control_state === 'paused') return '보류'
    if (task.control_state === 'cancelled') return '취소'
    return { planned: '실행 예정', partial: '일부 체결', completed: '체결 완료' }[task.execution_plan?.progress] ?? '실행 예정'
  }
  if (task.research_state === 'closed') return taskStatus.closed
  if (task.control_state === 'paused') return '보류'
  if (task.control_state === 'cancelled') return '취소'
  return taskStatus[task.research_state] ?? task.research_state
}

function formatDate(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(value))
}

function subjectLabel(subject) {
  if (!subject || subject.kind === 'portfolio') return '전체 포트폴리오'
  return subject.label || subject.instrument_id || '대상 종목'
}

function EmptyState({ mode }) {
  return (
    <article className="rounded-[28px] border border-dashed border-[var(--line)] bg-[var(--panel)] p-7 text-center">
      <h2 className="text-lg font-semibold">아직 저장된 {mode === 'decisions' ? '판단' : '할 일'}이 없습니다.</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--muted-ink)]">
        {mode === 'decisions'
          ? 'ChatGPT에게 “이 판단을 기록해줘”라고 명시하면 제안과 내가 채택한 결정을 구분해 저장합니다.'
          : '판단과 함께 다음에 확인할 질문을 기록하면 이곳에서 이어서 볼 수 있습니다.'}
      </p>
    </article>
  )
}

function Detail({ item, loading, mode, onClose }) {
  const latestTaskHistory = mode === 'tasks' && item?.history?.length
    ? item.history[item.history.length - 1]
    : null
  return (
    <ModalShell onClose={onClose} title={mode === 'decisions' ? '판단 상세' : '할 일 상세'}>
      {loading || !item ? <p className="py-8 text-sm text-[var(--muted-ink)]">불러오는 중입니다.</p> : mode === 'decisions' ? (
        <div className="grid gap-6">
          <section>
            <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs">{decisionStatus[item.status] ?? item.status}</span>
            <h3 className="mt-4 text-xl font-semibold leading-8">{item.question}</h3>
            <p className="mt-2 text-xs text-[var(--muted-ink)]">{subjectLabel(item.subject)} · {formatDate(item.created_at)}</p>
          </section>
          {item.selected_option && <section><h4 className="text-sm font-semibold">선택</h4><p className="mt-2 text-sm leading-6">{item.selected_option}</p></section>}
          {item.reason && <section><h4 className="text-sm font-semibold">선택한 이유</h4><p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">{item.reason}</p></section>}
          {item.uncertainty && <section><h4 className="text-sm font-semibold">아직 불확실한 점</h4><p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">{item.uncertainty}</p></section>}
          {item.review_condition && <section><h4 className="text-sm font-semibold">다시 볼 조건</h4><p className="mt-2 text-sm leading-6">{item.review_condition}</p></section>}
          {item.tasks?.length > 0 && <section><h4 className="text-sm font-semibold">연결된 할 일</h4><ul className="mt-2 grid gap-2">{item.tasks.map((task) => <li className="rounded-2xl bg-[var(--surface-2)] p-3 text-sm" key={task.id}>{task.title}</li>)}</ul></section>}
        </div>
      ) : (
        <div className="grid gap-6">
          <section>
            <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs">{taskStatusLabel(item)}</span>
            <h3 className="mt-4 text-xl font-semibold leading-8">{item.title}</h3>
            <p className="mt-2 text-xs text-[var(--muted-ink)]">{subjectLabel(item.subject)}</p>
          </section>
          {item.trigger_text && <section><h4 className="text-sm font-semibold">확인할 때</h4><p className="mt-2 text-sm leading-6">{item.trigger_text}</p></section>}
          {item.due_date && <section><h4 className="text-sm font-semibold">예정일</h4><p className="mt-2 text-sm">{formatDate(item.due_date)}</p></section>}
          {item.execution_plan && <section><h4 className="text-sm font-semibold">체결 진행</h4><p className="mt-2 text-sm leading-6">{item.execution_plan.side === 'buy' ? '매수' : '매도'} {Number(item.execution_plan.filled_quantity).toLocaleString()} / {Number(item.execution_plan.target_quantity).toLocaleString()}주</p>{Number(item.execution_plan.overfilled_quantity) > 0 && <p className="mt-1 text-xs text-[var(--muted-ink)]">계획보다 {Number(item.execution_plan.overfilled_quantity).toLocaleString()}주 더 체결됨</p>}</section>}
          {latestTaskHistory?.answer && <section><h4 className="text-sm font-semibold">확인한 답</h4><p className="mt-2 text-sm leading-6">{latestTaskHistory.answer}</p></section>}
          {latestTaskHistory?.evidence?.length > 0 && (
            <section>
              <h4 className="text-sm font-semibold">확인 근거</h4>
              <ul className="mt-2 grid gap-2">
                {latestTaskHistory.evidence.map((evidence) => (
                  <li className="rounded-2xl bg-[var(--surface-2)] p-3" key={evidence.id}>
                    <a className="text-sm font-semibold text-[var(--accent)] underline" href={evidence.source_url} rel="noreferrer" target="_blank">{evidence.title}</a>
                    <p className="mt-1 text-sm leading-6 text-[var(--muted-ink)]">{evidence.summary}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="rounded-2xl bg-[var(--surface-2)] p-4 text-sm leading-6 text-[var(--muted-ink)]">{item.kind === 'execution' ? '이 항목은 실행 계획입니다. 연결된 실제 체결만 진행도에 반영되며 계획 자체는 주문이나 체결이 아닙니다.' : '이 항목은 조사·점검할 질문입니다. 매매 주문이나 체결 기록이 아닙니다.'}</p>
        </div>
      )}
    </ModalShell>
  )
}

export default function LifecyclePage({ mode, supabase }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    const request = mode === 'decisions'
      ? fetchInvestmentDecisions(supabase)
      : fetchPortfolioTasks(supabase)
    request.then((data) => { if (active) setItems(data) })
      .catch((nextError) => { if (active) setError(nextError.message ?? '기록을 불러오지 못했습니다.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [mode, supabase])

  async function openDetail(id) {
    setDetailLoading(true)
    setSelected({ id })
    setError('')
    try {
      setSelected(mode === 'decisions'
        ? await fetchInvestmentDecision(supabase, id)
        : await fetchPortfolioTask(supabase, id))
    } catch (nextError) {
      setSelected(null)
      setError(nextError.message ?? '상세 기록을 불러오지 못했습니다.')
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <section className="mt-8 grid gap-5">
      <header className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">{mode === 'decisions' ? 'Decision log' : 'Follow-up queue'}</p>
        <h2 className="mt-2 text-xl font-semibold">{mode === 'decisions' ? '왜 유지하거나 바꾸기로 했는지 기억합니다.' : '다음 점검에서 이어갈 질문을 놓치지 않습니다.'}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">ChatGPT가 생각을 돕고, Portfolio는 사용자가 저장하라고 한 결과와 상태를 보존합니다.</p>
      </header>
      {error && <p className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {!loading && items.length === 0 ? <EmptyState mode={mode} /> : (
        <div className="grid gap-3">
          {items.map((item) => (
            <button className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 text-left transition hover:bg-[var(--surface-2)] sm:p-5" key={item.id} onClick={() => openDetail(item.id)} type="button">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-[var(--muted-ink)]">{subjectLabel(item.subject)}</span>
                <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs">{mode === 'decisions' ? decisionStatus[item.status] : taskStatusLabel(item)}</span>
              </div>
              <h3 className="mt-3 font-semibold leading-6">{mode === 'decisions' ? item.question : item.title}</h3>
              {mode === 'decisions' && item.selected_option && <p className="mt-2 text-sm text-[var(--accent)]">{item.selected_option}</p>}
              <p className="mt-3 text-xs text-[var(--muted-ink)]">{item.due_date ? `예정 ${formatDate(item.due_date)}` : `갱신 ${formatDate(item.updated_at)}`}</p>
            </button>
          ))}
        </div>
      )}
      {selected && <Detail item={selected.id && !selected.question && !selected.title ? null : selected} loading={detailLoading} mode={mode} onClose={() => setSelected(null)} />}
    </section>
  )
}
