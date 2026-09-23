import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MarkdownContent from './MarkdownContent'

describe('MarkdownContent', () => {
  it('renders simple Markdown without executing HTML or unsafe links', () => {
    const html = renderToStaticMarkup(<MarkdownContent content={'# 기준\n1. 첫째\n2. 둘째\n- 셋째\n**중요** [안전](https://example.com) [위험](javascript:alert) <script>alert(1)</script>'} />)
    expect(html).toContain('<ol')
    expect(html).toContain('<ul')
    expect(html).toContain('href="https://example.com/"')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('&lt;script&gt;')
  })
})
