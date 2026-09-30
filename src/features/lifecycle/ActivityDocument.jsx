import TagChip from '../../components/TagChip'
import MarkdownContent from '../../components/MarkdownContent'

export default function ActivityDocument({ title, summary, body, bodyLabel, status, metadata = [], tags = [], children }) {
  return <article className="min-w-0 space-y-6">
    <header className="min-w-0 space-y-4">
      <div className="space-y-2">
        <p className="type-meta text-[var(--muted-ink)]">{status}</p>
        <h3 className="type-document-title whitespace-pre-wrap [overflow-wrap:anywhere]">{title}</h3>
      </div>
      {summary && <section aria-label="요약"><p className="type-body type-long-body whitespace-pre-wrap [overflow-wrap:anywhere]">{summary}</p></section>}
      <div className="space-y-3">
        <dl className="type-secondary flex min-w-0 flex-wrap gap-x-5 gap-y-2 text-[var(--muted-ink)]">
          {metadata.map(({ label, value }) => <div className="flex min-w-0 gap-2" key={label}>
            <dt className="shrink-0">{label}</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
          </div>)}
        </dl>
        {tags?.length > 0 && <ul aria-label="태그" className="flex flex-wrap gap-2">{tags.map((tag) => <li className="min-w-0 max-w-full" key={tag.id}><TagChip>{tag.name}</TagChip></li>)}</ul>}
      </div>
    </header>
    {body && <section className="border-t border-[var(--line)] pt-6">
      <h4 className="type-label text-[var(--muted-ink)]">{bodyLabel}</h4>
      <MarkdownContent className="mt-3" content={body} />
    </section>}
    {children}
  </article>
}
