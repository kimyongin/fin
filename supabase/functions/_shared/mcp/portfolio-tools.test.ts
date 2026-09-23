import { describe, expect, it } from 'vitest'

import {
  actionTaskToolNames,
  activityReportToolNames,
  dailyReviewToolNames,
  decisionActivityToolNames,
  entityNoteToolNames,
  holdingNotesToolNames,
  holdingIntegrityToolNames,
  investmentPolicyToolNames,
  portfolioToolDefinitions,
  productFeedbackToolNames,
  tradeEntryToolNames,
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
    expect(decisionActivityToolNames.every((name) => names.includes(name))).toBe(true)
    expect(actionTaskToolNames.every((name) => names.includes(name))).toBe(true)
    expect(activityReportToolNames.every((name) => names.includes(name))).toBe(true)
    expect(entityNoteToolNames.every((name) => names.includes(name))).toBe(true)
    expect(investmentPolicyToolNames.every((name) => names.includes(name))).toBe(true)
    expect(holdingNotesToolNames.every((name) => names.includes(name))).toBe(true)
    expect(tradeEntryToolNames.every((name) => names.includes(name))).toBe(true)
    expect(holdingIntegrityToolNames.every((name) => names.includes(name))).toBe(true)
    expect(productFeedbackToolNames.every((name) => names.includes(name))).toBe(true)
    expect(workflowGuideToolNames.every((name) => names.includes(name))).toBe(true)
  })

  it('separates planned general tasks from reported completed activity', () => {
    expect(tool('list_general_tasks').annotations.readOnlyHint).toBe(true)
    expect(tool('save_general_task').description).toContain('intent only')
    expect(tool('transition_general_task').description).toContain('linked action event')
    expect(tool('record_manual_activity').description).toContain('already happened')
    expect(tool('record_manual_activity').description).toContain('not proof of task completion')
    expect((tool('transition_general_task').inputSchema as any).properties.action.enum).toEqual(['complete','reopen','cancel'])
    expect((tool('record_manual_activity').inputSchema as any).properties).not.toHaveProperty('category')
    expect((tool('record_manual_activity').inputSchema as any).properties).toHaveProperty('body')
    expect(tool('delete_activity').description).toContain('never reverses a completed trade')
    expect((tool('delete_activity').inputSchema as any).required).toEqual(['schema_version', 'activity_id', 'expected_version'])
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

  it('labels current context as a read-only operation', () => {
    expect(tool('get_daily_context').annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
  })

  it('uses the activity contract for saved reviews', () => {
    expect(dailyReviewToolNames).toEqual(['get_daily_context'])
    expect(tool('search_activities').annotations.readOnlyHint).toBe(true)
    expect(tool('record_manual_activity').annotations.idempotentHint).toBe(true)
    expect(tool('record_manual_activity').description).toContain('Markdown body')
    expect(tool('get_portfolio_integrity').annotations.readOnlyHint).toBe(true)
  })

  it('uses activities and independent tasks for decisions', () => {
    expect(tool('search_activities').annotations.readOnlyHint).toBe(true)
    expect(tool('record_manual_activity').annotations.idempotentHint).toBe(true)
    expect((tool('save_general_task').inputSchema as any).properties).not.toHaveProperty('origin_activity_id')
    expect(getWorkflowGuide('decision_followup')?.steps.map((step) => step.tools).flat()).toContain('record_manual_activity')
    expect(portfolioToolDefinitions.map((definition) => definition.name)).not.toContain('record_investment_decision')
  })

  it('keeps decision and general task reads read-only', () => {
    for (const name of ['search_activities', 'list_general_tasks', 'get_general_task']) {
      expect(tool(name).annotations.readOnlyHint).toBe(true)
    }
  })

  it('offers opt-in stable cursor pages without removing legacy before inputs', () => {
    const schema = tool('list_transactions').inputSchema as any
    expect(schema.properties).toHaveProperty('before')
    expect(schema.properties.cursor.type).toEqual(['object', 'null'])
    expect(schema.properties.cursor.properties.id.pattern).toBe('^[0-9]+$')
    expect((tool('list_transactions').outputSchema as any).oneOf).toHaveLength(2)
    expect((tool('list_transactions').inputSchema as any).properties).toHaveProperty('account_id')
    expect((tool('list_transactions').inputSchema as any).properties).toHaveProperty('instrument_id')
  })

  it('publishes one general-task transition while decision corrections use activity edits', () => {
    const task = tool('transition_general_task')
    expect(task.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true })
    expect(tool('update_activity').annotations.idempotentHint).toBe(true)
    expect((task.inputSchema as any).properties.action.enum).toEqual(['complete', 'reopen', 'cancel'])
    expect((task.inputSchema as any).properties).not.toHaveProperty('trade_id')
  })

  it('does not advertise parallel research or execution task tools', () => {
    const names = portfolioToolDefinitions.map((definition) => definition.name)
    for (const oldName of ['list_tasks', 'get_task', 'transition_task', 'save_execution_task', 'link_trade_to_task', 'transition_execution_task']) {
      expect(names).not.toContain(oldName)
    }
  })

  it('uses principles instead of a parallel personal-policy API', () => {
    const names = portfolioToolDefinitions.map((definition) => definition.name)
    expect(names).not.toContain('get_investment_policy')
    expect(names).not.toContain('save_investment_policy')
    expect(names).toContain('list_principles')
    expect(names).toContain('save_principle')
    expect(getWorkflowGuide('policy')?.steps[0].tools).toEqual(['list_principles'])
  })

  it('uses principles instead of a parallel operating-rule API', () => {
    const names = portfolioToolDefinitions.map((definition) => definition.name)
    expect(names).not.toContain('list_operating_rules')
    expect(names).not.toContain('save_operating_rule')
    expect(names).not.toContain('archive_operating_rule')
    expect(getWorkflowGuide('reconciliation')?.steps[0].tools).toEqual(['list_principles'])
  })

  it('advertises unified action tasks instead of legacy ToDo bundles', () => {
    const names = portfolioToolDefinitions.map((definition) => definition.name)
    expect(names).not.toContain('save_todo_bundle')
    expect(names).not.toContain('list_todo_bundles')
    const guide = getWorkflowGuide('todo')!
    expect(guide.related_tools).toContain('save_general_task')
    expect(guide.related_tools).toContain('record_manual_activity')
    expect(guide.boundaries.join(' ')).toContain('Legacy ToDo bundle tools and storage are retired')
  })

  it('removes the parallel holding thesis tools', () => {
    const names = portfolioToolDefinitions.map((definition) => definition.name)
    expect(names).not.toContain('get_holding_thesis')
    expect(names).not.toContain('save_holding_thesis')
    expect(names).not.toContain('link_task_to_holding_thesis')
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
    expect((preview.outputSchema as any).properties.data.required).toContain('holding_state_version')
    expect((tool('reconcile_holding').outputSchema as any).properties.data.required).toContain('holding_state_version')
  })
  it('does not offer local trade reversal as a new agent action',()=>{
    expect(portfolioToolDefinitions.some((definition) => ['preview_trade_reversal','reverse_trade_entry'].includes(definition.name))).toBe(false)
  })
})
