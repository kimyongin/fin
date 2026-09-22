import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { pipeline } from 'npm:@supabase/middleware@^0.5.0'
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@^1.7.0'
import {
  dailyReviewToolNames, decisionTaskToolNames, entityNoteToolNames, holdingIntegrityToolNames, holdingThesisToolNames,
  investmentPolicyToolNames, operatingRuleToolNames, portfolioToolDefinitions, todoBundleToolNames, tradeEntryToolNames, tradeReversalToolNames,
  productFeedbackToolNames, workflowGuideToolNames,
} from '../_shared/mcp/portfolio-tools.ts'
import { classifyPortfolioError, PortfolioRpcError } from '../_shared/mcp/errors.ts'
import { type ToolHandler, validateToolRegistry } from '../_shared/mcp/registry.ts'
import { getWorkflowGuide, renderWorkflowGuideMarkdown, validateWorkflowGuides } from '../_shared/mcp/workflow-guides.ts'

type JsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

const protocolVersion = '2025-06-18'
const oauthSecurity = [{ type: 'oauth2', scopes: ['openid', 'email', 'profile'] }]
const serverInstructions = [
  'Portfolio remembers, calculates, and validates investment records; it never executes brokerage orders or transfers funds.',
  'Use authenticated portfolio tools for quantities, average costs, strategy, saved news, and activity instead of guessing.',
  'Use ChatGPT web research for current news, clearly separate sourced facts from analysis, and do not claim that Portfolio fetched live news.',
  'A review request is not permission to write: save only when the user explicitly asks, and keep model suggestions, user decisions, plans, completed trades, and brokerage balance verification distinct.',
  'Do not invent missing preferences or holding reasons, and do not report no meaningful change when research was incomplete.',
  'Before a multi-step Portfolio task, use get_workflow_guide when its advertised topic matches the user\'s request; do not repeat the same revision in one conversation.',
  'Report a write as saved only after its tool returns success; retry a lost response with the same idempotency key and re-read after a version conflict.',
  'Treat feedback about the Portfolio product separately from investment records: explicit clear registration requests may be saved directly, while an agent-initiated suggestion requires one user confirmation and must never include transcripts, portfolio data, credentials, or guessed causes.',
  'Use one ToDo bundle for several user-meaningful results or follow-ups only when the user asks to record them; analysis alone creates nothing, linked tasks remain authoritative, and a failed bundle save never justifies repeating a successful financial write.',
].join(' ')
const dailyReviewResourceUri = 'portfolio://guide/daily-review'
const dailyReviewGuide = renderWorkflowGuideMarkdown('daily_review')
const toolDefinitions = portfolioToolDefinitions.map((definition) => ({
  ...definition,
  securitySchemes: oauthSecurity,
}))

const promptDefinitions = [
  {
    name: 'daily_portfolio_review',
    title: 'Daily portfolio review',
    description: 'Start a concise daily review using the authenticated portfolio, strategy, saved news, and recent activity.',
    arguments: [],
  },
]

const resourceDefinitions = [
  {
    uri: dailyReviewResourceUri,
    name: 'daily-portfolio-review-guide',
    title: 'Daily portfolio review guide',
    description: 'Workflow and responsibility boundaries for a daily portfolio review.',
    mimeType: 'text/markdown',
  },
]

function jsonRpcResult(id: JsonRpcRequest['id'], result: unknown) {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, result })
}

function jsonRpcError(id: JsonRpcRequest['id'], code: number, message: string) {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
}

function toolResult(value: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value && typeof value === 'object' ? value : { value },
    isError: false,
  }
}

function toolErrorResult(error: { code: string; message: string; retryable: boolean; action: string }, requestId: string) {
  const value = { ok: false, error: { ...error, request_id: requestId } }
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    isError: true,
  }
}

class ToolInputError extends Error {}

function requireSchemaVersion(args: Record<string, unknown>) {
  if (args.schema_version !== 1) throw new ToolInputError('schema_version must be 1')
}

function requireString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(`${field} is required`)
  }
  return value.trim()
}

function requireUuid(value: unknown, field: string) {
  const normalized = requireString(value, field)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new ToolInputError(`${field} must be a UUID`)
  }
  return normalized
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolInputError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new ToolInputError(`${field} must be an array`)
  return value
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function cursorPage(args: Record<string, unknown>) {
  const enabled = Object.prototype.hasOwnProperty.call(args, 'cursor')
  if (enabled && args.before != null) throw new ToolInputError('cursor and before cannot be used together')
  return { enabled, value: args.cursor == null ? null : requireRecord(args.cursor, 'cursor') }
}

function normalizeBriefingItems(value: unknown, field: string) {
  return requireArray(value, field).map((item, index) => {
    if (typeof item === 'string') return { summary: requireString(item, `${field}[${index}]`) }
    const record = requireRecord(item, `${field}[${index}]`)
    const summary = optionalString(record.summary) ?? optionalString(record.title) ?? optionalString(record.body)
    if (!summary) throw new ToolInputError(`${field}[${index}] needs summary, title, or body`)
    return {
      ...record,
      summary,
    }
  })
}

