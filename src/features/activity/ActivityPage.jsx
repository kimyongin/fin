import ActivityEventViewer from './ActivityEventViewer'

export default function ActivityPage({ actions = [], error = '', loading = false, onRefresh }) {
  return (
    <section className="mt-8 grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">작업 기록</h2>
          <p className="mt-1 text-sm text-[var(--muted-ink)]">앱과 에이전트가 수행한 계좌, 종목, 보유 항목 변경입니다.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--muted-ink)]">최근 {actions.length}건</span>
          <button className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-medium text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-60" disabled={loading} onClick={onRefresh} type="button">
            {loading ? '불러오는 중' : '새로고침'}
          </button>
        </div>
      </div>
      {error && <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>}
      <ActivityEventViewer actions={actions} loading={loading} />
    </section>
  )
}
