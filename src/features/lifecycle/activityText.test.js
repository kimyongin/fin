import { describe, expect, it } from 'vitest'
import { activityUpperTextError } from './activityText'

describe('activity upper text limits', () => {
  it('counts Unicode code points instead of bytes or UTF-16 units', () => {
    expect(activityUpperTextError('😀'.repeat(100), '한'.repeat(300))).toBe('')
    expect(activityUpperTextError('😀'.repeat(101), '요약')).toContain('101자')
    expect(activityUpperTextError('제목', '😀'.repeat(301))).toContain('301자')
  })

  it('preserves unchanged legacy fields but validates replacements', () => {
    const original = { title: '한'.repeat(150), summary: '요'.repeat(500) }
    expect(activityUpperTextError(original.title, original.summary, original)).toBe('')
    expect(activityUpperTextError(`${original.title}수정`, original.summary, original)).toContain('100자')
    expect(activityUpperTextError('짧은 제목', original.summary, original)).toBe('')
    expect(activityUpperTextError('제목', '   ')).toContain('작성')
  })
})
