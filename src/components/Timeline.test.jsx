import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TimelineEntry } from './Timeline'

describe('TimelineEntry', () => {
  it('keeps content static and exposes separate accessible reading and editing actions', () => {
    const html = renderToStaticMarkup(<TimelineEntry
      ariaLabel="기록 읽기: 심리 점검"
      editLabel="기록 편집: 심리 점검"
      occurredAt="2026-09-28T00:00:00Z"
      onEdit={() => {}}
      onOpen={() => {}}
      summary="**관찰** 결과"
      title="심리 점검"
    />)
    expect(html).toContain('aria-label="기록 읽기: 심리 점검"')
    expect(html).toContain('aria-label="기록 편집: 심리 점검"')
    expect(html).toContain('관찰 결과')
    expect(html).toMatch(/<div class="min-w-0 break-words"><time[^>]*>09:00<\/time>/)
    expect(html).toMatch(/심리 점검<\/span><span class="inline-flex shrink-0 items-center -my-2.5">/)
    expect(html).not.toContain('sm:grid-cols-[5rem_minmax(0,1fr)]')
    expect(html).not.toMatch(/<button[^>]*>[^<]*심리 점검/)
    expect(html).not.toContain('<button><button')
  })
})
