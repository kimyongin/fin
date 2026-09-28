const seoulDate = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full', timeZone: 'Asia/Seoul' })
const seoulTime = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Seoul' })
import { ListItemActions } from './ListItemAction'
import { markdownPreview } from '../lib/markdownPreview'

export function TimelineDayCard({ day, collapsed, onToggle, children }) {
  const panelId = `timeline-day-${day}`
  return <article className="min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)] sm:p-6">
    <button aria-controls={panelId} aria-expanded={!collapsed} className="flex min-h-11 w-full items-center justify-between gap-3 text-left" onClick={onToggle} type="button">
      <span className="type-item-title type-number">{seoulDate.format(new Date(`${day}T00:00:00+09:00`))}</span>
      <span aria-hidden="true" className="type-secondary text-[var(--muted-ink)]">{collapsed ? '펼치기' : '접기'}</span>
    </button>
    <div className={collapsed ? 'hidden' : 'min-w-0 mt-3 border-t border-[var(--line)] pt-2'} id={panelId}>
      {children}
    </div>
  </article>
}

export function TimelineEntry({ occurredAt, title, meta, summary, onOpen, onEdit, ariaLabel, editLabel }) {
  return <li className="relative min-w-0 border-b border-[var(--line)] py-4 pl-4 last:border-b-0">
    <span aria-hidden="true" className="absolute -left-1 top-5 h-2 w-2 rounded-full bg-[var(--muted-ink)]" />
    <div className="min-w-0 break-words">
        <time className="type-meta type-number mb-1 block text-[var(--muted-ink)]" dateTime={occurredAt}>{seoulTime.format(new Date(occurredAt))}</time>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1"><span className="type-item-title min-w-0 line-clamp-3">{title}</span><ListItemActions className="-my-2.5" editLabel={editLabel} onEdit={onEdit} onRead={onOpen} readLabel={ariaLabel} /></div>
        {meta && <span className="type-meta mt-2 flex min-w-0 flex-wrap gap-1.5 text-[var(--muted-ink)]">{meta}</span>}
        {summary && <span className="type-secondary mt-2 block line-clamp-2 text-[var(--muted-ink)]">{markdownPreview(summary)}</span>}
    </div>
  </li>
}
