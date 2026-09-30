import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function webUrl(value) {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null
  } catch { return null }
}

const components = {
  h1: ({ children }) => <h1 className="type-section-title break-words">{children}</h1>,
  h2: ({ children }) => <h2 className="type-item-title break-words">{children}</h2>,
  h3: ({ children }) => <h3 className="type-item-title break-words">{children}</h3>,
  p: ({ children }) => <p className="break-words">{children}</p>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-[var(--line)] pl-3 text-[var(--muted-ink)]">{children}</blockquote>,
  pre: ({ children }) => <pre className="max-w-full overflow-x-auto rounded-xl bg-[var(--surface-2)] p-3 font-mono text-sm">{children}</pre>,
  code: ({ children, className }) => <code className={className ?? 'rounded bg-[var(--surface-2)] px-1'}>{children}</code>,
  table: ({ children }) => <div className="max-w-full overflow-x-auto"><table className="w-max min-w-full border-collapse text-left">{children}</table></div>,
  th: ({ children }) => <th className="border border-[var(--line)] px-2 py-1 type-label">{children}</th>,
  td: ({ children }) => <td className="border border-[var(--line)] px-2 py-1">{children}</td>,
  a: ({ href, children }) => webUrl(href) ? <a className="break-all text-[var(--accent)] underline" href={webUrl(href)} rel="noopener noreferrer" target="_blank">{children}</a> : <span>{children}</span>,
  img: ({ alt, src }) => webUrl(src) ? <a className="break-all text-[var(--accent)] underline" href={webUrl(src)} rel="noopener noreferrer" target="_blank">{alt || '이미지 링크'}</a> : <span>{alt || '이미지'}</span>,
}

export default function MarkdownContent({ className = '', content }) {
  return <div className={`type-body type-long-body grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 [overflow-wrap:anywhere] ${className}`}>
    <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>{String(content ?? '')}</ReactMarkdown>
  </div>
}
