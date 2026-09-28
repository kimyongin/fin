import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ListItemAction, { ListItemActions } from './ListItemAction'

describe('ListItemAction', () => {
  it('keeps a 44px target and an accessible name without a visible border', () => {
    const html = renderToStaticMarkup(<ListItemAction className="-my-2.5" kind="edit" label="삼성전자 자산 편집" onClick={() => {}} />)
    expect(html).toContain('aria-label="삼성전자 자산 편집"')
    expect(html).toContain('h-11 w-11')
    expect(html).toContain('-my-2.5')
    expect(html).toContain('bg-transparent')
    expect(html).not.toContain('hover:bg-')
    expect(html).not.toMatch(/\bborder(?:-|\s)/)
  })

  it('keeps adjacent read and edit targets while moving the icons closer', () => {
    const html = renderToStaticMarkup(<ListItemActions editLabel="기록 편집" onEdit={() => {}} onRead={() => {}} readLabel="기록 읽기" />)
    expect(html).toContain('aria-label="기록 읽기"')
    expect(html).toContain('aria-label="기록 편집"')
    expect(html).toContain('[&amp;&gt;svg]:translate-x-1.5')
    expect(html).toContain('[&amp;&gt;svg]:-translate-x-1.5')
  })
})
