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

const destructiveWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
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
    entity_type: { type: 'string', enum: ['account', 'instrument'] },
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
const dailyContextOutputSchema = successEnvelope({
  type: 'object',
  properties: {
    as_of: timestampSchema,
    review_date: { type: 'string', format: 'date' },
    timezone: { type: 'string' },
    requested_subject_tickers: { type: 'array', items: { type: 'string' } },
    portfolio: { type: 'object' },
    strategy: { type: 'object' },
    principles: { type: 'array' },
    open_tasks: { type: 'array' },
    last_activity: { type: ['object', 'null'] },
    recent_activities: { type: 'array' },
  },
  required: ['as_of', 'review_date', 'timezone', 'requested_subject_tickers', 'portfolio', 'strategy', 'principles', 'open_tasks', 'last_activity', 'recent_activities'],
  additionalProperties: false,
})

const createdAtCursorSchema = {
  type: ['object', 'null'],
  properties: { created_at: timestampSchema, id: idSchema },
  required: ['created_at', 'id'],
  additionalProperties: false,
  description: 'Use null for the first cursor page, then pass next_cursor unchanged.',
}
const tradeCursorSchema = {
  type: ['object', 'null'],
  properties: { created_at: timestampSchema, id: { type: 'string', pattern: '^[0-9]+$' } },
  required: ['created_at', 'id'],
  additionalProperties: false,
  description: 'Use null for the first page, then pass next_cursor unchanged.',
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
const holdingCorrectionValuesSchema = { oneOf: [
  { type: 'object', properties: { quantity: nonNegativeDecimalStringSchema, avg_price: nonNegativeDecimalStringSchema }, required: ['quantity','avg_price'], additionalProperties: false },
  { type: 'object', properties: { purchase_amount: nonNegativeDecimalStringSchema, valuation_amount: nonNegativeDecimalStringSchema }, required: ['purchase_amount','valuation_amount'], additionalProperties: false },
  { type: 'object', properties: { valuation_amount: nonNegativeDecimalStringSchema }, required: ['valuation_amount'], additionalProperties: false },
] }

const reconciliationPreviewOutputSchema = successEnvelope({
  type: 'object',
  properties: {
    holding_id: { type: 'integer' },
    holding_state_version: { type: 'integer', minimum: 1 },
    instrument_id: { type: 'integer' },
    instrument_type: { type: 'string', enum: ['market', 'valuation', 'cash'] },
    before: holdingValueSchema,
    after: holdingValueSchema,
    reason: { type: 'string' },
    effective_on: { type: 'string', format: 'date' },
  },
  required: ['holding_id', 'holding_state_version', 'instrument_id', 'instrument_type', 'before', 'after', 'reason', 'effective_on'],
  additionalProperties: false,
})

const reconciliationOutputSchema = successEnvelope({
  type: 'object',
  properties: {
    activity_id: { type: 'integer', minimum: 1 },
    holding_id: { type: 'integer' },
    holding_state_version: { type: 'integer' },
    before: holdingValueSchema,
    after: holdingValueSchema,
  },
  required: ['activity_id', 'holding_id', 'holding_state_version', 'before', 'after'],
  additionalProperties: false,
})

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
    description: 'Read current accounts, holdings, registered instruments (including those with no holding yet), tags, latest prices, and valuation_quality. A registered instrument is not evidence of ownership; use holdings for quantities and allocation. Treat missing prices as unknown, never zero, and do not make definitive allocation claims when valuation_quality.is_complete is false. This read does not register a ticker, save a holding, or refresh prices.',
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
    description: 'Update only the note attached to one existing account or instrument after the user explicitly asks to remember, revise, or clear target-specific information. Read get_portfolio_state first and pass the exact current note as expected_note; use null for an empty note. A conflict means the note changed after it was read, so re-read instead of overwriting it. This does not change quantities, costs, prices, tags, strategy, verification status, or activity outside the note audit event. Do not force a portfolio-wide instruction into an arbitrary entity note.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 },
        entity_type: { type: 'string', enum: ['account', 'instrument'] },
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
    title: 'Allocation targets by asset tag',
    description: 'Read the owner\'s current numeric target percentage for each asset tag. configured=false means no target set was saved; a missing tag in a configured set means 0%. Compare against get_portfolio_state only when its valuation quality is complete. This is separate from Markdown principles and contains no modes, buckets, automatic trade recommendations, or brokerage orders.',
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
    description: 'Read current owner-only holdings, common instrument notes, principles, open tasks, and recent activities for a requested review. These are not pre-classified as reviews or decisions. This does not create a stored snapshot, save an analysis, or mark a review complete. ChatGPT researches current external news itself.',
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
    description: 'Read one owner-only general task with its current version and linked performed action events. The task is current intent, not a revision history; reading never completes or changes it.',
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
    name: 'list_due_general_tasks',
    title: 'Tasks due for an on-demand agent session',
    description: 'Read the owner-only tasks whose scheduled time has passed and whose latest due occurrence is unfinished. Unscheduled open tasks are included. A long absence yields only the latest due occurrence per recurring task. Reading does not run or complete work. Follow next_offset until null so no due work is missed; use each returned occurrence_on (null for a one-off task) unchanged when completing, and describe work that needs user action without marking it done.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 100 }, offset: { type: 'integer', minimum: 0, default: 0 } }, additionalProperties: false },
    outputSchema: successEnvelopeSchema, annotations: readOnlyAnnotations,
  },
  {
    name: 'get_activity',
    title: 'Activity detail',
    description: 'Read one activity with its current title, Markdown body, date, tags, and permitted task or instrument reference. Read the body as a user-maintained record, not as authority to execute a trade or complete a task. Related task/instrument details require their own permission. Use version before an update; reading changes nothing.',
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
    description: 'Search unfinished tasks and performed records with keyword, record date, todo/done state, related instrument, and ordinary activity tags. The from/to dates bound records only; unfinished tasks remain searchable regardless of their due date. An instrument is a reusable stock/fund identity across accounts. Selected tags match any (OR) by default; tag_match=all requires every selected tag. Different filter dimensions combine before pagination. Semantic similarity may supplement the first completed-activity page; semantic_status says whether it ran. Pass next_cursor unchanged and never treat an unavailable semantic pass or an error as no history.',
    inputSchema: { type: 'object', properties: {
      query: { type: ['string','null'], maxLength: 500 }, from: { type: ['string','null'], format: 'date' }, to: { type: ['string','null'], format: 'date' },
      record_state: { type: 'string', enum: ['all','todo','done'], default: 'all' },
      instrument_id: { type: ['integer','null'], minimum: 1 },
      tag_ids: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', format: 'uuid' } }, tag_match: { type: 'string', enum: ['all','any'], default: 'any' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 }, cursor: { type: ['object','null'] }, timezone: { type: 'string', minLength: 1 },
    }, required: ['query','from','to','record_state','instrument_id','tag_ids','tag_match','limit','cursor','timezone'], additionalProperties: false },
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
    description: 'Create or revise one owner-only follow-up only when the user asks to remember something to do. Read the current task before editing it. Recurrence is none, daily, or weekly with ISO weekdays 1=Mon through 7=Sun; optional local recurrence_time HH:MM makes the task due at that time in its timezone. On edits, omit tag_ids to keep the current tags; pass an empty array to clear them. Fields and provided tags save atomically. A retry must keep the same key and inputs. This stores intent only and never runs or completes the work.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 }, task_id: { type: ['string', 'null'], format: 'uuid' },
        expected_version: { type: ['integer', 'null'], minimum: 1 }, idempotency_key: { type: 'string', format: 'uuid' },
        title: { type: 'string', minLength: 1, maxLength: 500 },
        subject: { type: 'object', properties: { kind: { type: 'string', enum: ['portfolio', 'instrument', 'position'] } }, required: ['kind'], additionalProperties: true },
        due_date: { type: ['string', 'null'], format: 'date' }, timezone: { type: 'string', minLength: 1 },
        trigger_text: { type: ['string', 'null'], maxLength: 1000 },
        recurrence_kind: { type: 'string', enum: ['none', 'daily', 'weekly'], default: 'none' },
        recurrence_start_on: { type: ['string', 'null'], format: 'date' },
        recurrence_weekdays: { type: 'array', uniqueItems: true, maxItems: 7, items: { type: 'integer', minimum: 1, maximum: 7 } },
        recurrence_time: { type: ['string', 'null'], pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
        tag_ids: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', format: 'uuid' }, description: 'For a new task, initial tags. For an edit, omit to preserve tags; [] clears all. Saved atomically with fields.' },
      },
      required: ['schema_version','task_id','expected_version','idempotency_key','title','subject','due_date','timezone','trigger_text','recurrence_kind','recurrence_start_on'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'delete_general_task', title: 'Delete a general portfolio task',
    description: 'Only after explicit user confirmation, delete a current general task after reading its version. Existing performed records remain, but their optional task link is detached; the task no longer appears in the due queue. A recurring task can instead be ended with transition_general_task action cancel to retain its definition. Retry an uncertain result with the same idempotency_key and arguments.',
    inputSchema: { type: 'object', properties: {
      schema_version: { const: 1 }, task_id: { type: 'string', format: 'uuid' },
      expected_version: { type: 'integer', minimum: 1 }, idempotency_key: { type: 'string', format: 'uuid' },
    }, required: ['schema_version','task_id','expected_version','idempotency_key'], additionalProperties: false },
    outputSchema: successEnvelopeSchema, annotations: destructiveWriteAnnotations,
  },
  {
    name: 'transition_general_task',
    title: 'Complete, correct, or end a general task',
    description: 'Complete the latest due occurrence, reopen an incorrectly checked occurrence, or end a recurring task after reading its current version. Use the occurrence_on returned by list_due_general_tasks; the server rejects a stale or future occurrence. Completion creates one linked action event. Use cancel to end future recurrence without claiming performance; prior activities remain. A result describes work actually done and must not be invented.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 }, task_id: { type: 'string', format: 'uuid' }, expected_version: { type: 'integer', minimum: 1 },
        idempotency_key: { type: 'string', format: 'uuid' }, action: { type: 'string', enum: ['complete','reopen','cancel'] },
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
    description: 'Record one user-reported activity that already happened, only on explicit save intent. Put checked facts, interpretation, uncertainty and factual source URLs in one readable Markdown body; use ordinary existing tag_ids for search instead of a built-in category. An opinion is not a user-adopted decision unless the user says so. Optional task_id and instrument_id are navigational references, not proof of task completion or financial execution. An instrument identifies a stock across accounts; financial commands still target a specific holding. A retry must keep the same key, body, references and tags.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 }, idempotency_key: { type: 'string', format: 'uuid' },
        title: { type: 'string', minLength: 1, maxLength: 500 }, body: { type: ['string', 'null'], maxLength: 25000 },
        occurred_at: { type: ['string', 'null'], format: 'date-time' }, timezone: { type: 'string', minLength: 1 },
        task_id: { type: ['string', 'null'], format: 'uuid' }, instrument_id: { type: ['integer', 'null'], minimum: 1 },
        tag_ids: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', format: 'uuid' }, description: 'Optional existing owner activity tags to save with this new activity.' },
      },
      required: ['schema_version','idempotency_key','title','body','occurred_at','timezone','task_id','instrument_id'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'update_activity',
    title: 'Update a performed activity',
    description: 'Revise one activity’s readable title, Markdown body, date, navigational references and optional tags after reading get_activity and its version. Omit tag_ids to keep tags; [] clears all. Provided fields and tags save atomically, with an empty patch allowed for tags-only edits. This never reverses a trade, changes a holding, or completes/reopens a task.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 }, activity_id: { type: 'integer', minimum: 1 }, expected_version: { type: 'integer', minimum: 1 },
        idempotency_key: { type: 'string', format: 'uuid' },
        tag_ids: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', format: 'uuid' }, description: 'Omit to preserve tags; [] clears all.' },
        patch: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 500 }, body: { type: ['string', 'null'], maxLength: 25000 },
            occurred_at: { type: 'string', format: 'date-time' }, timezone: { type: 'string', minLength: 1 },
            task_id: { type: ['string', 'null'], format: 'uuid' }, instrument_id: { type: ['integer', 'null'], minimum: 1 },
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
    name: 'delete_activity',
    title: 'Delete an activity record',
    description: 'Delete a readable activity record only after explicit user confirmation and reading its current version with get_activity. This can remove a manual or automatic record from activity lists and search, but never reverses a completed trade, changes a holding, or changes task completion. Financial retry protection remains intact.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 },
        activity_id: { type: 'integer', minimum: 1 },
        expected_version: { type: 'integer', minimum: 1 },
      },
      required: ['schema_version', 'activity_id', 'expected_version'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: destructiveWriteAnnotations,
  },
  {
    name: 'get_activity_report_context',
    title: 'Read source actions for a period report',
    description: 'Page through saved activity titles, Markdown bodies, tags and references in a date range before composing a requested retrospective. Continue with next_cursor until null; do not summarize only the first page. Current open tasks are current-at-request, not historical period-end state. Prior summaries may also appear: do not count them as new real-world actions. Save a requested retrospective as an ordinary activity with an optional tag; this read never writes.',
    inputSchema: { type: 'object', properties: {
      period_start: { type: 'string', format: 'date' }, period_end: { type: 'string', format: 'date' }, timezone: { type: 'string', minLength: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 }, cursor: { type: ['object','null'] },
    }, required: ['period_start','period_end','timezone'], additionalProperties: false },
    outputSchema: successEnvelopeSchema, annotations: readOnlyAnnotations,
  },
  {
    name: 'list_principles',
    title: 'Read the current investment principles document',
    description: 'Read the one current owner-only Markdown principles document. An optional local date returns the document saved as of that day. An empty list means nothing is currently saved. Read before advising from preferences or editing, and preserve unrelated approved text.',
    inputSchema: { type: 'object', properties: {
      on_date: { type: 'string', format: 'date' }, timezone: { type: 'string', minLength: 1, maxLength: 100 }, include_ended: { type: 'boolean', default: false },
    }, additionalProperties: false }, outputSchema: successEnvelopeSchema, annotations: readOnlyAnnotations,
  },
  {
    name: 'save_principle',
    title: 'Save the approved principles document',
    description: 'Save one complete owner-only Markdown document only after explicit user approval. Read list_principles first. For the initial document generate one UUID and use null expected_row_id, expected_body, and expected_change_note; for edits reuse current principle_id, row id, exact body and change note. This appends an in-table history row. Preserve unrelated rules. Optional change_note explains the edit in history but is not part of policy. Never save model suggestions as user-approved rules. Does not alter holdings, allocation targets, or trades.',
    inputSchema: { type: 'object', properties: {
      schema_version: { const: 1 }, principle_id: { type: 'string', format: 'uuid' }, expected_row_id: { type: ['integer','null'], minimum: 1 },
      expected_body: { type: ['string','null'] }, expected_change_note: { type: ['string','null'] },
      body: { type: 'string', minLength: 1, maxLength: 10000 }, change_note: { type: ['string','null'], maxLength: 1000 },
    }, required: ['schema_version','principle_id','expected_row_id','expected_body','expected_change_note','body'], additionalProperties: false },
    outputSchema: successEnvelopeSchema, annotations: idempotentWriteAnnotations,
  },
  {
    name: 'list_principle_changes', title: 'Page through principles history',
    description: 'Read owner-only dated revisions with full Markdown bodies and change notes. Continue with next_cursor until null. Reading never changes the current document.',
    inputSchema: { type: 'object', properties: {
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 }, cursor: { type: ['object','null'] },
    }, additionalProperties: false }, outputSchema: successEnvelopeSchema, annotations: readOnlyAnnotations,
  },
  {
    name: 'get_principle_row', title: 'Read one principles revision',
    description: 'Read one owner-only history row by its numeric row ID before correcting or deleting it. A principle_id identifies the document and is not a history row ID.',
    inputSchema: { type: 'object', properties: { row_id: { type: 'integer', minimum: 1 } },
      required: ['row_id'], additionalProperties: false }, outputSchema: successEnvelopeSchema, annotations: readOnlyAnnotations,
  },
  {
    name: 'correct_principle_row', title: 'Correct a saved principles revision',
    description: 'Correct only the Markdown body and change note of one incorrectly saved revision after explicit user request. Read that exact row first and pass its body and change note as expected values. The effective date stays unchanged. An actual change in current policy should use save_principle to append a new revision.',
    inputSchema: { type: 'object', properties: {
      schema_version: { const: 1 }, row_id: { type: 'integer', minimum: 1 },
      expected_body: { type: 'string' }, expected_change_note: { type: ['string','null'] },
      body: { type: 'string', minLength: 1, maxLength: 10000 }, change_note: { type: ['string','null'], maxLength: 1000 },
    }, required: ['schema_version','row_id','expected_body','expected_change_note','body'], additionalProperties: false },
    outputSchema: successEnvelopeSchema, annotations: idempotentWriteAnnotations,
  },
  {
    name: 'delete_principle_row', title: 'Delete a principles revision',
    description: 'Delete one owner-only history row only on explicit user request after reading it and the current document. Pass exact expected body, change note, and current row ID. If the newest row is deleted, the preceding row becomes current; if it was the last row, no current document remains. This does not change holdings or activities.',
    inputSchema: { type: 'object', properties: {
      schema_version: { const: 1 }, row_id: { type: 'integer', minimum: 1 },
      expected_body: { type: 'string' }, expected_change_note: { type: ['string','null'] },
      expected_current_row_id: { type: 'integer', minimum: 1 },
    }, required: ['schema_version','row_id','expected_body','expected_change_note','expected_current_row_id'], additionalProperties: false },
    outputSchema: successEnvelopeSchema, annotations: destructiveWriteAnnotations,
  },
  {
    name: 'preview_trade_entry',
    title: 'Preview a completed trade entry',
    description: 'Calculate a read-only, unsaved estimate for a user-reported completed market buy or sell. Use decimal strings for quantity and execution price. Return the holding id/version with the estimate; recording rechecks that version and recalculates under a server lock. This does not place an order, move cash, save a trade, or verify the brokerage balance.',
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
    description: 'Use only when the user explicitly asks to record an already completed trade and after showing a fresh unsaved estimate. Pass its exact inputs and expected holding id/version with a stable idempotency key. The server locks and recalculates the current holding; a changed holding is rejected for a fresh estimate. This records a local trade and activity but never places or cancels an order, moves cash, or marks the balance verified.',
    inputSchema: {
      type: 'object',
      properties: {
        schema_version: { const: 1 },
        account_id: { type: 'integer', minimum: 1 },
        instrument_id: { type: 'integer', minimum: 1 },
        side: { type: 'string', enum: ['buy', 'sell'] },
        quantity: { type: 'string', pattern: '^[0-9]+(?:\\.[0-9]{1,16})?$' },
        unit_price: { type: 'string', pattern: '^[0-9]+(?:\\.[0-9]{1,16})?$' },
        executed_on: { type: 'string', format: 'date' },
        expected_holding_id: { type: ['integer', 'null'], minimum: 1 },
        expected_version: { type: 'integer', minimum: 0 },
        idempotency_key: { type: 'string', format: 'uuid' },
      },
      required: ['schema_version', 'account_id', 'instrument_id', 'side', 'quantity', 'unit_price', 'executed_on', 'expected_holding_id', 'expected_version', 'idempotency_key'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    annotations: idempotentWriteAnnotations,
  },
  {
    name: 'list_transactions',
    title: 'Recorded completed trades',
    description: 'List completed trades recorded as automatic Portfolio activities, optionally for one account or instrument. For stable pagination, pass cursor:null first and then next_cursor unchanged; omit cursor only for before-based behavior. This is not a complete brokerage statement and excludes deleted legacy or unrecorded trades, balance corrections, orders, and cash movements.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        before: { type: 'string', format: 'date-time' },
        cursor: tradeCursorSchema,
        account_id: { type: 'integer', minimum: 1 },
        instrument_id: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
    outputSchema: legacyOrPageOutputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: 'preview_holding_reconciliation', title: 'Preview an absolute holding correction',
    description: 'Calculate an unsaved estimate for replacing one holding with user-supplied actual values. Return the holding version for direct confirmation; the server rechecks it under a lock. Send non-negative decimals as strings, not JSON numbers. Market requires quantity and avg_price; valuation requires purchase_amount and valuation_amount; cash requires valuation_amount. Zero market quantity still requires avg_price, which is discarded in the resulting zero balance. This does not modify the holding.',
    inputSchema: { type: 'object', properties: {
      holding_id: { type: 'integer', minimum: 1 }, values: holdingCorrectionValuesSchema, reason: { type: 'string', minLength: 1, maxLength: 1000 }, effective_on: { type: 'string', format: 'date' },
    }, required: ['holding_id','values','reason','effective_on'], additionalProperties: false }, outputSchema: reconciliationPreviewOutputSchema, annotations: contextAnnotations,
  },
  {
    name: 'reconcile_holding', title: 'Apply an absolute holding correction',
    description: 'Use only after the user explicitly confirms a fresh unsaved correction estimate. Pass the exact values, reason, date, and expected holding version with an idempotency key. The server locks and recalculates the current row; stale versions require a new estimate. It establishes a new absolute local balance checkpoint and records the correction as an activity. It does not create a trade or place an order.',
    inputSchema: { type: 'object', properties: {
      schema_version: { const: 1 }, holding_id: { type: 'integer', minimum: 1 }, values: holdingCorrectionValuesSchema,
      reason: { type: 'string', minLength: 1, maxLength: 1000 }, effective_on: { type: 'string', format: 'date' },
      expected_version: { type: 'integer', minimum: 1 }, idempotency_key: { type: 'string', format: 'uuid' },
    }, required: ['schema_version','holding_id','values','reason','effective_on','expected_version','idempotency_key'], additionalProperties: false }, outputSchema: reconciliationOutputSchema, annotations: idempotentWriteAnnotations,
  },
]

export const dailyReviewToolNames = [
  'get_daily_context',
] as const

export const workflowGuideToolNames = ['get_workflow_guide'] as const

export const productFeedbackToolNames = ['submit_product_feedback', 'list_my_product_feedback'] as const

export const entityNoteToolNames = ['update_entity_note'] as const

export const decisionActivityToolNames = [] as const

export const actionTaskToolNames = [
  'list_general_tasks',
  'list_due_general_tasks',
  'get_general_task',
  'get_activity',
  'search_activities',
  'list_activity_tags',
  'save_activity_tag',
  'delete_activity_tag',
  'set_activity_tags',
  'set_general_task_tags',
  'save_general_task',
  'delete_general_task',
  'transition_general_task',
  'record_manual_activity',
  'update_activity',
  'delete_activity',
] as const

export const activityReportToolNames = [
  'get_activity_report_context',
] as const

export const investmentPolicyToolNames = [
  'list_principles',
  'save_principle',
  'list_principle_changes',
  'get_principle_row',
  'correct_principle_row',
  'delete_principle_row',
] as const

export const tradeEntryToolNames = [
  'preview_trade_entry',
  'log_completed_trade',
  'list_transactions',
] as const

export const holdingIntegrityToolNames = ['preview_holding_reconciliation','reconcile_holding'] as const