function normalizeDailyBriefingPayload(args: Record<string, unknown>) {
  requireSchemaVersion(args)
  const briefing = requireRecord(args.briefing, 'briefing')
  const decisionIds = Array.isArray(briefing.decision_ids) ? briefing.decision_ids : []
  const taskIds = Array.isArray(briefing.task_ids) ? briefing.task_ids : []
  if (decisionIds.length > 0 || taskIds.length > 0) {
    throw new ToolInputError('decision_ids and task_ids are not supported in schema version 1')
  }

  const evidence = requireArray(args.evidence, 'evidence').map((value, index) => {
    const item = requireRecord(value, `evidence[${index}]`)
    const summary = requireString(item.fact_summary, `evidence[${index}].fact_summary`)
    return {
      evidence_key: requireString(item.local_key, `evidence[${index}].local_key`),
      title: requireString(item.source_title, `evidence[${index}].source_title`),
      source_name: optionalString(item.source_name),
      source_url: requireString(item.source_url, `evidence[${index}].source_url`),
      published_at: optionalString(item.published_at),
      accessed_at: requireString(item.checked_at, `evidence[${index}].checked_at`),
      summary,
      facts: Array.isArray(item.facts) ? item.facts : [summary],
    }
  })

  const scopes = requireArray(args.scopes, 'scopes').map((value, index) => {
    const item = requireRecord(value, `scopes[${index}]`)
    const subject = requireRecord(item.subject, `scopes[${index}].subject`)
    return {
      scope_key: requireString(item.local_key, `scopes[${index}].local_key`),
      subject_kind: requireString(subject.kind, `scopes[${index}].subject.kind`),
      subject_ref: optionalString(subject.ref),
      window_from: requireString(item.window_from, `scopes[${index}].window_from`),
      window_to: requireString(item.window_to, `scopes[${index}].window_to`),
      coverage: requireString(item.coverage, `scopes[${index}].coverage`),
      reason: optionalString(item.reason),
      checked_at: requireString(item.checked_at, `scopes[${index}].checked_at`),
      evidence_keys: requireArray(item.evidence_keys, `scopes[${index}].evidence_keys`),
      checked_sources: requireArray(item.checked_sources, `scopes[${index}].checked_sources`),
    }
  })

  return {
    status: requireString(briefing.status, 'briefing.status'),
    headline: requireString(briefing.headline, 'briefing.headline'),
    changes: normalizeBriefingItems(briefing.changes, 'briefing.changes'),
    uncertainties: normalizeBriefingItems(briefing.uncertainties, 'briefing.uncertainties'),
    evidence,
    scopes,
    ...(optionalString(args.supersedes_briefing_id)
      ? { supersedes_id: requireUuid(args.supersedes_briefing_id, 'supersedes_briefing_id') }
      : {}),
  }
}

function normalizeLifecycleSubject(value: unknown, field: string) {
  const subject = requireRecord(value, field)
  const kind = requireString(subject.kind, `${field}.kind`)
  if (!['portfolio', 'instrument', 'position'].includes(kind)) {
    throw new ToolInputError(`${field}.kind is invalid`)
  }
  const instrumentId = optionalString(subject.instrument_id)
  const accountId = optionalString(subject.account_id)
  if (kind !== 'portfolio' && !instrumentId) {
    throw new ToolInputError(`${field}.instrument_id is required`)
  }
  if (kind === 'position' && !accountId) {
    throw new ToolInputError(`${field}.account_id is required`)
  }
  return {
    kind,
    ...(instrumentId ? { instrument_id: instrumentId } : {}),
    ...(accountId ? { account_id: accountId } : {}),
    ...(optionalString(subject.label) ? { label: optionalString(subject.label) } : {}),
  }
}

function normalizeInvestmentDecisionPayload(args: Record<string, unknown>) {
  requireSchemaVersion(args)
  const status = requireString(args.status, 'status')
  if (!['proposed', 'adopted'].includes(status)) throw new ToolInputError('status is invalid')
  const selectedOption = optionalString(args.selected_option)
  const reason = optionalString(args.reason)
  if (status === 'adopted' && (!selectedOption || !reason)) {
    throw new ToolInputError('adopted decision needs selected_option and reason')
  }
  const options = requireArray(args.options, 'options').map((value, index) =>
    requireString(value, `options[${index}]`)
  )
  const tasks = requireArray(args.follow_up_tasks, 'follow_up_tasks').map((value, index) => {
    const task = requireRecord(value, `follow_up_tasks[${index}]`)
    return {
      title: requireString(task.title, `follow_up_tasks[${index}].title`),
      subject: normalizeLifecycleSubject(task.subject, `follow_up_tasks[${index}].subject`),
      ...(optionalString(task.due_date) ? { due_date: optionalString(task.due_date) } : {}),
      ...(optionalString(task.trigger_text) ? { trigger_text: optionalString(task.trigger_text) } : {}),
    }
  })
  const policySnapshot = args.policy_snapshot == null
    ? {}
    : requireRecord(args.policy_snapshot, 'policy_snapshot')
  return {
    status,
    subject: normalizeLifecycleSubject(args.subject, 'subject'),
    question: requireString(args.question, 'question'),
    options,
    ...(selectedOption ? { selected_option: selectedOption } : {}),
    ...(reason ? { reason } : {}),
    ...(optionalString(args.uncertainty) ? { uncertainty: optionalString(args.uncertainty) } : {}),
    ...(optionalString(args.review_condition) ? { review_condition: optionalString(args.review_condition) } : {}),
    policy_snapshot: policySnapshot,
    ...(optionalString(args.source_briefing_id)
      ? { source_briefing_id: requireUuid(args.source_briefing_id, 'source_briefing_id') }
      : {}),
    timezone: requireString(args.timezone, 'timezone'),
    authored_via: 'agent',
    follow_up_tasks: tasks,
  }
}

