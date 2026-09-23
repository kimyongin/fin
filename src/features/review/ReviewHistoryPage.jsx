import { useEffect, useRef, useState } from 'react'

import ModalShell from '../../components/ModalShell'
import { useDetailHistoryEntry } from '../../hooks/useDetailHistoryEntry'
import { createRequestGate } from '../../lib/requestGate'
import { fetchReviewActivities } from './data'
import ActivityNarrative from '../lifecycle/ActivityNarrative'

const statusLabels = { no_action: '추가 조치 없음', attention: '확인 필요', insufficient_data: '판단 자료 부족' }
const coverageLabels = { complete: '조사 완료', partial: '일부 조사', failed: '자료 부족' }

function formatMoment(value) {
  return value ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '-'
}

function ReviewStatus({ review }) {
  const { status, coverage_status: coverage } = review.context ?? {}
  if (!status && !coverage) return null
  return <div className="flex flex-wrap gap-2 text-xs">
    {status && <span className="rounded-full border border-[var(--line)] px-2.5 py-1">{statusLabels[status] ?? status}</span>}
    {coverage && <span className="rounded-full border border-[var(--line)] px-2.5 py-1">{coverageLabels[coverage] ?? coverage}</span>}
  </div>
}

function ReviewDetail({ review, onClose }) {
  const context = review.context ?? {}
  return <ModalShell onClose={onClose} title="점검 상세" variant="detail"><div className="grid gap-5">
    <ReviewStatus review={review} />
    <div><h3 className="text-xl font-semibold leading-8">{review.title}</h3><p className="mt-2 text-xs text-[var(--muted-ink)]">기록 {formatMoment(review.occurred_at)}</p></div>
    <ActivityNarrative sections={[
      { label: '확인한 사실과 변화', content: review.result, markdown: true },
      { label: '결론', content: review.conclusion, markdown: true },
      { label: '메모', content: review.note, markdown: true },
      { label: '확인 범위', content: context.scope },
    ]} sources={context.sources} />
  </div></ModalShell>
}

export default function ReviewHistoryPage({ ownerUserId = null, supabase }) {
  const [reviews, setReviews] = useState([])
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
      const page = await fetchReviewActivities(supabase, { cursor, ownerUserId })
      if (!request.isCurrent()) return
      setReviews((previous) => cursor ? [...new Map([...previous, ...page.items].map((item) => [item.id, item])).values()] : page.items)
      setNextCursor(page.nextCursor)
    } catch (nextError) {
      if (request.isCurrent()) setError(nextError.message ?? '점검 기록을 불러오지 못했습니다.')
    } finally {
      if (request.isCurrent()) setLoading(false)
    }
  }

  useEffect(() => {
    setSelected(null)
    load()
    return () => requestGate.current.invalidate()
  }, [ownerUserId, supabase])

  const latest = reviews[0]
  return <section className="grid gap-5">
    <article className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)] sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">마지막 저장 점검</p>
      {latest ? <><div className="mt-3"><ReviewStatus review={latest} /></div><h2 className="mt-4 break-words text-xl font-semibold leading-8 sm:text-2xl">{latest.title}</h2><p className="mt-2 text-xs text-[var(--muted-ink)]">기록 {formatMoment(latest.occurred_at)}</p><p className="mt-2 text-sm leading-6 text-amber-200">저장 당시의 결론입니다. 현재 상황은 새 점검으로 확인하세요.</p>{latest.conclusion && <p className="mt-4 break-words text-sm leading-6">{latest.conclusion}</p>}<button className="mt-5 min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold" onClick={() => setSelected(latest)} type="button">점검 상세 보기</button></> : !loading && <><h2 className="mt-3 text-xl font-semibold">아직 저장된 점검이 없습니다.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted-ink)]">ChatGPT가 조사한 결과를 점검 활동으로 저장하면 여기에서 확인할 수 있습니다.</p></>}
    </article>
    {error && <p className="rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</p>}
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">점검 이력</h2><button className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold disabled:opacity-60" disabled={loading} onClick={() => load()} type="button">{loading ? '불러오는 중' : '새로고침'}</button></div>
    {reviews.length > 0 && <ol className="grid gap-3">{reviews.map((review) => <li key={review.id}><button className="min-h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 text-left transition hover:bg-[var(--surface-2)] sm:p-5" onClick={() => setSelected(review)} type="button"><ReviewStatus review={review} /><strong className="mt-3 block text-sm leading-6 sm:text-base">{review.title}</strong><time className="mt-2 block text-xs text-[var(--muted-ink)]">{formatMoment(review.occurred_at)}</time></button></li>)}{nextCursor && <li><button className="min-h-11 w-full rounded-xl border border-[var(--line)] px-4 text-sm font-semibold disabled:opacity-60" disabled={loading} onClick={() => load(nextCursor)} type="button">{loading ? '불러오는 중' : '이전 점검 더 보기'}</button></li>}</ol>}
    {selected && <ReviewDetail onClose={closeDetail} review={selected} />}
  </section>
}
