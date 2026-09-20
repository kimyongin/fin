import { useEffect, useState } from 'react'

export default function PortfolioIntegritySummary({ supabase }) {
  const [summary, setSummary] = useState(null)
  useEffect(() => {
    let active = true
    supabase.rpc('app_get_portfolio_integrity').then(({ data }) => { if (active) setSummary(data) })
    return () => { active = false }
  }, [supabase])
  if (!summary || !summary.total_count) return null
  return <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)] sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">실제 잔고 확인</p><h2 className="mt-2 text-lg font-semibold">{summary.changed_count ? `${summary.changed_count}개 보유가 확인 뒤 변경됨` : summary.never_verified_count ? `${summary.never_verified_count}개 보유가 아직 미확인` : '현재 확인 이후 변경 없음'}</h2></div><span className="rounded-full border border-[var(--line)] px-3 py-1 text-xs">확인됨 {summary.verified_count}/{summary.total_count}</span></div>
    <p className="mt-3 text-sm leading-6 text-[var(--muted-ink)]">오래되거나 미확인이라는 사실만으로 잔고가 틀렸다는 뜻은 아닙니다. 증권사와 비교했을 때만 ‘맞추기’에서 확인 범위를 기록하세요.</p>
  </article>
}
