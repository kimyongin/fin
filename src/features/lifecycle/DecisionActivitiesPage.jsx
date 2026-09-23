import { useEffect, useRef, useState } from 'react'

import ModalShell from '../../components/ModalShell'
import { useDetailHistoryEntry } from '../../hooks/useDetailHistoryEntry'
import { createRequestGate } from '../../lib/requestGate'
import { fetchDecisionActivities } from './data'
import ActivityNarrative from './ActivityNarrative'

const stateLabels = { proposed: '제안', adopted: '내가 채택함', dismissed: '채택하지 않음' }

function formatMoment(value) {
  return value ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '-'
}

function DecisionDetail({ item, onClose }) {
  const context = item.context ?? {}
  return <ModalShell onClose={onClose} title="판단 상세" variant="detail"><div className="grid gap-5">
    <div><span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs">{stateLabels[context.decision_state] ?? '판단 기록'}</span><h3 className="mt-4 break-words text-xl font-semibold leading-8">{item.title}</h3><p className="mt-2 text-xs text-[var(--muted-ink)]">기록 {formatMoment(item.occurred_at)}</p></div>
    <ActivityNarrative sections={[
      { label: '확인한 사실', content: item.result, markdown: true },
      { label: '판단 내용', content: item.conclusion, markdown: true },
      { label: '사용자가 선택한 안', content: context.selected_option },
      { label: '선택한 이유', content: context.reason },
      { label: '메모', content: item.note, markdown: true },
    ]} sources={context.sources} sourcesTitle="근거 출처" />
  </div></ModalShell>
}

export default function DecisionActivitiesPage({ ownerUserId = null, supabase }) {
  const [items, setItems] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const requestGate = useRef(createRequestGate())
  const closeDetail = useDetailHistoryEntry(Boolean(selected), () => setSelected(null))

  async function load(cursor = null) {
    const request = requestGate.current.begin()
    setLoading(true)
    setError('')
    try {
      const page = await fetchDecisionActivities(supabase, { cursor, ownerUserId })
      if (!request.isCurrent()) return
      setItems((current) => cursor ? [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()] : page.items)
      setNextCursor(page.nextCursor)
    } catch (nextError) {
      if (request.isCurrent()) setError(nextError.message ?? '판단 기록을 불러오지 못했습니다.')
    } finally {
      if (request.isCurrent()) setLoading(false)
    }
  }

  useEffect(() => {
    setSelected(null)
    load()
    return () => requestGate.current.invalidate()
  }, [ownerUserId, supabase])

  return <section className="grid gap-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">판단 모아보기</h2><p className="mt-1 text-sm leading-6 text-[var(--muted-ink)]">제안과 내가 선택한 판단을 실제 체결과 구분해 기록합니다.</p></div><button className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold" disabled={loading} onClick={() => load()} type="button">새로고침</button></header>
    {error && <p className="rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</p>}
    {loading && items.length === 0 ? <p className="py-8 text-sm text-[var(--muted-ink)]">판단 기록을 불러오는 중입니다.</p> : items.length === 0 ? <p className="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted-ink)]">저장된 판단 활동이 없습니다. 활동 추가에서 ‘판단’을 선택하거나 ChatGPT에게 기록을 요청할 수 있습니다.</p> : <ol className="grid gap-3">{items.map((item) => <li key={item.id}><button className="min-h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 text-left transition hover:bg-[var(--surface-2)] sm:p-5" onClick={() => setSelected(item)} type="button"><span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs">{stateLabels[item.context?.decision_state] ?? '판단 기록'}</span><h3 className="mt-3 break-words font-semibold leading-6">{item.title}</h3>{item.conclusion && <p className="mt-2 break-words text-sm text-[var(--muted-ink)]">{item.conclusion}</p>}<time className="mt-3 block text-xs text-[var(--muted-ink)]">{formatMoment(item.occurred_at)}</time></button></li>)}{nextCursor && <li><button className="min-h-11 w-full rounded-xl border border-[var(--line)] px-4 text-sm font-semibold" disabled={loading} onClick={() => load(nextCursor)} type="button">{loading ? '불러오는 중' : '더 보기'}</button></li>}</ol>}
    {selected && <DecisionDetail item={selected} onClose={closeDetail} />}
  </section>
}
