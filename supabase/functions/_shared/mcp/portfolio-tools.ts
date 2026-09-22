import { workflowGuideTopics } from './workflow-guides.ts'

export type PortfolioToolDefinition = {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
  _meta?: Record<string, unknown>
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

const contextAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
}

const idempotentWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

const profileOutputSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1, pattern: '\\S' },
    name: { type: 'string' },
    email: { type: 'string' },
    nickname: { type: 'string' },
  },
  required: ['id'],
  additionalProperties: false,
}

function successEnvelope(data: Record<string, unknown> = {}) {
  return {
  type: 'object',
  properties: {
    ok: { const: true },
      data,
  },
  required: ['ok', 'data'],
  additionalProperties: false,
  }
}

const successEnvelopeSchema = successEnvelope()
const entityNoteOutputSchema = successEnvelope({
  type: 'object',
  properties: {
    entity_type: { type: 'string', enum: ['account', 'instrument', 'holding'] },
    entity_id: { type: 'integer', minimum: 1 },
    note: { type: ['string', 'null'] },
  },
  required: ['entity_type', 'entity_id', 'note'],
  additionalProperties: false,
})
const workflowGuideOutputSchema = successEnvelope({
  type: 'object',
  properties: {
    topic: { type: 'string', enum: workflowGuideTopics },
    guide_id: { type: 'string' },
    revision: { type: 'string' },
    purpose: { type: 'string' },
    scenario_ids: { type: 'array', items: { type: 'string' } },
    related_tools: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          instruction: { type: 'string' },
          tools: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        required: ['id', 'title', 'instruction', 'tools'],
        additionalProperties: false,
      },
    },
    boundaries: { type: 'array', items: { type: 'string' } },
    recovery: { type: 'array', items: { type: 'string' } },
    unavailable_steps: { type: 'array', items: { type: 'string' } },
  },
  required: ['topic', 'guide_id', 'revision', 'purpose', 'scenario_ids', 'related_tools', 'steps', 'boundaries', 'recovery', 'unavailable_steps'],
  additionalProperties: false,
})
const idSchema = { type: 'string', format: 'uuid' }
const timestampSchema = { type: 'string', format: 'date-time' }
const feedbackItemSchema = {
  type: 'object',
  properties: {
    id: idSchema,
    body: { type: 'string' },
    source: { type: 'string', enum: ['app', 'mcp'] },
    context: { type: 'object' },
    status: { type: 'string', enum: ['received', 'reviewing', 'planned', 'resolved', 'deferred'] },
    response: { type: ['string', 'null'] },
    github_issue_url: { type: ['string', 'null'] },
    version: { type: 'integer', minimum: 1 },
    created_at: timestampSchema,
    updated_at: timestampSchema,
  },
  required: ['id', 'body', 'source', 'context', 'status', 'response', 'github_issue_url', 'version', 'created_at', 'updated_at'],
  additionalProperties: false,
}
const feedbackOutputSchema = successEnvelope(feedbackItemSchema)
const feedbackPageOutputSchema = successEnvelope({
  type: 'object',
  properties: {
    items: { type: 'array', items: feedbackItemSchema },
    next_cursor: { oneOf: [{ type: 'null' }, { type: 'object' }] },
    is_admin: { type: 'boolean' },
  },
  required: ['items', 'next_cursor', 'is_admin'],
  additionalProperties: false,
})
const nonNegativeDecimalStringSchema = {
  type: 'string',
  pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,16})?$',
  description: 'A non-negative decimal encoded as a string; JSON numbers are not accepted.',
}
const briefingItemSchema = {
  description: 'A concise displayable item. Prefer summary; title and body remain accepted for existing clients.',
  oneOf: [
    { type: 'string', minLength: 1, maxLength: 4000 },
    {
      type: 'object',
      properties: {
        summary: { type: 'string', minLength: 1, maxLength: 4000 },
        title: { type: 'string', minLength: 1, maxLength: 500 },
        body: { type: 'string', minLength: 1, maxLength: 4000 },
        subject: { type: 'string', maxLength: 500 },
        impact: { type: 'string', maxLength: 4000 },
      },
      anyOf: [{ required: ['summary'] }, { required: ['title'] }, { required: ['body'] }],
      additionalProperties: true,
    },
  ],
}

const evidenceSchema = {
  type: 'object',
  properties: {
    local_key: { type: 'string', minLength: 1, maxLength: 100 },
    source_url: { type: 'string', pattern: '^https?://' },
    source_title: { type: 'string', minLength: 1, maxLength: 500 },
    source_name: { type: 'string' },
    published_at: { type: ['string', 'null'], format: 'date-time' },
    checked_at: { type: 'string', format: 'date-time' },
    fact_summary: { type: 'string', minLength: 1, maxLength: 4000 },
    facts: { type: 'array', items: { type: 'string' } },
  },
  required: ['local_key', 'source_url', 'source_title', 'checked_at', 'fact_summary'],
  additionalProperties: false,
}

const checkedSourceSchema = {
  type: 'object',
  properties: {
    source_url: { type: 'string', pattern: '^https?://' },
    checked_at: { type: 'string', format: 'date-time' },
    outcome: { type: 'string', enum: ['checked', 'failed'] },
    note: { type: 'string' },
  },
  required: ['source_url', 'checked_at', 'outcome'],
  additionalProperties: false,
}

const scopeSchema = {
  type: 'object',
  properties: {
    local_key: { type: 'string', minLength: 1, maxLength: 100 },
    subject: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['portfolio', 'instrument', 'category', 'account'] },
        ref: { type: 'string' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    window_from: { type: 'string', format: 'date-time' },
    window_to: { type: 'string', format: 'date-time' },
    coverage: { type: 'string', enum: ['sufficient', 'partial', 'unverified'] },
    reason: { type: 'string' },
    checked_at: { type: 'string', format: 'date-time' },
    evidence_keys: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 100 },
      uniqueItems: true,
    },
    checked_sources: { type: 'array', items: checkedSourceSchema },
  },
  required: [
    'local_key',
    'subject',
    'window_from',
    'window_to',
    'coverage',
    'checked_at',
    'evidence_keys',
    'checked_sources',
  ],
  additionalProperties: false,
}

const briefingSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string', minLength: 1, maxLength: 500 },
    status: { type: 'string', enum: ['no_action', 'attention', 'insufficient_data'] },
    changes: { type: 'array', maxItems: 20, items: briefingItemSchema },
    uncertainties: { type: 'array', maxItems: 20, items: briefingItemSchema },
    evidence_keys: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 100 },
      uniqueItems: true,
    },
    decision_ids: { type: 'array', maxItems: 0, items: { type: 'string' } },
    task_ids: { type: 'array', maxItems: 0, items: { type: 'string' } },
  },
  required: ['headline', 'status', 'changes', 'uncertainties'],
  additionalProperties: false,
}

const dailyContextOutputSchema = successEnvelope({
  type: 'object',
  properties: {
    context_id: idSchema,
    expires_at: timestampSchema,
    snapshot: {
      type: 'object',
      properties: {
        schema_version: { const: 1 },
        as_of: timestampSchema,
        review_date: { type: 'string', format: 'date' },
        timezone: { type: 'string' },
        requested_subject_tickers: { type: 'array', items: { type: 'string' } },
        completeness: { type: 'object' },
      },
      required: ['schema_version', 'as_of', 'review_date', 'timezone', 'requested_subject_tickers', 'completeness'],
      additionalProperties: true,
    },
  },
  required: ['context_id', 'expires_at', 'snapshot'],
  additionalProperties: false,
})

