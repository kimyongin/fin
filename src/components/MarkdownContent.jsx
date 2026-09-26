function InlineMarkdown({ text }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong className="font-semibold" key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code className="rounded bg-[var(--surface-2)] px-1 py-0.5" key={index}>{part.slice(1, -1)}</code>
    const link = part.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/)
    if (link) {
      try {
        const url = new URL(link[2])
        if (['http:', 'https:'].includes(url.protocol)) return <a className="text-[var(--accent)] underline" href={url.href} key={index} rel="noreferrer" target="_blank">{link[1]}</a>
      } catch { /* Unsafe or relative URLs remain plain text. */ }
    }
    return part
  })
}

export default function MarkdownContent({ className = '', content }) {
  const lines = String(content ?? '').split('\n')
  const blocks = []
  let list = []
  let listType = null

  function flushList() {
    if (!list.length) return
    const Tag = listType === 'ordered' ? 'ol' : 'ul'
    blocks.push(<Tag className={`${listType === 'ordered' ? 'list-decimal' : 'list-disc'} space-y-1 pl-5`} key={`list-${blocks.length}`}>{list.map((item, index) => <li key={index}><InlineMarkdown text={item} /></li>)}</Tag>)
    list = []
    listType = null
  }

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    const bullet = line.match(/^[-*]\s+(.+)$/)
    const ordered = line.match(/^\d+\.\s+(.+)$/)
    if (bullet || ordered) {
      const nextType = ordered ? 'ordered' : 'unordered'
      if (list.length && listType !== nextType) flushList()
      listType = nextType
      list.push((ordered ?? bullet)[1])
      continue
    }
    flushList()
    if (heading) {
      const Tag = `h${heading[1].length}`
      blocks.push(<Tag className={heading[1].length === 1 ? 'type-section-title' : 'type-item-title'} key={`heading-${blocks.length}`}><InlineMarkdown text={heading[2]} /></Tag>)
    } else if (line.trim()) blocks.push(<p className="whitespace-pre-wrap" key={`paragraph-${blocks.length}`}><InlineMarkdown text={line} /></p>)
  }
  flushList()

  return <div className={`type-body type-long-body grid gap-2 ${className}`}>{blocks}</div>
}
