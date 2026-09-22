import { describe, expect, it } from 'vitest'

import {
  actionTaskToolNames,
  activityReportToolNames,
  dailyReviewToolNames,
  decisionTaskToolNames,
  entityNoteToolNames,
  holdingThesisToolNames,
  holdingIntegrityToolNames,
  investmentPolicyToolNames,
  operatingRuleToolNames,
  portfolioToolDefinitions,
  productFeedbackToolNames,
  tradeEntryToolNames,
  tradeReversalToolNames,
  workflowGuideToolNames,
} from './portfolio-tools.ts'
import { getWorkflowGuide, renderWorkflowGuideMarkdown, validateWorkflowGuides, workflowGuideTopics } from './workflow-guides.ts'

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
    expect(actionTaskToolNames.every((name) => names.includes(name))).toBe(true)
    expect(activityReportToolNames.every((name) => names.includes(name))).toBe(true)
    expect(entityNoteToolNames.every((name) => names.includes(name))).toBe(true)
    expect(investmentPolicyToolNames.every((name) => names.includes(name))).toBe(true)
    expect(operatingRuleToolNames.every((name) => names.includes(name))).toBe(true)
    expect(holdingThesisToolNames.every((name) => names.includes(name))).toBe(true)
    expect(tradeEntryToolNames.every((name) => names.includes(name))).toBe(true)
    expect(holdingIntegrityToolNames.every((name) => names.includes(name))).toBe(true)
    expect(tradeReversalToolNames.every((name) => names.includes(name))).toBe(true)
    expect(productFeedbackToolNames.every((name) => names.includes(name))).toBe(true)
    expect(workflowGuideToolNames.every((name) => names.includes(name))).toBe(true)
  })

  it('separates planned general tasks from reported completed activity', () => {
    expect(tool('list_general_tasks').annotations.readOnlyHint).toBe(true)
    expect(tool('save_general_task').description).toContain('intent only')
    expect(tool('transition_general_task').description).toContain('linked action event')
    expect(tool('record_manual_activity').description).toContain('already happened')
    expect(tool('record_manual_activity').description).toContain('does not create a task')
    expect((tool('record_manual_activity').inputSchema as any).properties.category.enum).toEqual(['general','research','review','decision','retrospective'])
    expect((tool('record_manual_activity').inputSchema as any).properties.context.type).toContain('object')
    expect((tool('save_general_task').inputSchema as any).properties.recurrence_kind.enum).toEqual(['none', 'daily'])
  })

  it('publishes a self-contained read-only policy workflow guide', () => {
    const definition = tool('get_workflow_guide')
    expect(definition.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true })
    expect((definition.inputSchema as any).properties.topic.enum).toEqual(workflowGuideTopics)
    const guide = getWorkflowGuide('policy')!
    expect(guide.revision).toMatch(/^fnv1a32:[0-9a-f]{8}$/)
    expect(guide.steps[0].tools).toEqual(['list_principles'])
    expect(guide.steps.at(-1)?.tools).toEqual(['list_principles'])
    expect(guide.boundaries.join(' ')).toContain('never changes allocation targets')
    expect(guide).not.toHaveProperty('source_paths')
    expect(validateWorkflowGuides(portfolioToolDefinitions.map((item) => item.name))).toBeTruthy()
  })

  it('rejects guides that reference tools outside the advertised registry', () => {
    expect(() => validateWorkflowGuides(['get_workflow_guide'])).toThrow('references unknown tools')
  })

  it('publishes every reviewed multi-step topic from one validated guide registry', () => {
    expect(workflowGuideTopics).toEqual([
      'policy', 'holding_thesis', 'daily_review', 'decision_followup', 'trade_entry', 'reconciliation', 'todo', 'activity_report', 'product_feedback',
    ])
    for (const topic of workflowGuideTopics) {
      const guide = getWorkflowGuide(topic)!
      expect(guide.steps.length).toBeGreaterThanOrEqual(5)
      expect(guide.boundaries.length).toBeGreaterThanOrEqual(3)
      expect(guide.recovery.length).toBeGreaterThanOrEqual(2)
      expect(renderWorkflowGuideMarkdown(topic)).toContain(`Revision: ${guide.revision}`)
    }
    expect(renderWorkflowGuideMarkdown('daily_review')).toContain('get_daily_context')
  })

  it('keeps product feedback consent-based and operationally scoped', () => {
    const submit = tool('submit_product_feedback')
    const list = tool('list_my_product_feedback')
    expect(submit.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true })
    expect(list.annotations.readOnlyHint).toBe(true)
    expect((submit.inputSchema as any).properties.context.additionalProperties).toBe(false)
    expect(submit.description).toContain('first summarize one proposed feedback item and ask once')
    expect(getWorkflowGuide('product_feedback')?.boundaries.join(' ')).toContain('cannot guarantee')
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
    expect(tool('get_portfolio_integrity').annotations.readOnlyHint).toBe(true)
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

  it('publishes displayable briefing items and actionable daily-review outputs', () => {
    const save = tool('save_daily_briefing')
    const item = (save.inputSchema as any).properties.briefing.properties.changes.items
    expect(item.oneOf[0]).toMatchObject({ type: 'string', minLength: 1 })
    expect(item.oneOf[1].anyOf).toEqual([
      { required: ['summary'] }, { required: ['title'] }, { required: ['body'] },
    ])

    const contextData = (tool('get_daily_context').outputSchema as any).properties.data
    expect(contextData.required).toEqual(['context_id', 'expires_at', 'snapshot'])
    const briefingData = (save.outputSchema as any).properties.data
    expect(briefingData.required).toContain('id')
    expect(briefingData.required).toContain('coverage_status')
    expect((tool('list_daily_briefings').outputSchema as any).oneOf[0].properties.data.type).toBe('array')
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

  it('offers opt-in stable cursor pages without removing legacy before inputs', () => {
    for (const name of ['list_daily_briefings', 'list_investment_decisions', 'list_tasks', 'list_transactions']) {
      const schema = tool(name).inputSchema as any
      expect(schema.properties).toHaveProperty('before')
      expect(schema.properties.cursor.type).toEqual(['object', 'null'])
      expect((tool(name).outputSchema as any).oneOf).toHaveLength(2)
    }
    expect((tool('list_tasks').inputSchema as any).properties.filter.enum).toEqual(['active', 'paused', 'closed', 'all'])
    expect((tool('list_transactions').inputSchema as any).properties).toHaveProperty('account_id')
    expect((tool('list_transactions').inputSchema as any).properties).toHaveProperty('instrument_id')
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

  it('keeps execution plans separate from completed fills', () => {
    const save = tool('save_execution_task')
    const link = tool('link_trade_to_task')
    const transition = tool('transition_execution_task')
    expect(save.annotations.idempotentHint).toBe(true)
    expect((save.inputSchema as any).properties).not.toHaveProperty('unit_price')
    expect((link.inputSchema as any).required).toContain('trade_id')
    expect(link.description).toContain('never creates')
    expect((transition.inputSchema as any).properties.action.enum).toEqual(['pause', 'resume', 'cancel'])
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

  it('models operating rules as owner-only workflow guidance rather than investment policy', () => {
    const list = tool('list_operating_rules')
    const save = tool('save_operating_rule')
    const archive = tool('archive_operating_rule')
    expect(list.annotations.readOnlyHint).toBe(true)
    expect(list.description).toContain('tool error')
    expect(save.annotations.idempotentHint).toBe(true)
    expect((save.inputSchema as any).required).toContain('applicability')
    expect((save.inputSchema as any).properties).not.toHaveProperty('risk_tolerance_text')
    expect(archive.annotations.idempotentHint).toBe(true)
    expect(getWorkflowGuide('reconciliation')?.steps[0].tools).toEqual(['list_operating_rules'])
  })

  it('advertises unified action tasks instead of legacy ToDo bundles', () => {
    const names = portfolioToolDefinitions.map((definition) => definition.name)
    expect(names).not.toContain('save_todo_bundle')
    expect(names).not.toContain('list_todo_bundles')
    const guide = getWorkflowGuide('todo')!
    expect(guide.related_tools).toContain('save_general_task')
    expect(guide.related_tools).toContain('record_manual_activity')
    expect(guide.boundaries.join(' ')).toContain('Legacy ToDo bundle tools are no longer advertised')
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

  it('advertises the direct private holding-note path without financial writes', () => {
    const read = tool('list_private_holding_notes')
    const save = tool('save_private_holding_note')
    expect(read.annotations.readOnlyHint).toBe(true)
    expect(save.annotations.idempotentHint).toBe(true)
    expect((save.inputSchema as any).properties).not.toHaveProperty('quantity')
    expect((save.inputSchema as any).properties.expected_note.type).toEqual(['string', 'null'])
    expect(getWorkflowGuide('holding_thesis')?.related_tools).toContain('save_private_holding_note')
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

  it('updates only an existing entity note with conflict and retry inputs', () => {
    const definition = tool('update_entity_note')
    expect(definition.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true })
    expect((definition.inputSchema as any).required).toEqual(expect.arrayContaining(['entity_type', 'entity_id', 'expected_note', 'note', 'idempotency_key']))
    expect((definition.inputSchema as any).properties.entity_type.enum).toEqual(['account', 'instrument', 'holding'])
    expect(definition.description).toContain('does not change quantities')
  })

  it('advertises exact reconciliation value shapes and decimal strings', () => {
    const preview = tool('preview_holding_reconciliation')
    const variants = (preview.inputSchema as any).properties.values.oneOf
    expect(variants.map((variant: any) => variant.required)).toEqual([
      ['quantity', 'avg_price'],
      ['purchase_amount', 'valuation_amount'],
      ['valuation_amount'],
    ])
    expect(variants.every((variant: any) => variant.additionalProperties === false)).toBe(true)
    expect(variants[0].properties.quantity.type).toBe('string')
    expect((preview.outputSchema as any).properties.data.required).toContain('preview_id')
    expect((tool('reconcile_holding').outputSchema as any).properties.data.required).toContain('holding_state_version')
  })
  it('models cancellation as previewed reversal rather than an opposite trade',()=>{
    expect(tool('preview_trade_reversal').annotations.idempotentHint).toBe(false)
    expect(tool('reverse_trade_entry').annotations.idempotentHint).toBe(true)
    expect((tool('reverse_trade_entry').inputSchema as any).properties).not.toHaveProperty('side')
  })
})