const dailyBriefingOutputSchema = successEnvelope({
  type: 'object',
  properties: {
    id: idSchema,
    review_date: { type: 'string', format: 'date' },
    timezone: { type: 'string' },
    analyzed_at: timestampSchema,
    status: { type: 'string', enum: ['no_action', 'attention', 'insufficient_data'] },
    coverage_status: { type: 'string', enum: ['complete', 'partial', 'failed'] },
    headline: { type: 'string' },
    changes: { type: 'array', items: briefingItemSchema },
    uncertainties: { type: 'array', items: briefingItemSchema },
    evidence: { type: 'array' },
    scopes: { type: 'array' },
  },
  required: ['id', 'review_date', 'timezone', 'analyzed_at', 'status', 'coverage_status', 'headline', 'changes', 'uncertainties', 'evidence', 'scopes'],
  additionalProperties: true,
})

const dailyBriefingListOutputSchema = successEnvelope({
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: idSchema,
      review_date: { type: 'string', format: 'date' },
      timezone: { type: 'string' },
      analyzed_at: timestampSchema,
      status: { type: 'string', enum: ['no_action', 'attention', 'insufficient_data'] },
      coverage_status: { type: 'string', enum: ['complete', 'partial', 'failed'] },
      headline: { type: 'string' },
      supersedes_id: { type: ['string', 'null'], format: 'uuid' },
      created_at: timestampSchema,
    },
    required: ['id', 'review_date', 'timezone', 'analyzed_at', 'status', 'coverage_status', 'headline', 'supersedes_id', 'created_at'],
    additionalProperties: false,
  },
})

const updatedAtCursorSchema = {
  type: ['object', 'null'],
  properties: { updated_at: timestampSchema, id: idSchema },
  required: ['updated_at', 'id'],
  additionalProperties: false,
  description: 'Use null for the first cursor page, then pass next_cursor unchanged.',
}
const analyzedAtCursorSchema = {
  type: ['object', 'null'],
  properties: { analyzed_at: timestampSchema, id: idSchema },
  required: ['analyzed_at', 'id'],
  additionalProperties: false,
  description: 'Use null for the first cursor page, then pass next_cursor unchanged.',
}
const createdAtCursorSchema = {
  type: ['object', 'null'],
  properties: { created_at: timestampSchema, id: idSchema },
  required: ['created_at', 'id'],
  additionalProperties: false,
  description: 'Use null for the first cursor page, then pass next_cursor unchanged.',
}
const pageOutputSchema = successEnvelope({
  type: 'object',
  properties: {
    items: { type: 'array' },
    next_cursor: { type: ['object', 'null'] },
  },
  required: ['items', 'next_cursor'],
  additionalProperties: false,
})
const legacyOrPageOutputSchema = {
  oneOf: [successEnvelope({ type: 'array' }), pageOutputSchema],
}

const holdingValueSchema = {
  type: 'object',
  properties: {
    quantity: { ...nonNegativeDecimalStringSchema },
    avg_price: { ...nonNegativeDecimalStringSchema },
    purchase_amount: { ...nonNegativeDecimalStringSchema },
    valuation_amount: { ...nonNegativeDecimalStringSchema },
  },
  additionalProperties: false,
}

const reconciliationPreviewOutputSchema = successEnvelope({
  type: 'object',
  properties: {
    preview_id: idSchema,
    expires_at: timestampSchema,
    holding_id: { type: 'integer' },
    instrument_id: { type: 'integer' },
    instrument_type: { type: 'string', enum: ['market', 'valuation', 'cash'] },
    before: holdingValueSchema,
    after: holdingValueSchema,
    confirmed_fields: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
    effective_on: { type: 'string', format: 'date' },
  },
  required: ['preview_id', 'expires_at', 'holding_id', 'instrument_id', 'instrument_type', 'before', 'after', 'confirmed_fields', 'reason', 'effective_on'],
  additionalProperties: false,
})

const reconciliationOutputSchema = successEnvelope({
  type: 'object',
  properties: {
    reconciliation_id: idSchema,
    holding_id: { type: 'integer' },
    holding_state_version: { type: 'integer' },
    before: holdingValueSchema,
    after: holdingValueSchema,
    verification_id: { type: ['string', 'null'], format: 'uuid' },
  },
  required: ['reconciliation_id', 'holding_id', 'holding_state_version', 'before', 'after', 'verification_id'],
  additionalProperties: false,
})

const lifecycleSubjectSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['portfolio', 'instrument', 'position'] },
    instrument_id: { type: 'string', minLength: 1 },
    account_id: { type: 'string', minLength: 1 },
    label: { type: 'string' },
  },
  required: ['kind'],
  additionalProperties: false,
}

const researchTaskCreateSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 500 },
    subject: lifecycleSubjectSchema,
    due_date: { type: ['string', 'null'], format: 'date' },
    trigger_text: { type: 'string' },
  },
  required: ['title', 'subject'],
  additionalProperties: false,
}

const taskTransitionEvidenceSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 500 },
    source_url: { type: 'string', pattern: '^https?://' },
    summary: { type: 'string', minLength: 1, maxLength: 4000 },
    checked_at: { type: 'string', format: 'date-time' },
  },
  required: ['title', 'source_url', 'summary', 'checked_at'],
  additionalProperties: false,
}

const policyRestrictionSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['preference', 'prohibition'] },
    text: { type: 'string', minLength: 1, maxLength: 1000 },
  },
  required: ['kind', 'text'],
  additionalProperties: false,
}

const policyPatchSchema = {
  type: 'object',
  properties: {
    raw_text: { type: ['string', 'null'], maxLength: 10000 },
    goal_text: { type: ['string', 'null'], maxLength: 4000 },
    horizon_text: { type: ['string', 'null'], maxLength: 4000 },
    liquidity_need_text: { type: ['string', 'null'], maxLength: 4000 },
    risk_tolerance_text: { type: ['string', 'null'], maxLength: 4000 },
    trading_preference_text: { type: ['string', 'null'], maxLength: 4000 },
    restrictions: { type: 'array', maxItems: 20, items: policyRestrictionSchema },
  },
  minProperties: 1,
  additionalProperties: false,
}

const holdingThesisPatchSchema = {
  type: 'object',
  properties: {
    reason_text: { type: ['string', 'null'], maxLength: 10000 },
    horizon_text: { type: ['string', 'null'], maxLength: 4000 },
    review_condition_text: { type: ['string', 'null'], maxLength: 4000 },
    next_review_date: { type: ['string', 'null'], format: 'date' },
    related_decision_id: { type: ['string', 'null'], format: 'uuid' },
    is_active: { type: 'boolean' },
  },
  minProperties: 1,
  additionalProperties: false,
}