function requirePositiveInteger(value: unknown, field: string) {
  const normalized = Number(value)
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new ToolInputError(`${field} must be a positive integer`)
  }
  return normalized
}

function requirePositiveDecimalString(value: unknown, field: string) {
  const normalized = requireString(value, field)
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,16})?$/.test(normalized) || Number(normalized) <= 0) {
    throw new ToolInputError(`${field} must be a positive decimal string with at most 16 decimal places`)
  }
  return normalized
}

function normalizeDecisionTransitionPayload(args: Record<string, unknown>) {
  requireSchemaVersion(args)
  const action = requireString(args.action, 'action')
  if (!['adopt', 'dismiss'].includes(action)) throw new ToolInputError('action is invalid')
  const reason = requireString(args.reason, 'reason')
  const selectedOption = optionalString(args.selected_option)
  if (action === 'adopt' && !selectedOption) {
    throw new ToolInputError('adopting a decision needs selected_option')
  }
  return {
    action,
    reason,
    ...(selectedOption ? { selected_option: selectedOption } : {}),
    authored_via: 'agent',
  }
}

function normalizeTaskTransitionPayload(args: Record<string, unknown>) {
  requireSchemaVersion(args)
  const action = requireString(args.action, 'action')
  if (!['wait', 'resolve', 'reopen', 'pause', 'resume', 'close'].includes(action)) {
    throw new ToolInputError('action is invalid')
  }
  const evidence = requireArray(args.evidence, 'evidence').map((value, index) => {
    const item = requireRecord(value, `evidence[${index}]`)
    return {
      title: requireString(item.title, `evidence[${index}].title`),
      source_url: requireString(item.source_url, `evidence[${index}].source_url`),
      summary: requireString(item.summary, `evidence[${index}].summary`),
      checked_at: requireString(item.checked_at, `evidence[${index}].checked_at`),
    }
  })
  const answer = optionalString(args.answer)
  const reason = optionalString(args.reason)
  if (action === 'resolve' && (!answer || evidence.length === 0)) {
    throw new ToolInputError('resolving a task needs an answer and evidence')
  }
  if (action === 'reopen' && (!reason || evidence.length === 0)) {
    throw new ToolInputError('reopening a task needs a reason and new evidence')
  }
  if (action === 'close' && !reason) throw new ToolInputError('closing a task needs a reason')
  return {
    action,
    ...(answer ? { answer } : {}),
    ...(reason ? { reason } : {}),
    evidence,
    authored_via: 'agent',
  }
}

function normalizeInvestmentPolicyPatch(value: unknown) {
  const patch = requireRecord(value, 'patch')
  const allowedTextFields = [
    'raw_text',
    'goal_text',
    'horizon_text',
    'liquidity_need_text',
    'risk_tolerance_text',
    'trading_preference_text',
  ]
  const normalized: Record<string, unknown> = {}
  for (const field of allowedTextFields) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue
    normalized[field] = patch[field] === null ? null : requireString(patch[field], `patch.${field}`)
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'restrictions')) {
    normalized.restrictions = requireArray(patch.restrictions, 'patch.restrictions').map((value, index) => {
      const restriction = requireRecord(value, `patch.restrictions[${index}]`)
      const kind = requireString(restriction.kind, `patch.restrictions[${index}].kind`)
      if (!['preference', 'prohibition'].includes(kind)) {
        throw new ToolInputError(`patch.restrictions[${index}].kind is invalid`)
      }
      return {
        kind,
        text: requireString(restriction.text, `patch.restrictions[${index}].text`),
      }
    })
  }
  const unknownFields = Object.keys(patch).filter((field) =>
    !allowedTextFields.includes(field) && field !== 'restrictions'
  )
  if (unknownFields.length > 0) throw new ToolInputError('patch contains an unknown field')
  if (Object.keys(normalized).length === 0) throw new ToolInputError('patch must not be empty')
  return normalized
}

