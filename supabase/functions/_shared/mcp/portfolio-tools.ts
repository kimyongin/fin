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
    description: 'Read accounts, holdings, instruments, tags, and latest prices for the authenticated user.',
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
]

export const dailyReviewToolNames = [
  'get_daily_context',
  'save_daily_briefing',
  'list_daily_briefings',
  'get_daily_briefing',
] as const