export const portfolioToolDefinitions: PortfolioToolDefinition[] = [
  {
    name: 'get_workflow_guide',
    title: 'Portfolio workflow guide',
    description: 'Read the current step order, questions, safety boundaries, and recovery rules before a multi-step Portfolio task. Choose the matching topic for a policy interview, holding reason, daily review, decision/follow-up, completed trade entry, balance correction, activity report, or product-feedback flow. This guide does not read user data, perform the workflow, or replace explicit save intent.',
    inputSchema: {
      type: 'object',
      properties: { topic: { type: 'string', enum: workflowGuideTopics } },
      required: ['topic'],
      additionalProperties: false,
    },
    outputSchema: workflowGuideOutputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'get_profile',
    title: 'Connected portfolio profile',
    description: 'Return the profile represented by the authenticated Portfolio account.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: profileOutputSchema,
    annotations: readOnlyAnnotations,
    _meta: { 'openai/profile': true },
  },
  {
    name: 'get_portfolio_state',
    title: 'Portfolio state',
    description: 'Read current accounts, holdings, instruments, tags, latest prices, and valuation_quality when you need the live asset state outside a daily-review snapshot. Treat missing values as unknown, never zero; do not make definitive allocation or rebalancing claims when valuation_quality.is_complete is false.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotations,
  },
  {
    name: 'find_holdings',
    title: 'Find holdings',
    description: 'Find the authenticated user\'s holdings by ticker, display name, or account name.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Ticker, name, or account. Empty means all.' } },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
  {
    name: 'update_entity_note',
    title: 'Update an existing portfolio entity note',
    description: 'Update only the note attached to one existing account, instrument, or holding after the user explicitly asks to remember, revise, or clear target-specific information. Read get_portfolio_state or find_holdings first and pass the exact current note as expected_note; use null for an empty note. A conflict means the note changed after it was read, so re-read instead of overwriting it. This does not change quantities, costs, prices, tags, strategy, holding theses, verification status, or activity outside the note audit event. Do not force a portfolio-wide instruction into an arbitrary entity note.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 },
        entity_type: { type: 'string', enum: ['account', 'instrument', 'holding'] },
        entity_id: { type: 'integer', minimum: 1 },
        expected_note: { type: ['string', 'null'], maxLength: 4000 },
        note: { type: ['string', 'null'], maxLength: 4000 },
        idempotency_key: { type: 'string', format: 'uuid' },
      },
      required: ['schema_version', 'entity_type', 'entity_id', 'expected_note', 'note', 'idempotency_key'],
      additionalProperties: false,
    },
    outputSchema: entityNoteOutputSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'get_strategy_state',
    title: 'Investment strategy',
    description: 'Read allocation modes, target buckets, and tag mappings when the task is specifically about allocation or rebalancing. Use list_principles for saved personal goals, risk preferences, liquidity needs, or operating rules. Do not treat old strategy notes as the new principle source.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotations,
  },
  {
    name: 'get_news_state',
    title: 'Saved market news',
    description: 'Read market news facts and opinions saved by the authenticated user.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotations,
  },
  {
    name: 'list_recent_activity',
    title: 'Recent portfolio activity',
    description: 'List recent portfolio changes for the authenticated user.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
  {
    name: 'submit_product_feedback',
    title: 'Submit product feedback',
    description: 'Save feedback about the Portfolio app itself, not an investment decision, research follow-up, or trade. If the user explicitly asks to register a clear issue or suggestion, submit it without asking them to repeat or reconfirm it. If you noticed a concrete recurring app problem during conversation, first summarize one proposed feedback item and ask once; call this tool only after the user agrees. Never submit on refusal, silence, vague frustration, or a transient recovered error. Store only the concise user-visible problem or suggestion and optional allowlisted operational context—never a transcript, portfolio data, email, credentials, tokens, or a guessed root cause. This creates a private Portfolio feedback record, not a public GitHub issue.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 },
        body: { type: 'string', minLength: 1, maxLength: 4000 },
        context: {
          type: 'object',
          properties: {
            page_key: { type: ['string', 'null'], maxLength: 200 },
            app_version: { type: ['string', 'null'], maxLength: 200 },
            tool_name: { type: ['string', 'null'], maxLength: 200 },
            error_code: { type: ['string', 'null'], maxLength: 200 },
            request_id: { type: ['string', 'null'], maxLength: 200 },
          },
          additionalProperties: false,
        },
        idempotency_key: idSchema,
      },
      required: ['schema_version', 'body', 'idempotency_key'],
      additionalProperties: false,
    },
    outputSchema: feedbackOutputSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'list_my_product_feedback',
    title: 'List my product feedback',
    description: 'List only the authenticated user\'s private Portfolio product-feedback submissions, statuses, operator responses, and optional linked GitHub issues. Use this to verify a submission or answer a status question. It does not expose other users, investment records, or an operator triage queue.',
    inputSchema: {
      type: 'object',
      properties: {
        cursor: { oneOf: [{ type: 'null' }, createdAtCursorSchema], default: null },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
      additionalProperties: false,
    },
    outputSchema: feedbackPageOutputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'get_daily_context',
    title: 'Prepare daily review context',
    description: 'Start a daily review by creating one short-lived owner-only snapshot. It includes current principles and private_holding_notes; treat older investment_policy and holding_theses keys as transition copies, not the new source. Use the snapshot instead of separately reading portfolio, strategy, saved news, and activity for the same review. It does not save an analysis, mark a review complete, or fetch public news.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 },
        timezone: { type: 'string', minLength: 1, default: 'Asia/Seoul' },
        subject_tickers: {
          type: 'array',
          maxItems: 200,
          items: { type: 'string', minLength: 1 },
          uniqueItems: true,
          description: 'Optional current holding tickers. Omit to review the whole portfolio.',
        },
      },
      required: ['schema_version', 'timezone'],
      additionalProperties: false,
    },
    outputSchema: dailyContextOutputSchema,
    annotations: contextAnnotations,
  },
  {
    name: 'save_daily_briefing',
    title: 'Save daily portfolio briefing',
    description: 'Save a user-requested daily briefing with its immutable context snapshot, sourced evidence, checked research scopes, and uncertainties. This never changes investment principles, accepts a decision for the user, records a trade, or places an order.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 },
        context_id: { type: 'string', format: 'uuid' },
        idempotency_key: { type: 'string', format: 'uuid' },
        evidence: { type: 'array', maxItems: 50, items: evidenceSchema },
        scopes: { type: 'array', minItems: 1, maxItems: 200, items: scopeSchema },
        briefing: briefingSchema,
        supersedes_briefing_id: { type: 'string', format: 'uuid' },
      },
      required: ['schema_version', 'context_id', 'idempotency_key', 'evidence', 'scopes', 'briefing'],
      additionalProperties: false,
    },
    outputSchema: dailyBriefingOutputSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'list_daily_briefings',
    title: 'Daily portfolio briefings',
    description: 'List saved daily briefing summaries, newest first. For stable pagination, pass cursor:null on the first call and then pass next_cursor unchanged; omit cursor only for legacy before-based behavior. Do not send cursor and before together.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        before: { type: 'string', format: 'date-time' },
        cursor: analyzedAtCursorSchema,
      },
      additionalProperties: false,
    },
    outputSchema: legacyOrPageOutputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'get_daily_briefing',
    title: 'Daily portfolio briefing detail',
    description: 'Read one complete owner-only briefing with its saved context snapshot, evidence, checked sources, and research scopes.',
    inputSchema: {
      type: 'object',
      properties: { briefing_id: { type: 'string', format: 'uuid' } },
      required: ['briefing_id'],
      additionalProperties: false,
    },
    outputSchema: dailyBriefingOutputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'record_investment_decision',
    title: 'Record investment decision',
    description: 'Use only when the user explicitly asks to record a proposed idea or their adopted investment decision. It can atomically create up to three research follow-ups. An adopted decision requires the user-selected option and reason. It never creates an execution plan, trade, order, or holding change.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 },
        idempotency_key: { type: 'string', format: 'uuid' },
        status: { type: 'string', enum: ['proposed', 'adopted'] },
        subject: lifecycleSubjectSchema,
        question: { type: 'string', minLength: 1, maxLength: 1000 },
        options: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', minLength: 1 } },
        selected_option: { type: 'string' },
        reason: { type: 'string' },
        uncertainty: { type: 'string' },
        review_condition: { type: 'string' },
        policy_snapshot: { type: 'object' },
        source_briefing_id: { type: 'string', format: 'uuid' },
        timezone: { type: 'string', minLength: 1, default: 'Asia/Seoul' },
        follow_up_tasks: { type: 'array', maxItems: 3, items: researchTaskCreateSchema },
      },
      required: ['schema_version', 'idempotency_key', 'status', 'subject', 'question', 'options', 'timezone', 'follow_up_tasks'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'list_investment_decisions',
    title: 'Investment decisions',
    description: 'List saved investment decisions. Proposed ideas are not user-adopted decisions. For stable pagination, pass cursor:null and filter current, closed, or all; then pass next_cursor unchanged. Omit cursor only for legacy before-based behavior.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        before: { type: 'string', format: 'date-time' },
        cursor: updatedAtCursorSchema,
        filter: { type: 'string', enum: ['current', 'closed', 'all'], default: 'current' },
      },
      additionalProperties: false,
    },
    outputSchema: legacyOrPageOutputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'get_investment_decision',
    title: 'Investment decision detail',
    description: 'Read one owner-only investment decision with its status history and linked research follow-ups. It does not mark the decision as adopted or reviewed.',
    inputSchema: {
      type: 'object',
      properties: { decision_id: { type: 'string', format: 'uuid' } },
      required: ['decision_id'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'list_tasks',
    title: 'Portfolio tasks and execution plans',
    description: 'List research/review tasks and quantity execution plans. A research task is a question; an execution plan is still not a brokerage order or proof of execution. For stable pagination, pass cursor:null and filter active, paused, closed, or all; then pass next_cursor unchanged. Omit cursor only for legacy research-state behavior.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['open', 'waiting', 'resolved', 'closed'] },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        before: { type: 'string', format: 'date-time' },
        cursor: updatedAtCursorSchema,
        filter: { type: 'string', enum: ['active', 'paused', 'closed', 'all'], default: 'active' },
      },
      additionalProperties: false,
    },
    outputSchema: legacyOrPageOutputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'get_task',
    title: 'Portfolio task detail',
    description: 'Read one owner-only portfolio task with its current state, history, and linked decision IDs. Reading does not complete, pause, or close the task.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string', format: 'uuid' } },
      required: ['task_id'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'list_general_tasks',
    title: 'General portfolio tasks',
    description: 'List owner-only general portfolio follow-ups. These are user intentions, not proof that work happened. Use active for unfinished work and completed only to inspect finished tasks. Pass next_cursor unchanged for the next page.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['active', 'completed', 'paused', 'cancelled', 'all'], default: 'active' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        cursor: { type: ['object', 'null'] },
      },
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'get_general_task',
    title: 'General portfolio task detail',
    description: 'Read one owner-only general task with its current version, history, and linked action events. Reading never completes or changes the task.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string', format: 'uuid' } },
      required: ['task_id'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'get_activity',
    title: 'Activity detail',
    description: 'Read one performed activity with its current title, note, result, conclusion, source target ID, linked originating task, and follow-up tasks. For a decision activity, use its investment_decisions target ID with the decision tools instead of treating the activity as the decision source. Use editable_fields and version before an update. Reading never creates a task, changes financial facts, or marks anything complete.',
    inputSchema: {
      type: 'object',
      properties: { activity_id: { type: 'integer', minimum: 1 } },
      required: ['activity_id'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'search_activities',
    title: 'Search tasks and performed activities',
    description: 'Search future tasks and performed activities through one owner-scoped query. Combine optional Korean or ticker keywords with date, task-versus-done state, conclusion presence, account, instrument, and reusable activity tags. On the first completed-activity page, semantic similarity may supplement keyword ranking; semantic_status reports whether it ran, and keyword results remain available when it did not. Filters and sharing checks run before ranking. Pass next_cursor unchanged and never treat an unavailable semantic pass or an error as no history.',
    inputSchema: { type: 'object', properties: {
      query: { type: ['string','null'], maxLength: 500 }, from: { type: ['string','null'], format: 'date' }, to: { type: ['string','null'], format: 'date' },
      record_state: { type: 'string', enum: ['all','todo','done'], default: 'all' }, has_conclusion: { type: ['boolean','null'] },
      instrument_id: { type: ['integer','null'], minimum: 1 }, account_id: { type: ['integer','null'], minimum: 1 },
      tag_ids: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', format: 'uuid' } }, tag_match: { type: 'string', enum: ['all','any'], default: 'all' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 }, cursor: { type: ['object','null'] }, timezone: { type: 'string', minLength: 1 },
    }, required: ['query','from','to','record_state','has_conclusion','instrument_id','account_id','tag_ids','tag_match','limit','cursor','timezone'], additionalProperties: false },
    outputSchema: successEnvelopeSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'list_activity_tags', title: 'List activity tags',
    description: 'List the owner\'s reusable activity tags and their activity/task counts. Activity tags are separate from allocation tags and never affect portfolio weights.',
    inputSchema: { type: 'object', properties: { query: { type: ['string','null'], maxLength: 50 } }, required: ['query'], additionalProperties: false },
    outputSchema: successEnvelopeSchema, annotations: readOnlyAnnotations,
  },
  {
    name: 'save_activity_tag', title: 'Create or rename an activity tag',
    description: 'Create one reusable activity tag or rename an existing tag after reading its current version. This does not tag any record by itself and never affects allocation tags or weights.',
    inputSchema: { type: 'object', properties: {
      schema_version: { const: 1 }, tag_id: { type: ['string','null'], format: 'uuid' }, expected_version: { type: ['integer','null'], minimum: 1 },
      idempotency_key: { type: 'string', format: 'uuid' }, name: { type: 'string', minLength: 1, maxLength: 50 },
    }, required: ['schema_version','tag_id','expected_version','idempotency_key','name'], additionalProperties: false },
    outputSchema: successEnvelopeSchema, annotations: idempotentWriteAnnotations,
  },
  {
    name: 'delete_activity_tag', title: 'Delete an activity tag',
    description: 'Delete one owner activity tag after reading its current version. Its tag links are removed, but activities, tasks, financial data, and allocation tags remain.',
    inputSchema: { type: 'object', properties: { schema_version: { const: 1 }, tag_id: { type: 'string', format: 'uuid' }, expected_version: { type: 'integer', minimum: 1 }, idempotency_key: { type: 'string', format: 'uuid' } }, required: ['schema_version','tag_id','expected_version','idempotency_key'], additionalProperties: false },
    outputSchema: successEnvelopeSchema, annotations: idempotentWriteAnnotations,
  },
  {
    name: 'set_activity_tags', title: 'Set tags on a performed activity',
    description: 'Replace the activity-tag set on one performed activity after reading its current activity version. An empty tag_ids array clears tags. This updates the same activity and does not alter its financial facts.',
    inputSchema: { type: 'object', properties: { schema_version: { const: 1 }, activity_id: { type: 'integer', minimum: 1 }, expected_version: { type: 'integer', minimum: 1 }, tag_ids: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', format: 'uuid' } }, idempotency_key: { type: 'string', format: 'uuid' } }, required: ['schema_version','activity_id','expected_version','tag_ids','idempotency_key'], additionalProperties: false },
    outputSchema: successEnvelopeSchema, annotations: idempotentWriteAnnotations,
  },
  {
    name: 'set_general_task_tags', title: 'Set tags on a general task',
    description: 'Replace the activity-tag set on one general task after reading its current version. Completion copies the current tags to that performed activity; later task tag edits never rewrite earlier completions.',
    inputSchema: { type: 'object', properties: { schema_version: { const: 1 }, task_id: { type: 'string', format: 'uuid' }, expected_version: { type: 'integer', minimum: 1 }, tag_ids: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', format: 'uuid' } }, idempotency_key: { type: 'string', format: 'uuid' } }, required: ['schema_version','task_id','expected_version','tag_ids','idempotency_key'], additionalProperties: false },
    outputSchema: successEnvelopeSchema, annotations: idempotentWriteAnnotations,
  },
  {
    name: 'save_general_task',
    title: 'Save a general portfolio task',
    description: 'Create or revise one owner-only follow-up only when the user asks to remember something to do. Read the current task before editing it. This stores intent only and never claims the work, trade, or verification happened.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 }, task_id: { type: ['string', 'null'], format: 'uuid' },
        expected_version: { type: ['integer', 'null'], minimum: 1 }, idempotency_key: { type: 'string', format: 'uuid' },
        title: { type: 'string', minLength: 1, maxLength: 500 },
        subject: { type: 'object', properties: { kind: { type: 'string', enum: ['portfolio', 'instrument', 'position'] } }, required: ['kind'], additionalProperties: true },
        due_date: { type: ['string', 'null'], format: 'date' }, timezone: { type: 'string', minLength: 1 },
        trigger_text: { type: ['string', 'null'], maxLength: 1000 }, change_reason: { type: ['string', 'null'], maxLength: 1000 },
        recurrence_kind: { type: 'string', enum: ['none', 'daily'], default: 'none' },
        recurrence_start_on: { type: ['string', 'null'], format: 'date' },
        origin_activity_id: { type: ['integer', 'null'], minimum: 1 },
      },
      required: ['schema_version','task_id','expected_version','idempotency_key','title','subject','due_date','timezone','trigger_text','change_reason','recurrence_kind','recurrence_start_on','origin_activity_id'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'transition_general_task',
    title: 'Complete or control a general task',
    description: 'Complete, reopen, pause, resume, or cancel one general task after reading its current version. Completion records a linked action event; reopening preserves that history. A result describes what actually happened and must not be invented.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 }, task_id: { type: 'string', format: 'uuid' }, expected_version: { type: 'integer', minimum: 1 },
        idempotency_key: { type: 'string', format: 'uuid' }, action: { type: 'string', enum: ['complete','reopen','pause','resume','cancel'] },
        result: { type: ['string', 'null'], maxLength: 4000 }, reason: { type: ['string', 'null'], maxLength: 1000 },
        occurrence_on: { type: ['string', 'null'], format: 'date' },
      },
      required: ['schema_version','task_id','expected_version','idempotency_key','action','result','reason','occurrence_on'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'record_manual_activity',
    title: 'Record a completed activity',
    description: 'Record one user-reported activity that already happened. Classify research, review, decision, or retrospective work with category; omit it for general work. Include factual source links and scope in context when relevant, distinguishing facts from conclusions. Use only after explicit save intent. Complete a known matching task instead of duplicating the same performance. This does not create a task or change financial data; choosing a category cannot claim a completed trade or reconciliation.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 }, idempotency_key: { type: 'string', format: 'uuid' },
        title: { type: 'string', minLength: 1, maxLength: 500 }, note: { type: ['string', 'null'], maxLength: 4000 },
        result: { type: ['string', 'null'], maxLength: 4000 }, conclusion: { type: ['string', 'null'], maxLength: 4000 },
        occurred_at: { type: ['string', 'null'], format: 'date-time' }, timezone: { type: 'string', minLength: 1 },
        instrument_id: { type: ['integer', 'null'], minimum: 1 }, account_id: { type: ['integer', 'null'], minimum: 1 },
        category: { type: 'string', enum: ['general','research','review','decision','retrospective'], default: 'general' },
        context: { type: ['object','null'], description: 'Optional structured scope and sources; sources is an array of up to 20 {title,url} HTTP(S) links. Do not include secrets or unrelated personal data.', additionalProperties: true },
      },
      required: ['schema_version','idempotency_key','title','note','result','conclusion','occurred_at','timezone','instrument_id','account_id'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'update_activity',
    title: 'Update a performed activity',
    description: 'Revise one activity in place after reading get_activity. Manual work may also correct its non-financial record_kind and structured source/scope context. Task completions cannot change classification or context; automatic financial facts expose note only. Protected before/after values, references, quantities, and financial timestamps cannot be overwritten.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 }, activity_id: { type: 'integer', minimum: 1 }, expected_version: { type: 'integer', minimum: 1 },
        idempotency_key: { type: 'string', format: 'uuid' },
        patch: {
          type: 'object', minProperties: 1,
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 500 }, note: { type: ['string', 'null'], maxLength: 4000 },
            result: { type: ['string', 'null'], maxLength: 4000 }, conclusion: { type: ['string', 'null'], maxLength: 4000 },
            occurred_at: { type: 'string', format: 'date-time' }, timezone: { type: 'string', minLength: 1 },
            instrument_id: { type: ['integer', 'null'], minimum: 1 }, account_id: { type: ['integer', 'null'], minimum: 1 },
            record_kind: { type: 'string', enum: ['general','research','review','decision','retrospective'] },
            context: { type: ['object','null'], description: 'Replace or clear the optional scope and source context of a manual activity.' },
          }, additionalProperties: false,
        },
      },
      required: ['schema_version','activity_id','expected_version','idempotency_key','patch'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'get_activity_report_context',
    title: 'Read source actions for a period report',
    description: 'Page through every successful owner action in one date range before writing an activity report. Continue with next_cursor until null; do not summarize only the first page. It also returns current open tasks, explicitly labeled as current rather than historical period-end state. Reading never saves a report.',
    inputSchema: { type: 'object', properties: {
      period_start: { type: 'string', format: 'date' }, period_end: { type: 'string', format: 'date' }, timezone: { type: 'string', minLength: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 }, cursor: { type: ['object','null'] },
    }, required: ['period_start','period_end','timezone'], additionalProperties: false },
    outputSchema: successEnvelopeSchema, annotations: readOnlyAnnotations,
  },
  {
    name: 'list_activity_reports',
    title: 'List saved activity reports',
    description: 'List saved daily, weekly, or monthly activity reports. needs_regeneration means an included activity changed or moved periods, or a current in-period activity is not included; present the saved summary as stale and regenerate only when requested. Pass next_cursor unchanged.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 }, cursor: { type: ['object','null'] } }, additionalProperties: false },
    outputSchema: successEnvelopeSchema, annotations: readOnlyAnnotations,
  },
  {
    name: 'save_activity_report',
    title: 'Save a period activity report',
    description: 'Save a user-requested daily, weekly, or monthly retrospective only after paging the full source period. Distinguish facts from interpretation, never infer investment intent from automatic edits, include every consulted event ID, and preserve current open tasks as a separately labeled snapshot. This does not schedule future reports or add an investment action event.',
    inputSchema: { type: 'object', properties: {
      schema_version: { const: 1 }, report_id: { type: ['string','null'], format: 'uuid' }, expected_version: { type: ['integer','null'], minimum: 1 }, idempotency_key: { type: 'string', format: 'uuid' },
      period_kind: { type: 'string', enum: ['daily','weekly','monthly'] }, period_start: { type: 'string', format: 'date' }, period_end: { type: 'string', format: 'date' }, timezone: { type: 'string', minLength: 1 },
      title: { type: 'string', minLength: 1, maxLength: 300 }, summary: { type: 'string', minLength: 1, maxLength: 10000 }, highlights: { type: 'array', maxItems: 100 }, open_items: { type: 'array', maxItems: 100 },
      source_event_ids: { type: 'array', maxItems: 5000, uniqueItems: true, items: { type: 'integer', minimum: 1 } }, source_task_ids: { type: 'array', maxItems: 1000, uniqueItems: true, items: { type: 'string', format: 'uuid' } }, source_decision_ids: { type: 'array', maxItems: 1000, uniqueItems: true, items: { type: 'string', format: 'uuid' } },
    }, required: ['schema_version','report_id','expected_version','idempotency_key','period_kind','period_start','period_end','timezone','title','summary','highlights','open_items','source_event_ids','source_task_ids','source_decision_ids'], additionalProperties: false },
    outputSchema: successEnvelopeSchema, annotations: idempotentWriteAnnotations,
  },
  {
    name: 'transition_investment_decision',
    title: 'Adopt or dismiss proposed decision',
    description: 'Use only after the user explicitly adopts or dismisses an existing proposed decision. Read its current version first. Adoption requires an option already present in the proposal and the user\'s reason. It never records a trade, order, execution plan, or holding change.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 },
        decision_id: { type: 'string', format: 'uuid' },
        expected_version: { type: 'integer', minimum: 1 },
        idempotency_key: { type: 'string', format: 'uuid' },
        action: { type: 'string', enum: ['adopt', 'dismiss'] },
        selected_option: { type: 'string' },
        reason: { type: 'string', minLength: 1 },
      },
      required: ['schema_version', 'decision_id', 'expected_version', 'idempotency_key', 'action', 'reason'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'transition_task',
    title: 'Update research task state',
    description: 'Update one research follow-up after reading its current version. Resolving requires an answer and source evidence; reopening requires a reason and new evidence. Pause, resume, or close only on the user\'s explicit request. It never records a trade, order, execution progress, or holding change.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 },
        task_id: { type: 'string', format: 'uuid' },
        expected_version: { type: 'integer', minimum: 1 },
        idempotency_key: { type: 'string', format: 'uuid' },
        action: { type: 'string', enum: ['wait', 'resolve', 'reopen', 'pause', 'resume', 'close'] },
        answer: { type: 'string' },
        reason: { type: 'string' },
        evidence: { type: 'array', maxItems: 20, items: taskTransitionEvidenceSchema },
      },
      required: ['schema_version', 'task_id', 'expected_version', 'idempotency_key', 'action', 'evidence'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'save_execution_task',
    title: 'Save a quantity execution plan',
    description: 'Create or revise an explicit market buy/sell quantity plan after the user asks to remember it. This records a plan only: it never records a fill, changes a holding, or places a brokerage order.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 }, task_id: { type: ['string', 'null'], format: 'uuid' },
        expected_version: { type: ['integer', 'null'], minimum: 1 }, idempotency_key: { type: 'string', format: 'uuid' },
        title: { type: 'string', minLength: 1, maxLength: 500 }, account_id: { type: 'integer', minimum: 1 }, instrument_id: { type: 'integer', minimum: 1 },
        side: { type: 'string', enum: ['buy', 'sell'] }, target_quantity: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,16})?$' },
        due_date: { type: ['string', 'null'], format: 'date' }, trigger_text: { type: ['string', 'null'], maxLength: 1000 }, timezone: { type: 'string', minLength: 1 }, change_reason: { type: ['string', 'null'], maxLength: 1000 },
      },
      required: ['schema_version','task_id','expected_version','idempotency_key','title','account_id','instrument_id','side','target_quantity','timezone'], additionalProperties: false,
    }, outputSchema: successEnvelopeSchema, annotations: idempotentWriteAnnotations,
  },
  {
    name: 'link_trade_to_task',
    title: 'Link a completed trade to an execution plan',
    description: 'Link one already-recorded local fill to a matching account, instrument, and side plan so progress is calculated. This never creates, changes, reverses, or duplicates a trade and one fill can count toward at most one plan.',
    inputSchema: { type: 'object', properties: {
      schema_version: { const: 1 }, trade_id: { type: 'string', format: 'uuid' }, task_id: { type: 'string', format: 'uuid' }, expected_task_version: { type: 'integer', minimum: 1 }, idempotency_key: { type: 'string', format: 'uuid' },
    }, required: ['schema_version','trade_id','task_id','expected_task_version','idempotency_key'], additionalProperties: false }, outputSchema: successEnvelopeSchema, annotations: idempotentWriteAnnotations,
  },
  {
    name: 'transition_execution_task', title: 'Pause, resume, or cancel an execution plan',
    description: 'Change only the control state of an execution plan after the user explicitly asks. Existing fills and holdings remain unchanged; cancelling a plan does not reverse any trade.',
    inputSchema: { type: 'object', properties: {
      schema_version: { const: 1 }, task_id: { type: 'string', format: 'uuid' }, expected_version: { type: 'integer', minimum: 1 }, action: { type: 'string', enum: ['pause','resume','cancel'] }, reason: { type: 'string', minLength: 1, maxLength: 1000 }, idempotency_key: { type: 'string', format: 'uuid' },
    }, required: ['schema_version','task_id','expected_version','action','reason','idempotency_key'], additionalProperties: false }, outputSchema: successEnvelopeSchema, annotations: idempotentWriteAnnotations,
  },
  {
    name: 'list_principles',
    title: 'List saved investment and operating principles',
    description: 'Read the owner-only principles that Portfolio remembers. The current view returns the latest row per stable principle ID; an optional local date returns the state as of that day. Ended principles are omitted by default. Read before advising from saved preferences or editing one; an empty list means nothing was saved, not permission to infer preferences.',
    inputSchema: { type: 'object', properties: {
      on_date: { type: 'string', format: 'date' }, timezone: { type: 'string', minLength: 1, maxLength: 100 }, include_ended: { type: 'boolean', default: false },
    }, additionalProperties: false }, outputSchema: successEnvelopeSchema, annotations: readOnlyAnnotations,
  },
  {
    name: 'save_principle',
    title: 'Save one approved principle',
    description: 'Append a revision to exactly one owner-only principle after the user asks to save it. Read list_principles first. Generate a new UUID for a new principle, or reuse its stable principle_id and latest row id for an edit. Use end=true to stop applying the principle; never infer or save model suggestions as user-approved rules. Does not alter holdings, allocation targets, or trades.',
    inputSchema: { type: 'object', properties: {
      schema_version: { const: 1 }, principle_id: { type: 'string', format: 'uuid' }, expected_row_id: { type: ['integer','null'], minimum: 1 },
      kind: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$' }, body: { type: 'string', minLength: 1, maxLength: 10000 },
      scope: { type: ['string','null'], maxLength: 200 }, end: { type: 'boolean', default: false },
    }, required: ['schema_version','principle_id','expected_row_id','kind','body'], additionalProperties: false },
    outputSchema: successEnvelopeSchema, annotations: idempotentWriteAnnotations,
  },
  {
    name: 'get_investment_policy',
    title: 'Investment policy and operating strategy',
    description: 'Read explicitly saved personal goals, horizon, liquidity needs, risk/trading preferences, and restrictions together with the operating strategy. For an interview or multi-step policy update, read get_workflow_guide(topic=policy) first. Use get_strategy_state alone for allocation mechanics. Missing personal fields remain unknown; do not infer them from holdings or the active mode.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: successEnvelopeSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'save_investment_policy',
    title: 'Save personal investment policy',
    description: 'Use only when the user explicitly asks to save or change their personal investment policy. For an interview-derived update, follow get_workflow_guide(topic=policy). Read the current version first, patch only approved fields, preserve restrictions that were not removed, and use null only to clear a field. This does not change target allocations, operating mode, holdings, decisions, or trades.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 },
        expected_version: { type: ['integer', 'null'], minimum: 1 },
        idempotency_key: { type: 'string', format: 'uuid' },
        patch: policyPatchSchema,
        change_reason: { type: 'string', minLength: 1, maxLength: 1000 },
      },
      required: ['schema_version', 'expected_version', 'idempotency_key', 'patch', 'change_reason'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'list_operating_rules',
    title: 'List saved operating rules',
    description: 'Read the owner-only current data-handling rules for one workflow before interpreting an external file or reconciling records. An empty rules array means no rule is saved; a tool error must not be treated as an empty result. Applicability text describes when a rule applies and must be checked against the actual input.',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_key: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,99}$' },
        include_archived: { type: 'boolean', default: false },
      },
      required: ['workflow_key'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'save_operating_rule',
    title: 'Save a data-handling rule',
    description: 'Create or revise an owner-only operating rule only when the user explicitly asks Portfolio to remember it. Read the workflow rules first, use the current version for edits, and save applicability separately from the rule body. A rule guides interpretation but never bypasses validation, permissions, or the user\'s current instruction.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 }, rule_id: { type: ['string', 'null'], format: 'uuid' },
        expected_version: { type: ['integer', 'null'], minimum: 1 }, idempotency_key: { type: 'string', format: 'uuid' },
        title: { type: 'string', minLength: 1, maxLength: 200 }, workflow_key: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,99}$' },
        applicability: { type: 'string', minLength: 1, maxLength: 2000 }, body: { type: 'string', minLength: 1, maxLength: 10000 },
        change_reason: { type: 'string', minLength: 1, maxLength: 1000 },
      },
      required: ['schema_version', 'rule_id', 'expected_version', 'idempotency_key', 'title', 'workflow_key', 'applicability', 'body', 'change_reason'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'archive_operating_rule',
    title: 'Archive an operating rule',
    description: 'Archive an obsolete owner-only operating rule after reading its current version and confirming the user no longer wants it applied. Archiving preserves history and does not modify holdings, prior reconciliations, or other investment principles.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 }, rule_id: { type: 'string', format: 'uuid' }, expected_version: { type: 'integer', minimum: 1 },
        idempotency_key: { type: 'string', format: 'uuid' }, reason: { type: 'string', minLength: 1, maxLength: 1000 },
      },
      required: ['schema_version', 'rule_id', 'expected_version', 'idempotency_key', 'reason'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'list_private_holding_notes',
    title: 'Read private holding reasons',
    description: 'Read the owner-only current reasons stored on instruments and account holdings. An account note overrides the instrument-wide reason for that account; a missing note means no reason was saved. These notes are not included in shared portfolio reads. Do not infer a reason from price or holdings.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: successEnvelopeSchema, annotations: readOnlyAnnotations,
  },
  {
    name: 'save_private_holding_note',
    title: 'Save one private holding reason',
    description: 'Save or clear an explicitly approved owner-only reason directly on an existing instrument or account holding. Read current notes first and provide the current expected_note to avoid overwriting a concurrent edit. Omit account_id for the instrument-wide note; use account_id for an existing holding. This never changes quantity, average cost, a trade, or public notes.',
    inputSchema: { type: 'object', properties: {
      schema_version: { const: 1 }, instrument_id: { type: 'integer', minimum: 1 },
      account_id: { type: ['integer','null'], minimum: 1 },
      expected_note: { type: ['string','null'], maxLength: 25000 },
      note: { type: ['string','null'], maxLength: 25000 },
    }, required: ['schema_version','instrument_id','account_id','expected_note','note'], additionalProperties: false },
    outputSchema: successEnvelopeSchema, annotations: idempotentWriteAnnotations,
  },
  {
    name: 'get_holding_thesis',
    title: 'Holding thesis',
    description: 'Read the explicitly saved reason for holding one instrument. With account_id, returns both the instrument-wide base and any account override, plus the applied source. Missing fields remain unknown and instrument or holding notes are separate.',
    inputSchema: {
      type: 'object',
      properties: {
        instrument_id: { type: 'integer', minimum: 1 },
        account_id: { type: ['integer', 'null'], minimum: 1 },
      },
      required: ['instrument_id'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'save_holding_thesis',
    title: 'Save holding thesis',
    description: 'Use only when the user explicitly asks to save or change why they hold an instrument. Omit account_id for the instrument-wide base or provide an account that currently holds it for an override. Read the current version first, patch only stated fields, and never invent a reason or review date. This does not change notes, holdings, trades, decisions, or tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 },
        instrument_id: { type: 'integer', minimum: 1 },
        account_id: { type: ['integer', 'null'], minimum: 1 },
        expected_version: { type: ['integer', 'null'], minimum: 1 },
        idempotency_key: { type: 'string', format: 'uuid' },
        patch: holdingThesisPatchSchema,
        change_reason: { type: 'string', minLength: 1, maxLength: 1000 },
      },
      required: ['schema_version', 'instrument_id', 'expected_version', 'idempotency_key', 'patch', 'change_reason'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'link_task_to_holding_thesis', title: 'Link a follow-up task to a holding thesis',
    description: 'Link an existing owner task to an existing holding thesis after reading both current versions. This preserves the relationship only and never changes the thesis, task state, holding, or trades.',
    inputSchema: { type: 'object', properties: { schema_version: { const: 1 }, thesis_id: { type: 'string', format: 'uuid' }, task_id: { type: 'string', format: 'uuid' }, expected_thesis_version: { type: 'integer', minimum: 1 }, expected_task_version: { type: 'integer', minimum: 1 }, idempotency_key: { type: 'string', format: 'uuid' } }, required: ['schema_version','thesis_id','task_id','expected_thesis_version','expected_task_version','idempotency_key'], additionalProperties: false }, outputSchema: successEnvelopeSchema, annotations: idempotentWriteAnnotations,
  },
  {
    name: 'preview_trade_entry',
    title: 'Preview a completed trade entry',
    description: 'Preview how a user-reported completed market buy or sell would change one account holding. Use decimal strings for quantity and execution price. This does not place an order, move cash, save a trade, or verify the brokerage balance.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'integer', minimum: 1 },
        instrument_id: { type: 'integer', minimum: 1 },
        side: { type: 'string', enum: ['buy', 'sell'] },
        quantity: { type: 'string', pattern: '^[0-9]+(?:\\.[0-9]{1,16})?$' },
        unit_price: { type: 'string', pattern: '^[0-9]+(?:\\.[0-9]{1,16})?$' },
        executed_on: { type: 'string', format: 'date' },
      },
      required: ['account_id', 'instrument_id', 'side', 'quantity', 'unit_price', 'executed_on'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: contextAnnotations,
  },
  {
    name: 'log_completed_trade',
    title: 'Record a completed trade',
    description: 'Use only after the user explicitly asks to record an already completed trade and after showing a fresh preview. Confirms that exact preview idempotently. It updates the local holding but never places or cancels a brokerage order, moves cash, or marks the balance verified.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 },
        preview_id: { type: 'string', format: 'uuid' },
        idempotency_key: { type: 'string', format: 'uuid' },
      },
      required: ['schema_version', 'preview_id', 'idempotency_key'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'list_transactions',
    title: 'Recorded completed trades',
    description: 'List completed trades recorded in Portfolio, optionally for one account or instrument. For stable pagination, pass cursor:null first and then next_cursor unchanged; omit cursor only for legacy before-based behavior. This is not a complete brokerage statement and excludes legacy or unrecorded trades, balance corrections, orders, and cash movements.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        before: { type: 'string', format: 'date-time' },
        cursor: createdAtCursorSchema,
        account_id: { type: 'integer', minimum: 1 },
        instrument_id: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
    outputSchema: legacyOrPageOutputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'get_holding_integrity', title: 'Holding reconciliation and verification status',
    description: 'Read the latest absolute correction and explicit brokerage verification for one holding. changed_since means the local holding version changed afterward; missing verification remains unknown rather than incorrect.',
    inputSchema: { type: 'object', properties: { holding_id: { type: 'integer', minimum: 1 } }, required: ['holding_id'], additionalProperties: false },
    outputSchema: successEnvelopeSchema, annotations: readOnlyAnnotations,
  },
  {
    name: 'get_portfolio_integrity', title: 'Portfolio verification summary',
    description: 'Summarize which current holdings were explicitly compared with a brokerage, which changed afterward, and which were never checked, grouped by account. It does not verify or change any value, and old status alone is not proof of an error.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: successEnvelopeSchema, annotations: readOnlyAnnotations,
  },
  {
    name: 'preview_holding_reconciliation', title: 'Preview an absolute holding correction',
    description: 'Preview replacing one holding with user-supplied actual values. Send non-negative decimals as strings, not JSON numbers. Market requires exactly quantity and avg_price; valuation requires purchase_amount and valuation_amount; cash requires valuation_amount. Zero market quantity still requires avg_price, which is discarded in the resulting zero balance. This does not modify the holding or imply brokerage verification unless confirmed_fields are explicit.',
    inputSchema: { type: 'object', properties: {
      holding_id: { type: 'integer', minimum: 1 }, values: { oneOf: [
        { type: 'object', properties: { quantity: nonNegativeDecimalStringSchema, avg_price: nonNegativeDecimalStringSchema }, required: ['quantity','avg_price'], additionalProperties: false },
        { type: 'object', properties: { purchase_amount: nonNegativeDecimalStringSchema, valuation_amount: nonNegativeDecimalStringSchema }, required: ['purchase_amount','valuation_amount'], additionalProperties: false },
        { type: 'object', properties: { valuation_amount: nonNegativeDecimalStringSchema }, required: ['valuation_amount'], additionalProperties: false },
      ] }, reason: { type: 'string', minLength: 1, maxLength: 1000 }, effective_on: { type: 'string', format: 'date' }, confirmed_fields: { type: 'array', items: { type: 'string', enum: ['quantity','avg_price','purchase_amount','valuation_amount'] }, uniqueItems: true },
    }, required: ['holding_id','values','reason','effective_on','confirmed_fields'], additionalProperties: false }, outputSchema: reconciliationPreviewOutputSchema, annotations: contextAnnotations,
  },
  {
    name: 'reconcile_holding', title: 'Apply an absolute holding correction',
    description: 'Use only after the user explicitly confirms a fresh correction preview. It establishes a new absolute local balance checkpoint and optionally records only the fields explicitly compared with the brokerage. It does not create a trade or place an order.',
    inputSchema: { type: 'object', properties: { schema_version: { const: 1 }, preview_id: { type: 'string', format: 'uuid' }, idempotency_key: { type: 'string', format: 'uuid' } }, required: ['schema_version','preview_id','idempotency_key'], additionalProperties: false }, outputSchema: reconciliationOutputSchema, annotations: idempotentWriteAnnotations,
  },
  {
    name: 'verify_holdings', title: 'Record explicit brokerage comparison',
    description: 'Record only the named fields the user explicitly says they compared with the brokerage at the current holding version. This never changes quantities, costs, valuation, trades, prices, or briefing dates.',
    inputSchema: { type: 'object', properties: { schema_version: { const: 1 }, holding_id: { type: 'integer', minimum: 1 }, expected_version: { type: 'integer', minimum: 1 }, fields: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: ['quantity','avg_price','purchase_amount','valuation_amount'] } }, verified_on: { type: 'string', format: 'date' }, note: { type: ['string','null'], maxLength: 1000 }, idempotency_key: { type: 'string', format: 'uuid' } }, required: ['schema_version','holding_id','expected_version','fields','verified_on','idempotency_key'], additionalProperties: false }, outputSchema: successEnvelopeSchema, annotations: idempotentWriteAnnotations,
  },
  { name:'preview_trade_reversal',title:'Preview cancelling a recorded trade',description:'Preview invalidating one Portfolio trade record while preserving history. It replays later valid local trades, or reports no current balance impact when a newer absolute correction protects the current value. It does not cancel a brokerage order or create an opposite trade.',inputSchema:{type:'object',properties:{trade_id:{type:'string',format:'uuid'},reason:{type:'string',minLength:1,maxLength:1000}},required:['trade_id','reason'],additionalProperties:false},outputSchema:successEnvelopeSchema,annotations:contextAnnotations },
  { name:'reverse_trade_entry',title:'Cancel a recorded trade entry',description:'Use only after explicit user confirmation of a fresh reversal preview. It preserves the original and appends a reversal, replays later local trades when applicable, and never cancels a brokerage order.',inputSchema:{type:'object',properties:{schema_version:{const:1},preview_id:{type:'string',format:'uuid'},idempotency_key:{type:'string',format:'uuid'}},required:['schema_version','preview_id','idempotency_key'],additionalProperties:false},outputSchema:successEnvelopeSchema,annotations:idempotentWriteAnnotations },
]