function normalizeHoldingThesisPatch(value: unknown) {
  const patch = requireRecord(value, 'patch')
  const textFields = ['reason_text', 'horizon_text', 'review_condition_text']
  const normalized: Record<string, unknown> = {}
  for (const field of textFields) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue
    normalized[field] = patch[field] === null ? null : requireString(patch[field], `patch.${field}`)
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'next_review_date')) {
    normalized.next_review_date = patch.next_review_date === null
      ? null
      : requireString(patch.next_review_date, 'patch.next_review_date')
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'related_decision_id')) {
    normalized.related_decision_id = patch.related_decision_id === null
      ? null
      : requireUuid(patch.related_decision_id, 'patch.related_decision_id')
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'is_active')) {
    if (typeof patch.is_active !== 'boolean') throw new ToolInputError('patch.is_active must be a boolean')
    normalized.is_active = patch.is_active
  }
  const allowedFields = [...textFields, 'next_review_date', 'related_decision_id', 'is_active']
  if (Object.keys(patch).some((field) => !allowedFields.includes(field))) {
    throw new ToolInputError('patch contains an unknown field')
  }
  if (Object.keys(normalized).length === 0) throw new ToolInputError('patch must not be empty')
  return normalized
}

async function rpc(supabase: any, name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new PortfolioRpcError(error)
  return data
}

