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

const successEnvelopeSchema = {
  type: 'object',
  properties: {
    ok: { const: true },
    data: {},
  },
  required: ['ok', 'data'],
  additionalProperties: false,
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
    changes: { type: 'array', maxItems: 20, items: { type: 'object' } },
    uncertainties: { type: 'array', maxItems: 20, items: { type: 'object' } },
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
    description: 'Read accounts, holdings, instruments, tags, latest prices, and valuation_quality for the authenticated user. Treat missing values as unknown, never zero; do not make definitive allocation or rebalancing claims when valuation_quality.is_complete is false.',
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
    name: 'get_strategy_state',
    title: 'Investment strategy',
    description: 'Read the authenticated user\'s active strategy, target buckets, and tag mappings.',
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
    name: 'get_daily_context',
    title: 'Prepare daily review context',
    description: 'Create a short-lived authenticated snapshot for a daily review. It reads stored portfolio facts and prior research windows but does not save an analysis, mark a review complete, or fetch public news.',
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
    outputSchema: successEnvelopeSchema,
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
    outputSchema: successEnvelopeSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'list_daily_briefings',
    title: 'Daily portfolio briefings',
    description: 'List compact summaries of the authenticated user\'s saved daily briefings, newest analysis first.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        before: { type: 'string', format: 'date-time' },
      },
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
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
    outputSchema: successEnvelopeSchema,
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
    description: 'List the authenticated user\'s saved investment decisions, newest change first. Proposed ideas are not user-adopted decisions.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        before: { type: 'string', format: 'date-time' },
      },
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
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
    title: 'Portfolio research tasks',
    description: 'List the authenticated user\'s research and review tasks. These are questions to revisit, not brokerage orders or proof of execution.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['open', 'waiting', 'resolved', 'closed'] },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        before: { type: 'string', format: 'date-time' },
      },
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
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
    name: 'get_investment_policy',
    title: 'Investment policy and operating strategy',
    description: 'Read the authenticated user\'s explicitly saved personal investment policy together with the existing operating strategy. Missing personal fields remain unknown; do not infer them from portfolio holdings or the active allocation mode.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: successEnvelopeSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'save_investment_policy',
    title: 'Save personal investment policy',
    description: 'Use only when the user explicitly asks to save or change their personal investment policy. Read the current version first, patch only stated fields, and use null only to clear a field. This does not change target allocations, operating mode, holdings, decisions, or trades.',
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
    description: 'List completed trades recorded in Portfolio. This is not a complete brokerage statement and excludes legacy or unrecorded trades, balance corrections, orders, and cash movements.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        before: { type: 'string', format: 'date-time' },
      },
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
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
    description: 'Preview replacing one holding with user-supplied actual values. Market holdings use quantity and avg_price, valuation holdings use purchase_amount and valuation_amount, and cash uses valuation_amount. This does not modify the holding or imply brokerage verification unless confirmed_fields are explicit.',
    inputSchema: { type: 'object', properties: {
      holding_id: { type: 'integer', minimum: 1 }, values: { type: 'object', minProperties: 1 }, reason: { type: 'string', minLength: 1, maxLength: 1000 }, effective_on: { type: 'string', format: 'date' }, confirmed_fields: { type: 'array', items: { type: 'string', enum: ['quantity','avg_price','purchase_amount','valuation_amount'] }, uniqueItems: true },
    }, required: ['holding_id','values','reason','effective_on','confirmed_fields'], additionalProperties: false }, outputSchema: successEnvelopeSchema, annotations: contextAnnotations,
  },
  {
    name: 'reconcile_holding', title: 'Apply an absolute holding correction',
    description: 'Use only after the user explicitly confirms a fresh correction preview. It establishes a new absolute local balance checkpoint and optionally records only the fields explicitly compared with the brokerage. It does not create a trade or place an order.',
    inputSchema: { type: 'object', properties: { schema_version: { const: 1 }, preview_id: { type: 'string', format: 'uuid' }, idempotency_key: { type: 'string', format: 'uuid' } }, required: ['schema_version','preview_id','idempotency_key'], additionalProperties: false }, outputSchema: successEnvelopeSchema, annotations: idempotentWriteAnnotations,
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

export const investmentPolicyToolNames = [
  'get_investment_policy',
  'save_investment_policy',
] as const

export const holdingThesisToolNames = [
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