export const dailyReviewToolNames = [
  'get_daily_context',
  'save_daily_briefing',
  'list_daily_briefings',
  'get_daily_briefing',
] as const

export const workflowGuideToolNames = ['get_workflow_guide'] as const

export const productFeedbackToolNames = ['submit_product_feedback', 'list_my_product_feedback'] as const

export const entityNoteToolNames = ['update_entity_note'] as const

export const decisionTaskToolNames = [
  'record_investment_decision',
  'list_investment_decisions',
  'get_investment_decision',
  'list_tasks',
  'get_task',
  'transition_investment_decision',
  'transition_task',
  'save_execution_task',
  'link_trade_to_task',
  'transition_execution_task',
] as const

export const actionTaskToolNames = [
  'list_general_tasks',
  'get_general_task',
  'get_activity',
  'search_activities',
  'list_activity_tags',
  'save_activity_tag',
  'delete_activity_tag',
  'set_activity_tags',
  'set_general_task_tags',
  'save_general_task',
  'transition_general_task',
  'record_manual_activity',
  'update_activity',
] as const

export const activityReportToolNames = [
  'get_activity_report_context',
  'list_activity_reports',
  'save_activity_report',
] as const

export const investmentPolicyToolNames = [
  'list_principles',
  'save_principle',
  'get_investment_policy',
  'save_investment_policy',
] as const

export const operatingRuleToolNames = [
  'list_operating_rules',
  'save_operating_rule',
  'archive_operating_rule',
] as const

export const holdingThesisToolNames = [
  'list_private_holding_notes',
  'save_private_holding_note',
  'get_holding_thesis',
  'save_holding_thesis',
  'link_task_to_holding_thesis',
] as const

export const tradeEntryToolNames = [
  'preview_trade_entry',
  'log_completed_trade',
  'list_transactions',
] as const

export const holdingIntegrityToolNames = ['get_holding_integrity','get_portfolio_integrity','preview_holding_reconciliation','reconcile_holding','verify_holdings'] as const
export const tradeReversalToolNames = ['preview_trade_reversal','reverse_trade_entry'] as const
