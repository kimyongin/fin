import MarkdownContent from '../../components/MarkdownContent'

export default function ActivityNarrative({ sections = [], sources = [], sourcesTitle = '출처' }) {
  const visibleSources = Array.isArray(sources)
    ? sources.filter((source) => /^https?:\/\//i.test(source?.url ?? ''))
    : []

  return <>
    {sections.filter(({ content }) => content).map(({ label, content, markdown = false }) => <section key={label}>
      <h4 className="text-sm font-semibold">{label}</h4>
      {markdown
        ? <MarkdownContent className="mt-2 text-sm leading-6" content={content} />
        : <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{content}</p>}
    </section>)}
    {visibleSources.length > 0 && <section>
      <h4 className="text-sm font-semibold">{sourcesTitle}</h4>
      <ul className="mt-2 grid gap-2">{visibleSources.map((source, index) => <li key={`${source.url}-${index}`}>
        <a className="break-words text-sm text-[var(--accent)] underline" href={source.url} rel="noreferrer" target="_blank">{source.title || source.url}</a>
      </li>)}</ul>
    </section>}
  </>
}
