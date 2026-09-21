import { describe, expect, it, vi } from 'vitest'

import type { PortfolioToolDefinition } from './portfolio-tools.ts'
import { validateToolRegistry } from './registry.ts'

const definition = (name: string) => ({ name } as PortfolioToolDefinition)
const handler = vi.fn(async () => ({}))

describe('portfolio MCP registry', () => {
  it('accepts exact definitions and reusable domain groups', () => {
    const handlers = { one: handler, two: handler }
    expect(validateToolRegistry([definition('one'), definition('two')], handlers, {
      first: ['one'], second: ['two'],
    })).toBe(handlers)
  })

  it('rejects missing handlers, duplicate membership, and unknown grouped tools', () => {
    expect(() => validateToolRegistry([definition('one')], {}, {})).toThrow('definitions and handlers')
    expect(() => validateToolRegistry([definition('one')], { one: handler }, { a: ['one'], b: ['one'] })).toThrow('duplicates')
    expect(() => validateToolRegistry([definition('one')], { one: handler }, { a: ['missing'] })).toThrow('unknown')
  })
})
