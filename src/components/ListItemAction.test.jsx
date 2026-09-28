import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ListItemAction from './ListItemAction'

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
})
