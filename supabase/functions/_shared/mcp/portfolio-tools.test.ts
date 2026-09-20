import { describe, expect, it } from 'vitest'

import {
  dailyReviewToolNames,
  decisionTaskToolNames,
  holdingThesisToolNames,
  holdingIntegrityToolNames,
  investmentPolicyToolNames,
  portfolioToolDefinitions,
  tradeEntryToolNames,
  tradeReversalToolNames,
} from './portfolio-tools.ts'

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
    expect(decisionTaskToolNames.every((name) => names.includes(name))).toBe(true)
    expect(investmentPolicyToolNames.every((name) => names.includes(name))).toBe(true)
    expect(holdingThesisToolNames.every((name) => names.includes(name))).toBe(true)
    expect(tradeEntryToolNames.every((name) => names.includes(name))).toBe(true)
    expect(holdingIntegrityToolNames.every((name) => names.includes(name))).toBe(true)
    expect(tradeReversalToolNames.every((name) => names.includes(name))).toBe(true)
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

  it('keeps an adopted decision separate from trades and execution plans', () => {
    const definition = tool('record_investment_decision')
    const schema = definition.inputSchema as any
    expect(definition.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true })
    expect(schema.properties.status.enum).toEqual(['proposed', 'adopted'])
    expect(schema.properties.follow_up_tasks.maxItems).toBe(3)
    expect(schema.properties).not.toHaveProperty('trade')
    expect(schema.properties).not.toHaveProperty('execution_plan')
  })

  it('keeps decision and task reads read-only', () => {
    for (const name of ['list_investment_decisions', 'get_investment_decision', 'list_tasks', 'get_task']) {
      expect(tool(name).annotations.readOnlyHint).toBe(true)
    }
  })

  it('publishes guarded decision and task transitions', () => {
    const decision = tool('transition_investment_decision')
    const task = tool('transition_task')
    expect(decision.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true })
    expect(task.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true })
    expect((decision.inputSchema as any).properties.action.enum).toEqual(['adopt', 'dismiss'])
    expect((task.inputSchema as any).properties.action.enum).toEqual([
      'wait', 'resolve', 'reopen', 'pause', 'resume', 'close',
    ])
    expect((task.inputSchema as any).properties).not.toHaveProperty('trade_id')
  })

  it('keeps personal policy separate from inferred defaults and strategy mutation', () => {
    const read = tool('get_investment_policy')
    const save = tool('save_investment_policy')
    expect(read.annotations.readOnlyHint).toBe(true)
    expect(save.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true })
    expect((save.inputSchema as any).properties.expected_version.type).toEqual(['integer', 'null'])
    expect((save.inputSchema as any).properties.patch.properties).not.toHaveProperty('mode')
    expect((save.inputSchema as any).properties.patch.properties).not.toHaveProperty('target_percentage')
  })

  it('keeps holding theses explicit, scoped, and separate from holdings', () => {
    const read = tool('get_holding_thesis')
    const save = tool('save_holding_thesis')
    expect(read.annotations.readOnlyHint).toBe(true)
    expect(save.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true })
    expect((save.inputSchema as any).properties.account_id.type).toEqual(['integer', 'null'])
    expect((save.inputSchema as any).properties.expected_version.type).toEqual(['integer', 'null'])
    expect((save.inputSchema as any).properties.patch.properties).not.toHaveProperty('quantity')
    expect((save.inputSchema as any).properties.patch.properties).not.toHaveProperty('note')
  })

  it('separates trade preview, confirmation, and brokerage actions', () => {
    expect(tool('preview_trade_entry').annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false })
    expect(tool('log_completed_trade').annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true })
    expect(tool('list_transactions').annotations.readOnlyHint).toBe(true)
    expect((tool('preview_trade_entry').inputSchema as any).properties.quantity.type).toBe('string')
    expect((tool('log_completed_trade').inputSchema as any).properties).not.toHaveProperty('order_id')
  })

  it('separates absolute correction from field-scoped verification', () => {
    expect(tool('preview_holding_reconciliation').annotations.idempotentHint).toBe(false)
    expect(tool('reconcile_holding').annotations.idempotentHint).toBe(true)
    expect(tool('verify_holdings').annotations.idempotentHint).toBe(true)
    expect((tool('verify_holdings').inputSchema as any).properties.fields.minItems).toBe(1)
  })
  it('models cancellation as previewed reversal rather than an opposite trade',()=>{
    expect(tool('preview_trade_reversal').annotations.idempotentHint).toBe(false)
    expect(tool('reverse_trade_entry').annotations.idempotentHint).toBe(true)
    expect((tool('reverse_trade_entry').inputSchema as any).properties).not.toHaveProperty('side')
  })
})
