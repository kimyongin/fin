import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ListItemAction, { ListItemActions } from './ListItemAction'

describe('ListItemAction', () => {
  it('shows a subdued text action with an accessible target name', () => {
    const html = renderToStaticMarkup(<ListItemAction kind="edit" label="삼성전자 자산 편집" onClick={() => {}} />)
    expect(html).toContain('aria-label="삼성전자 자산 편집"')
    expect(html).toContain('class="list-item-text-action "')
    expect(html).toContain('>편집</button>')
    expect(html).not.toContain('<svg')
  })

  it('keeps read and edit in one group with a decorative separator', () => {
    const html = renderToStaticMarkup(<ListItemActions editLabel="기록 편집" onEdit={() => {}} onRead={() => {}} readLabel="기록 보기" />)
    expect(html).toContain('aria-label="기록 보기"')
    expect(html).toContain('aria-label="기록 편집"')
    expect(html).toContain('>보기</button>')
    expect(html).toContain('aria-hidden="true" class="list-item-actions__separator">·</span>')
    expect(html).toContain('>편집</button>')
    expect(html).not.toContain('<svg')
    const readOnly = renderToStaticMarkup(<ListItemActions onRead={() => {}} readLabel="기록 보기" />)
    expect(readOnly).not.toContain('list-item-actions__separator')
  })
})
