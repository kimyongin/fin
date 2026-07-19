function InlineMarkdown({ text }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code className="rounded bg-[var(--surface-2)] px-1 py-0.5 text-[0.9em]" key={index}>{part.slice(1, -1)}</code>
    const link = part.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/)
    if (link) return <a className="text-[var(--accent)] underline" href={link[2]} key={index} rel="noreferrer" target="_blank">{link[1]}</a>
    return part
  })
}

export default function MarkdownContent({ className = '', content }) {
  const lines = String(content ?? '').split('\n')
  const blocks = []
  let list = []

  function flushList() {
    if (!list.length) return
    blocks.push(<ul className="list-disc space-y-1 pl-5" key={`list-${blocks.length}`}>{list.map((item, index) => <li key={index}><InlineMarkdown text={item} /></li>)}</ul>)
    list = []
  }

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    const bullet = line.match(/^[-*]\s+(.+)$/)
    if (bullet) { list.push(bullet[1]); continue }
    flushList()
    if (heading) {
      const Tag = `h${heading[1].length}`
      blocks.push(<Tag className={heading[1].length === 1 ? 'text-lg font-semibold' : 'text-base font-semibold'} key={`heading-${blocks.length}`}><InlineMarkdown text={heading[2]} /></Tag>)
    } else if (line.trim()) blocks.push(<p key={`paragraph-${blocks.length}`}><InlineMarkdown text={line} /></p>)
  }
  flushList()

  return <div className={`grid gap-2 ${className}`}>{blocks}</div>
}
