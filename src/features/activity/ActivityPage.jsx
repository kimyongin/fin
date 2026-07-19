import ActivityEventViewer from './ActivityEventViewer'

export default function ActivityPage({ actions = [], error = '', loading = false, onRefresh }) {
  return (
    <section className="mt-8 grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-[var(--muted-ink)]">최근 기록 {actions.length}건</span>
        <button className="h-10 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-60" disabled={loading} onClick={onRefresh} type="button">
          {loading ? '불러오는 중' : '새로고침'}
        </button>
      </div>
      {error && <div className="rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>}
      <ActivityEventViewer actions={actions} loading={loading} />
    </section>
  )
}