const toolHandlers: Record<string, ToolHandler> = {
  async get_workflow_guide(_supabase, args) {
    const topic = requireString(args.topic, 'topic')
    const guide = getWorkflowGuide(topic)
    if (!guide) throw new ToolInputError(`Unsupported workflow guide topic: ${topic}`)
    return { ok: true, data: guide }
  },
  async get_profile(supabase) {
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) throw new Error(error?.message ?? 'Authenticated user not found')
    return {
      id: data.user.id,
      ...(data.user.user_metadata?.full_name ? { name: String(data.user.user_metadata.full_name) } : {}),
      ...(data.user.email ? { email: data.user.email } : {}),
      nickname: 'Portfolio account',
    }
  },
  async get_portfolio_state(supabase) {
    return await rpc(supabase, 'app_get_portfolio_state', { input_owner_user_id: null })
  },
  async find_holdings(supabase, args) {
    return await rpc(supabase, 'app_find_holdings', { input_query: String(args.query ?? '') })
  },
  async update_entity_note(supabase, args) {
    requireSchemaVersion(args)
    const entityType = requireString(args.entity_type, 'entity_type')
    if (!['account', 'instrument', 'holding'].includes(entityType)) throw new ToolInputError('entity_type must be account, instrument, or holding')
    return { ok: true, data: await rpc(supabase, 'app_update_entity_note', {
      input_entity_type: entityType,
      input_entity_id: requirePositiveInteger(args.entity_id, 'entity_id'),
      input_expected_note: args.expected_note == null ? null : requireString(args.expected_note, 'expected_note'),
      input_note: args.note == null ? null : requireString(args.note, 'note'),
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
      input_source: 'agent',
    }) }
  },
  async get_strategy_state(supabase) {
    return await rpc(supabase, 'app_get_strategy_state', { input_owner_user_id: null })
  },
  async get_news_state(supabase) {
    return await rpc(supabase, 'app_get_news_state', { input_owner_user_id: null })
  },
  async list_recent_activity(supabase, args) {
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100)
    return await rpc(supabase, 'app_list_recent_activity', { limit_count: limit })
  },
  async submit_product_feedback(supabase, args) {
    requireSchemaVersion(args)
    const context = args.context == null ? {} : requireRecord(args.context, 'context')
    const allowedContext = new Set(['page_key', 'app_version', 'tool_name', 'error_code', 'request_id'])
    for (const [key, value] of Object.entries(context)) {
      if (!allowedContext.has(key)) throw new ToolInputError(`context.${key} is not supported`)
      if (value !== null && (typeof value !== 'string' || value.length > 200)) {
        throw new ToolInputError(`context.${key} must be a string of at most 200 characters or null`)
      }
    }
    const body = requireString(args.body, 'body')
    if (body.length > 4000) throw new ToolInputError('body must be at most 4000 characters')
    const data = await rpc(supabase, 'app_submit_product_feedback', {
      input_body: body,
      input_context: context,
      input_source: 'mcp',
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
    })
    return { ok: true, data }
  },
  async list_my_product_feedback(supabase, args) {
    const data = await rpc(supabase, 'app_list_my_product_feedback', {
      input_cursor: args.cursor == null ? null : requireRecord(args.cursor, 'cursor'),
      input_limit: Math.min(Math.max(Number(args.limit) || 20, 1), 50),
    })
    return { ok: true, data }
  },
  async get_daily_context(supabase, args) {
    requireSchemaVersion(args)
    const timezone = requireString(args.timezone, 'timezone')
    const subjectTickers = args.subject_tickers == null
      ? null
      : requireArray(args.subject_tickers, 'subject_tickers').map((value, index) =>
        requireString(value, `subject_tickers[${index}]`)
      )
    const data = await rpc(supabase, 'app_create_daily_context', {
      input_timezone: timezone,
      input_subject_tickers: subjectTickers,
    })
    return { ok: true, data }
  },
  async save_daily_briefing(supabase, args) {
    const data = await rpc(supabase, 'app_save_daily_briefing', {
      input_context_id: requireUuid(args.context_id, 'context_id'),
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
      input_payload: normalizeDailyBriefingPayload(args),
    })
    return { ok: true, data }
  },
  async list_daily_briefings(supabase, args) {
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50)
    const page = cursorPage(args)
    const data = page.enabled
      ? await rpc(supabase, 'app_list_daily_briefing_page', {
          input_owner_user_id: null, input_limit: limit, input_cursor: page.value,
        })
      : await rpc(supabase, 'app_list_daily_briefings', {
          input_limit: limit, input_before: optionalString(args.before) ?? null,
        })
    return { ok: true, data }
  },
  async get_daily_briefing(supabase, args) {
    const data = await rpc(supabase, 'app_get_daily_briefing', {
      input_briefing_id: requireUuid(args.briefing_id, 'briefing_id'),
    })
    if (data == null) throw new Error('Briefing was not found or is not accessible')
    return { ok: true, data }
  },
  async record_investment_decision(supabase, args) {
    const data = await rpc(supabase, 'app_record_investment_decision', {
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
      input_payload: normalizeInvestmentDecisionPayload(args),
    })
    return { ok: true, data }
  },
  async list_investment_decisions(supabase, args) {
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50)
    const page = cursorPage(args)
    const data = page.enabled
      ? await rpc(supabase, 'app_list_investment_decision_page', {
          input_owner_user_id: null, input_filter: optionalString(args.filter) ?? 'current',
          input_limit: limit, input_cursor: page.value,
        })
      : await rpc(supabase, 'app_list_investment_decisions', {
          input_limit: limit, input_before: optionalString(args.before) ?? null,
        })
    return { ok: true, data }
  },
  async get_investment_decision(supabase, args) {
    const data = await rpc(supabase, 'app_get_investment_decision', {
      input_decision_id: requireUuid(args.decision_id, 'decision_id'),
    })
    if (data == null) throw new Error('Decision was not found or is not accessible')
    return { ok: true, data }
  },
  async list_tasks(supabase, args) {
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50)
    const page = cursorPage(args)
    const data = page.enabled
      ? await rpc(supabase, 'app_list_portfolio_task_page', {
          input_owner_user_id: null, input_filter: optionalString(args.filter) ?? 'active',
          input_limit: limit, input_cursor: page.value,
        })
      : await rpc(supabase, 'app_list_portfolio_tasks', {
          input_state: optionalString(args.state) ?? null,
          input_limit: limit, input_before: optionalString(args.before) ?? null,
        })
    return { ok: true, data }
  },
  async get_task(supabase, args) {
    const data = await rpc(supabase, 'app_get_portfolio_task', {
      input_task_id: requireUuid(args.task_id, 'task_id'),
    })
    if (data == null) throw new Error('Task was not found or is not accessible')
    return { ok: true, data }
  },
  async transition_investment_decision(supabase, args) {
    const data = await rpc(supabase, 'app_transition_investment_decision', {
      input_decision_id: requireUuid(args.decision_id, 'decision_id'),
      input_expected_version: requirePositiveInteger(args.expected_version, 'expected_version'),
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
      input_payload: normalizeDecisionTransitionPayload(args),
    })
    return { ok: true, data }
  },
  async transition_task(supabase, args) {
    const data = await rpc(supabase, 'app_transition_portfolio_task', {
      input_task_id: requireUuid(args.task_id, 'task_id'),
      input_expected_version: requirePositiveInteger(args.expected_version, 'expected_version'),
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
      input_payload: normalizeTaskTransitionPayload(args),
    })
    return { ok: true, data }
  },
  async save_execution_task(supabase, args) {
    requireSchemaVersion(args)
    const taskId = args.task_id == null ? null : requireUuid(args.task_id, 'task_id')
    const expectedVersion = args.expected_version == null ? null : requirePositiveInteger(args.expected_version, 'expected_version')
    if ((taskId == null) !== (expectedVersion == null)) throw new ToolInputError('task_id and expected_version must both be set for an update')
    const side = requireString(args.side, 'side')
    if (!['buy', 'sell'].includes(side)) throw new ToolInputError('side is invalid')
    const data = await rpc(supabase, 'app_save_execution_task', {
      input_expected_version: expectedVersion,
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
      input_payload: {
        ...(taskId ? { task_id: taskId } : {}), title: requireString(args.title, 'title'),
        account_id: requirePositiveInteger(args.account_id, 'account_id'), instrument_id: requirePositiveInteger(args.instrument_id, 'instrument_id'),
        side, target_quantity: requirePositiveDecimalString(args.target_quantity, 'target_quantity'), timezone: requireString(args.timezone, 'timezone'),
        ...(optionalString(args.due_date) ? { due_date: optionalString(args.due_date) } : {}),
        ...(optionalString(args.trigger_text) ? { trigger_text: optionalString(args.trigger_text) } : {}),
        ...(optionalString(args.change_reason) ? { change_reason: optionalString(args.change_reason) } : {}), authored_via: 'agent',
      },
    })
    return { ok: true, data }
  },
  async link_trade_to_task(supabase, args) {
    requireSchemaVersion(args)
    const data = await rpc(supabase, 'app_link_trade_to_task', {
      input_trade_entry_id: requireUuid(args.trade_id, 'trade_id'), input_task_id: requireUuid(args.task_id, 'task_id'),
      input_expected_task_version: requirePositiveInteger(args.expected_task_version, 'expected_task_version'),
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'), input_authored_via: 'agent',
    })
    return { ok: true, data }
  },
  async transition_execution_task(supabase, args) {
    requireSchemaVersion(args)
    const action = requireString(args.action, 'action')
    if (!['pause','resume','cancel'].includes(action)) throw new ToolInputError('action is invalid')
    const data = await rpc(supabase, 'app_transition_execution_task', {
      input_task_id: requireUuid(args.task_id, 'task_id'), input_expected_version: requirePositiveInteger(args.expected_version, 'expected_version'),
      input_action: action, input_reason: requireString(args.reason, 'reason'), input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'), input_authored_via: 'agent',
    })
    return { ok: true, data }
  },
  async get_investment_policy(supabase) {
    const data = await rpc(supabase, 'app_get_investment_policy')
    return { ok: true, data }
  },
  async save_investment_policy(supabase, args) {
    requireSchemaVersion(args)
    const expectedVersion = args.expected_version === null
      ? null
      : requirePositiveInteger(args.expected_version, 'expected_version')
    const data = await rpc(supabase, 'app_save_investment_policy', {
      input_expected_version: expectedVersion,
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
      input_patch: normalizeInvestmentPolicyPatch(args.patch),
      input_change_reason: requireString(args.change_reason, 'change_reason'),
      input_authored_via: 'agent',
    })
    return { ok: true, data }
  },
  async list_operating_rules(supabase, args) {
    const data = await rpc(supabase, 'app_list_operating_rules', {
      input_workflow_key: requireString(args.workflow_key, 'workflow_key'),
      input_include_archived: args.include_archived === true,
    })
    return { ok: true, data }
  },
  async save_operating_rule(supabase, args) {
    requireSchemaVersion(args)
    const data = await rpc(supabase, 'app_save_operating_rule', {
      input_rule_id: args.rule_id == null ? null : requireUuid(args.rule_id, 'rule_id'),
      input_expected_version: args.expected_version == null ? null : requirePositiveInteger(args.expected_version, 'expected_version'),
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
      input_title: requireString(args.title, 'title'),
      input_workflow_key: requireString(args.workflow_key, 'workflow_key'),
      input_applicability: requireString(args.applicability, 'applicability'),
      input_body: requireString(args.body, 'body'),
      input_change_reason: requireString(args.change_reason, 'change_reason'),
      input_authored_via: 'agent',
    })
    return { ok: true, data }
  },
  async archive_operating_rule(supabase, args) {
    requireSchemaVersion(args)
    const data = await rpc(supabase, 'app_archive_operating_rule', {
      input_rule_id: requireUuid(args.rule_id, 'rule_id'),
      input_expected_version: requirePositiveInteger(args.expected_version, 'expected_version'),
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
      input_reason: requireString(args.reason, 'reason'),
      input_authored_via: 'agent',
    })
    return { ok: true, data }
  },
  async list_todo_bundles(supabase, args) {
    const data = await rpc(supabase, 'app_list_todo_bundles', {
      input_filter: optionalString(args.filter) ?? 'active',
      input_limit: args.limit == null ? 20 : requirePositiveInteger(args.limit, 'limit'),
      input_cursor: args.cursor ?? null,
    })
    return { ok: true, data }
  },
  async get_todo_bundle(supabase, args) {
    const data = await rpc(supabase, 'app_get_todo_bundle', { input_bundle_id: requireUuid(args.bundle_id, 'bundle_id') })
    if (!data) throw new PortfolioRpcError({ message: 'ToDo bundle not found' })
    return { ok: true, data }
  },
  async save_todo_bundle(supabase, args) {
    requireSchemaVersion(args)
    const data = await rpc(supabase, 'app_save_todo_bundle', {
      input_bundle_id: args.bundle_id == null ? null : requireUuid(args.bundle_id, 'bundle_id'),
      input_expected_version: args.expected_version == null ? null : requirePositiveInteger(args.expected_version, 'expected_version'),
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
      input_title: requireString(args.title, 'title'), input_summary: optionalString(args.summary),
      input_tags: requireArray(args.tags, 'tags'), input_items: requireArray(args.items, 'items'),
      input_remove_item_ids: requireArray(args.remove_item_ids, 'remove_item_ids'),
      input_rule_ids: args.rule_ids == null ? null : requireArray(args.rule_ids, 'rule_ids'),
      input_decision_ids: args.decision_ids == null ? null : requireArray(args.decision_ids, 'decision_ids'),
      input_verification_ids: args.verification_ids == null ? null : requireArray(args.verification_ids, 'verification_ids'),
      input_authored_via: 'agent',
    })
    return { ok: true, data }
  },
  async get_holding_thesis(supabase, args) {
    const accountId = args.account_id == null
      ? null
      : requirePositiveInteger(args.account_id, 'account_id')
    const data = await rpc(supabase, 'app_get_holding_thesis', {
      input_instrument_id: requirePositiveInteger(args.instrument_id, 'instrument_id'),
      input_account_id: accountId,
    })
    return { ok: true, data }
  },
  async save_holding_thesis(supabase, args) {
    requireSchemaVersion(args)
    const accountId = args.account_id == null
      ? null
      : requirePositiveInteger(args.account_id, 'account_id')
    const expectedVersion = args.expected_version === null
      ? null
      : requirePositiveInteger(args.expected_version, 'expected_version')
    const data = await rpc(supabase, 'app_save_holding_thesis', {
      input_instrument_id: requirePositiveInteger(args.instrument_id, 'instrument_id'),
      input_account_id: accountId,
      input_expected_version: expectedVersion,
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
      input_patch: normalizeHoldingThesisPatch(args.patch),
      input_change_reason: requireString(args.change_reason, 'change_reason'),
      input_authored_via: 'agent',
    })
    return { ok: true, data }
  },
  async link_task_to_holding_thesis(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: await rpc(supabase, 'app_link_task_to_holding_thesis', {
      input_thesis_id: requireUuid(args.thesis_id, 'thesis_id'), input_task_id: requireUuid(args.task_id, 'task_id'),
      input_expected_thesis_version: requirePositiveInteger(args.expected_thesis_version, 'expected_thesis_version'), input_expected_task_version: requirePositiveInteger(args.expected_task_version, 'expected_task_version'),
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
    }) }
  },
  async preview_trade_entry(supabase, args) {
    const data = await rpc(supabase, 'app_preview_trade_entry', {
      input_account_id: requirePositiveInteger(args.account_id, 'account_id'),
      input_instrument_id: requirePositiveInteger(args.instrument_id, 'instrument_id'),
      input_side: requireString(args.side, 'side'),
      input_quantity: requirePositiveDecimalString(args.quantity, 'quantity'),
      input_unit_price: requirePositiveDecimalString(args.unit_price, 'unit_price'),
      input_executed_on: requireString(args.executed_on, 'executed_on'),
    })
    return { ok: true, data }
  },
  async log_completed_trade(supabase, args) {
    requireSchemaVersion(args)
    const data = await rpc(supabase, 'app_log_completed_trade', {
      input_preview_id: requireUuid(args.preview_id, 'preview_id'),
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
      input_authored_via: 'agent',
    })
    return { ok: true, data }
  },
  async list_transactions(supabase, args) {
    const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 100)
    const page = cursorPage(args)
    if (!page.enabled && (args.instrument_id != null || args.account_id != null)) {
      throw new ToolInputError('account_id and instrument_id require cursor pagination; pass cursor:null')
    }
    const data = page.enabled
      ? await rpc(supabase, 'app_list_transaction_page', {
          input_instrument_id: args.instrument_id == null ? null : requirePositiveInteger(args.instrument_id, 'instrument_id'),
          input_account_id: args.account_id == null ? null : requirePositiveInteger(args.account_id, 'account_id'),
          input_limit: limit, input_cursor: page.value,
        })
      : await rpc(supabase, 'app_list_transactions', {
          input_limit: limit, input_before: optionalString(args.before) ?? null,
        })
    return { ok: true, data }
  },
  async get_holding_integrity(supabase, args) {
    return { ok: true, data: await rpc(supabase, 'app_get_holding_integrity', { input_holding_id: requirePositiveInteger(args.holding_id, 'holding_id') }) }
  },
  async get_portfolio_integrity(supabase) {
    return { ok: true, data: await rpc(supabase, 'app_get_portfolio_integrity') }
  },
  async preview_holding_reconciliation(supabase, args) {
    const values = requireRecord(args.values, 'values')
    const normalizedValues: Record<string,string> = {}
    for (const [key, value] of Object.entries(values)) normalizedValues[key] = value === '0' ? '0' : requirePositiveDecimalString(value, `values.${key}`)
    return { ok: true, data: await rpc(supabase, 'app_preview_holding_reconciliation', { input_holding_id: requirePositiveInteger(args.holding_id, 'holding_id'), input_values: normalizedValues, input_reason: requireString(args.reason, 'reason'), input_effective_on: requireString(args.effective_on, 'effective_on'), input_confirmed_fields: requireArray(args.confirmed_fields, 'confirmed_fields') }) }
  },
  async reconcile_holding(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: await rpc(supabase, 'app_reconcile_holding', { input_preview_id: requireUuid(args.preview_id, 'preview_id'), input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'), input_authored_via: 'agent' }) }
  },
  async verify_holdings(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: await rpc(supabase, 'app_verify_holding', { input_holding_id: requirePositiveInteger(args.holding_id, 'holding_id'), input_expected_version: requirePositiveInteger(args.expected_version, 'expected_version'), input_fields: requireArray(args.fields, 'fields'), input_verified_on: requireString(args.verified_on, 'verified_on'), input_note: args.note == null ? null : requireString(args.note, 'note'), input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'), input_source: 'agent' }) }
  },
  async preview_trade_reversal(supabase,args){return{ok:true,data:await rpc(supabase,'app_preview_trade_reversal',{input_trade_id:requireUuid(args.trade_id,'trade_id'),input_reason:requireString(args.reason,'reason')})}},
  async reverse_trade_entry(supabase,args){requireSchemaVersion(args);return{ok:true,data:await rpc(supabase,'app_reverse_trade_entry',{input_preview_id:requireUuid(args.preview_id,'preview_id'),input_idempotency_key:requireUuid(args.idempotency_key,'idempotency_key'),input_authored_via:'agent'})}},
}

validateToolRegistry(portfolioToolDefinitions, toolHandlers, {
  workflowGuides: workflowGuideToolNames,
  productFeedback: productFeedbackToolNames,
  entityNotes: entityNoteToolNames,
  dailyReview: dailyReviewToolNames,
  decisionsAndTasks: decisionTaskToolNames,
  investmentPolicy: investmentPolicyToolNames,
  operatingRules: operatingRuleToolNames,
  todoBundles: todoBundleToolNames,
  holdingThesis: holdingThesisToolNames,
  tradeEntry: tradeEntryToolNames,
  holdingIntegrity: holdingIntegrityToolNames,
  tradeReversal: tradeReversalToolNames,
})
validateWorkflowGuides(portfolioToolDefinitions.map((definition) => definition.name))

Deno.serve(
  pipeline(
    [withOAuthProtectedResource(), withSupabase({ auth: 'user' })],
    async (req, { supabase }) => {
      const requestId = crypto.randomUUID()
      const startedAt = performance.now()
      if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
      if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

      let message: JsonRpcRequest
      try {
        message = await req.json()
      } catch {
        return jsonRpcError(null, -32700, 'Invalid JSON')
      }

      if (message.id == null && message.method?.startsWith('notifications/')) {
        return new Response(null, { status: 204 })
      }

      if (message.method === 'initialize') {
        return jsonRpcResult(message.id, {
          protocolVersion,
          capabilities: {
            tools: { listChanged: false },
            prompts: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
          },
          serverInfo: { name: 'portfolio-mcp', title: 'Portfolio', version: '0.6.0' },
          instructions: serverInstructions,
        })
      }

      if (message.method === 'tools/list') {
        return jsonRpcResult(message.id, { tools: toolDefinitions })
      }

      if (message.method === 'prompts/list') {
        return jsonRpcResult(message.id, { prompts: promptDefinitions })
      }

      if (message.method === 'prompts/get') {
        const promptName = String(message.params?.name ?? '')
        if (promptName !== 'daily_portfolio_review') {
          return jsonRpcError(message.id, -32602, `Unknown prompt: ${promptName}`)
        }

        return jsonRpcResult(message.id, {
          description: 'Review the authenticated portfolio and explain only the changes that matter today.',
          messages: [
            {
              role: 'user',
              content: {
                type: 'resource',
                resource: {
                  uri: dailyReviewResourceUri,
                  mimeType: 'text/markdown',
                  text: dailyReviewGuide,
                },
              },
            },
            {
              role: 'user',
              content: {
                type: 'text',
                text: [
                  'Prompt marker: PORTFOLIO_PROMPT_DAILY_REVIEW_V2',
                  'Prepare my daily portfolio review.',
                  'Use Portfolio tools for stored facts and calculations. Use ChatGPT web research only when current external information is necessary.',
                  'Separate facts, interpretation, and decisions that require my attention.',
                ].join('\n'),
              },
            },
          ],
        })
      }

      if (message.method === 'resources/list') {
        return jsonRpcResult(message.id, { resources: resourceDefinitions })
      }

      if (message.method === 'resources/read') {
        const uri = String(message.params?.uri ?? '')
        if (uri !== dailyReviewResourceUri) {
          return jsonRpcError(message.id, -32602, `Unknown resource: ${uri}`)
        }

        return jsonRpcResult(message.id, {
          contents: [
            {
              uri: dailyReviewResourceUri,
              mimeType: 'text/markdown',
              text: dailyReviewGuide,
            },
          ],
        })
      }

      if (message.method !== 'tools/call') {
        return jsonRpcError(message.id, -32601, `Unsupported method: ${message.method ?? ''}`)
      }

      const toolName = String(message.params?.name ?? '')
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>
      const handler = toolHandlers[toolName]

      if (!handler) {
        return jsonRpcError(message.id, -32602, `Unknown tool: ${toolName}`)
      }

      try {
        const result = await handler(supabase, args)
        console.log(JSON.stringify({ event: 'mcp_tool_call', request_id: requestId, tool: toolName, outcome: 'success', duration_ms: Math.round(performance.now() - startedAt) }))
        return jsonRpcResult(message.id, toolResult(result))
      } catch (error) {
        const classified = error instanceof ToolInputError
          ? { code: 'validation_error', message: error.message, retryable: false, action: 'Correct the input using the advertised tool schema.' }
          : classifyPortfolioError(error)
        console.error(JSON.stringify({ event: 'mcp_tool_call', request_id: requestId, tool: toolName, outcome: 'error', code: classified.code, database_code: error instanceof PortfolioRpcError ? error.dbCode : undefined, duration_ms: Math.round(performance.now() - startedAt) }))
        return jsonRpcResult(message.id, toolErrorResult(classified, requestId))
      }
    },
  ),
)
