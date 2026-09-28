import { describe, expect, it } from 'vitest'
import { activityReadableTitle } from './activityPresentation'

describe('activityReadableTitle', () => {
  it('prefers the saved, user-edited title', () => {
    expect(activityReadableTitle({ title: '내가 고친 제목', action_type: 'update_entity_note' })).toBe('내가 고친 제목')
  })

  it('never exposes a command code for an unfilled automatic record', () => {
    expect(activityReadableTitle({ title: null, action_type: 'update_entity_note' })).toBe('메모 수정')
    expect(activityReadableTitle({ title: null, action_type: 'unexpected_internal_code' })).toBe('활동 기록')
  })
})
