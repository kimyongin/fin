import { describe, expect, it } from 'vitest'

import { dailyReviewToolNames, portfolioToolDefinitions } from './portfolio-tools.ts'

function tool(name: string) {
  const definition = portfolioToolDefinitions.find((item) => item.name === name)
  if (!definition) throw new Error(`Missing tool definition: ${name}`)
  return definition
}

describe('portfolio MCP tool definitions', () => {
  it('uses one unique definition for every advertised tool', () => {
    const names = portfolioToolDefinitions.map((definition) => definition.name)
    expect(new Set(names).size).toBe(names.length)
    expect(dailyReviewToolNames.every((name) => names.includes(name))).toBe(true)
  })

  it('does not label temporary context creation as read-only or idempotent', () => {
    expect(tool('get_daily_context').annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    })
  })

  it('labels briefing save as an idempotent non-destructive write', () => {
    expect(tool('save_daily_briefing').annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
  })

  it('keeps list and detail tools read-only', () => {
    expect(tool('list_daily_briefings').annotations.readOnlyHint).toBe(true)
    expect(tool('get_daily_briefing').annotations.readOnlyHint).toBe(true)
  })

  it('publishes the agreed daily-review coverage states', () => {
    const saveSchema = tool('save_daily_briefing').inputSchema as any
    expect(saveSchema.required).toEqual([
      'schema_version',
      'context_id',
      'idempotency_key',
      'evidence',
      'scopes',
      'briefing',
    ])
    expect(saveSchema.properties.scopes.items.properties.coverage.enum).toEqual([
      'sufficient',
      'partial',
      'unverified',
    ])
  })
})
