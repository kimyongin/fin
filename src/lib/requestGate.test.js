import { describe, expect, it } from 'vitest'
import { createRequestGate } from './requestGate'

describe('request gate', () => {
  it('accepts only the newest request generation', () => {
    const gate = createRequestGate()
    const friendA = gate.begin()
    const friendB = gate.begin()
    const owner = gate.begin()

    expect(friendA.isCurrent()).toBe(false)
    expect(friendB.isCurrent()).toBe(false)
    expect(owner.isCurrent()).toBe(true)
  })

  it('invalidates an in-flight request on logout or close', () => {
    const gate = createRequestGate()
    const request = gate.begin()
    gate.invalidate()
    expect(request.isCurrent()).toBe(false)
  })
})
