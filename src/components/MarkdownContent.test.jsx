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
  it('renders nested lists, tables and code without loading external images', () => {
    const html = renderToStaticMarkup(<MarkdownContent content={'- 부모\n  - 자식\n\n| 이름 | 값 |\n| --- | --- |\n| 금액 | 10 |\n\n```js\nconst x = 1\n```\n\n![외부](https://example.com/image.png)'} />)
    expect(html).toContain('<table')
    expect(html).toContain('<pre')
    expect(html).toContain('자식')
    expect(html).not.toContain('<img')
    expect(html).toContain('외부')
  })
})
