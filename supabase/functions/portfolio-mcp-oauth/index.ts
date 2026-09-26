import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { pipeline } from 'npm:@supabase/middleware@^0.5.0'
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@^1.7.0'
import {
  actionTaskToolNames, activityReportToolNames, assetCrudToolNames, dailyReviewToolNames, decisionActivityToolNames, entityNoteToolNames, holdingIntegrityToolNames,
  investmentPolicyToolNames, portfolioToolDefinitions, tradeEntryToolNames,
  productFeedbackToolNames, workflowGuideToolNames, sharingToolNames,
} from '../_shared/mcp/portfolio-tools.ts'
import { classifyPortfolioError, PortfolioRpcError } from '../_shared/mcp/errors.ts'
import { type ToolHandler, validateToolRegistry } from '../_shared/mcp/registry.ts'
import { getWorkflowGuide, renderWorkflowGuideMarkdown, validateWorkflowGuides } from '../_shared/mcp/workflow-guides.ts'
import { hybridSearchActivities } from '../_shared/activity-search.ts'

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
  'Use authenticated portfolio tools for quantities, average costs, strategy, and saved activities instead of guessing. Current news research is performed by ChatGPT and may be saved as a research activity only on request.',
  'Use ChatGPT web research for current news, clearly separate sourced facts from analysis, and do not claim that Portfolio fetched live news.',
  'A review request is not permission to write: save only when the user explicitly asks, and keep model suggestions, user decisions, plans, completed trades, and brokerage balance verification distinct.',
  'Do not invent missing preferences or holding reasons, and do not report no meaningful change when research was incomplete.',
  'Before a multi-step Portfolio task, use get_workflow_guide when its advertised topic matches the user\'s request; do not repeat the same revision in one conversation.',
  'Report a write as saved only after its tool returns success; retry a lost response with the same idempotency key and re-read after a version conflict.',
  'Treat feedback about the Portfolio product separately from investment records: explicit clear registration requests may be saved directly, while an agent-initiated suggestion requires one user confirmation and must never include transcripts, portfolio data, credentials, or guessed causes.',
  'Use tasks for future intent and activities for performed work. Activity records have a readable Markdown body, optional ordinary tags and navigational task/holding references; they are not classified by hidden kinds. Complete a known matching task instead of duplicating the same performance; successful Portfolio mutations already create their own activity.',
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
    description: 'Start a concise daily review using the authenticated portfolio, strategy, and saved activities; research current news in ChatGPT and save a review only on explicit request.',
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

function requirePositiveInteger(value: unknown, field: string) {
  const normalized = Number(value)
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new ToolInputError(`${field} must be a positive integer`)
  }
  return normalized
}

function requireNonnegativeInteger(value: unknown, field: string) {
  const normalized = Number(value)
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new ToolInputError(`${field} must be a nonnegative integer`)
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
  async get_sharing_profile(supabase) {
    return { ok: true, data: await rpc(supabase, 'app_get_sharing_profile') }
  },
  async save_sharing_profile(supabase, args) {
    requireSchemaVersion(args)
    if (typeof args.sharing_enabled !== 'boolean' || typeof args.public_name !== 'string' || typeof args.viewer_password !== 'string') throw new ToolInputError('public_name, viewer_password, and sharing_enabled are required')
    return { ok: true, data: await rpc(supabase, 'app_save_sharing_profile', {
      input_public_name: args.public_name, input_viewer_password: args.viewer_password, input_sharing_enabled: args.sharing_enabled,
    }) }
  },
  async reset_sharing_profile(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: await rpc(supabase, 'app_reset_sharing_profile') }
  },
  async set_profile_avatar(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: { avatar_key: await rpc(supabase, 'app_set_profile_avatar', { input_avatar_key: requireString(args.avatar_key, 'avatar_key') }) } }
  },
  async list_friends(supabase) {
    return { ok: true, data: await rpc(supabase, 'list_friends') }
  },
  async connect_friend(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: await rpc(supabase, 'add_friend', {
      input_public_name: requireString(args.public_name, 'public_name'), input_viewer_password: requireString(args.viewer_password, 'viewer_password'),
    }) }
  },
  async remove_friend(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: { removed: await rpc(supabase, 'remove_friend', { input_owner_user_id: requireUuid(args.owner_user_id, 'owner_user_id') }) } }
  },
  async list_portfolio_viewers(supabase, args) {
    return { ok: true, data: await rpc(supabase, 'app_list_portfolio_viewers', {
      input_limit: args.limit == null ? 50 : requirePositiveInteger(args.limit, 'limit'),
      input_offset: args.offset == null ? 0 : requireNonnegativeInteger(args.offset, 'offset'),
    }) }
  },
  async get_shared_portfolio_state(supabase, args) {
    const ownerUserId = requireUuid(args.owner_user_id, 'owner_user_id')
    const friends = await rpc(supabase, 'list_friends')
    if (!Array.isArray(friends) || !friends.some((friend) => friend.owner_user_id === ownerUserId)) {
      throw new ToolInputError('Selected friend connection is not active')
    }
    return { ok: true, data: await rpc(supabase, 'app_get_portfolio_state', { input_owner_user_id: ownerUserId }) }
  },
  async get_portfolio_state(supabase) {
    return await rpc(supabase, 'app_get_portfolio_state', { input_owner_user_id: null })
  },
  async sync_prices(supabase, args) {
    requireSchemaVersion(args)
    const { data, error } = await supabase.functions.invoke('sync-prices', { body: {} })
    if (error) throw new PortfolioRpcError({ message: error.message })
    return { ok: true, data }
  },
  async find_holdings(supabase, args) {
    return await rpc(supabase, 'app_find_holdings', { input_query: String(args.query ?? '') })
  },
  async save_account(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: await rpc(supabase, 'app_save_account', {
      input_account_id: args.account_id == null ? null : requirePositiveInteger(args.account_id, 'account_id'),
      input_name: requireString(args.name, 'name'), input_broker: optionalString(args.broker) ?? null,
      input_note: optionalString(args.note) ?? null, input_source: 'agent', input_request: null,
    }) }
  },
  async delete_account(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: await rpc(supabase, 'app_delete_account', {
      input_account_id: requirePositiveInteger(args.account_id, 'account_id'), input_source: 'agent', input_request: null,
    }) }
  },
  async create_instrument(supabase, args) {
    requireSchemaVersion(args)
    const type = requireString(args.instrument_type, 'instrument_type')
    if (!['market','valuation','cash'].includes(type)) throw new ToolInputError('instrument_type is invalid')
    return { ok: true, data: await rpc(supabase, 'app_create_instrument', {
      input_ticker: requireString(args.ticker, 'ticker'), input_display_name: requireString(args.display_name, 'display_name'),
      input_currency: requireString(args.currency, 'currency'), input_instrument_type: type,
      input_tag_id: args.tag_id == null ? null : requirePositiveInteger(args.tag_id, 'tag_id'),
      input_note: optionalString(args.note) ?? null,
    }) }
  },
  async save_asset_detail(supabase, args) {
    requireSchemaVersion(args)
    const instrument = requireRecord(args.instrument, 'instrument')
    if ('manual_price' in instrument || 'manual_price_date' in instrument) throw new ToolInputError('Prices are updated only by price sync')
    return { ok: true, data: await rpc(supabase, 'app_save_asset_detail_with_activity', {
      input_instrument_id: requirePositiveInteger(args.instrument_id, 'instrument_id'),
      input_expected: requireRecord(args.expected, 'expected'), input_instrument: instrument,
      input_holdings: requireArray(args.holdings, 'holdings'),
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
      input_reason: optionalString(args.reason) ?? null,
      input_activity_tag_ids: args.activity_tag_ids == null ? [] : requireArray(args.activity_tag_ids, 'activity_tag_ids').map((value, index) => requireUuid(value, `activity_tag_ids[${index}]`)),
    }) }
  },
  async delete_holding(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: await rpc(supabase, 'app_delete_holding_checked', {
      input_holding_id: requirePositiveInteger(args.holding_id, 'holding_id'),
      input_expected_version: requirePositiveInteger(args.expected_version, 'expected_version'),
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
    }) }
  },
  async delete_instrument(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: await rpc(supabase, 'app_delete_instrument', {
      input_instrument_id: requirePositiveInteger(args.instrument_id, 'instrument_id'),
      input_source: 'agent', input_request: null,
    }) }
  },
  async save_asset_tag(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: await rpc(supabase, 'app_save_tag', {
      input_tag_id: args.tag_id == null ? null : requirePositiveInteger(args.tag_id, 'tag_id'),
      input_name: requireString(args.name, 'name'),
      input_sort_order: requireNonnegativeInteger(args.sort_order, 'sort_order'),
      input_source: 'agent', input_request: null,
    }) }
  },
  async delete_asset_tag(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: await rpc(supabase, 'app_delete_tag', {
      input_tag_id: requirePositiveInteger(args.tag_id, 'tag_id'), input_source: 'agent', input_request: null,
    }) }
  },
  async save_allocation_targets(supabase, args) {
    requireSchemaVersion(args)
    const targets = requireArray(args.targets, 'targets')
    const expected = requireArray(args.expected_targets, 'expected_targets')
    const context = {
      input_change_note: optionalString(args.change_note) ?? null,
      input_activity_tag_ids: args.activity_tag_ids == null ? [] : requireArray(args.activity_tag_ids, 'activity_tag_ids').map((value, index) => requireUuid(value, `activity_tag_ids[${index}]`)),
      input_idempotency_key: args.idempotency_key == null ? crypto.randomUUID() : requireUuid(args.idempotency_key, 'idempotency_key'),
    }
    return { ok: true, data: await rpc(supabase, targets.length === 0 ? 'app_clear_allocation_targets_with_activity' : 'app_save_allocation_targets_with_activity',
      targets.length === 0 ? { input_expected_targets: expected, ...context } : { input_targets: targets, input_expected_targets: expected, ...context }) }
  },
  async update_entity_note(supabase, args) {
    requireSchemaVersion(args)
    const entityType = requireString(args.entity_type, 'entity_type')
    if (!['account', 'instrument'].includes(entityType)) throw new ToolInputError('entity_type must be account or instrument')
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
  async get_my_product_feedback(supabase, args) {
    return { ok: true, data: await rpc(supabase, 'app_get_my_product_feedback', {
      input_feedback_id: requireUuid(args.feedback_id, 'feedback_id'),
    }) }
  },
  async update_my_product_feedback(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: await rpc(supabase, 'app_update_my_product_feedback', {
      input_feedback_id: requireUuid(args.feedback_id, 'feedback_id'),
      input_expected_version: requirePositiveInteger(args.expected_version, 'expected_version'),
      input_body: requireString(args.body, 'body'),
    }) }
  },
  async delete_my_product_feedback(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: await rpc(supabase, 'app_delete_my_product_feedback', {
      input_feedback_id: requireUuid(args.feedback_id, 'feedback_id'),
      input_expected_version: requirePositiveInteger(args.expected_version, 'expected_version'),
    }) }
  },
  async get_daily_context(supabase, args) {
    requireSchemaVersion(args)
    const timezone = requireString(args.timezone, 'timezone')
    const subjectTickers = args.subject_tickers == null
      ? null
      : requireArray(args.subject_tickers, 'subject_tickers').map((value, index) =>
        requireString(value, `subject_tickers[${index}]`)
      )
    const data = await rpc(supabase, 'app_get_daily_context', {
      input_timezone: timezone,
      input_subject_tickers: subjectTickers,
    })
    return { ok: true, data }
  },
  async list_general_tasks(supabase, args) {
    const data = await rpc(supabase, 'app_list_general_task_page', {
      input_filter: optionalString(args.filter) ?? 'active',
      input_limit: args.limit == null ? 20 : requirePositiveInteger(args.limit, 'limit'),
      input_cursor: args.cursor == null ? null : requireRecord(args.cursor, 'cursor'),
    })
    return { ok: true, data }
  },
  async list_due_general_tasks(supabase, args) {
    const data = await rpc(supabase, 'app_list_due_general_tasks', {
      input_limit: args.limit == null ? 100 : requirePositiveInteger(args.limit, 'limit'),
      input_offset: args.offset == null ? 0 : requireNonnegativeInteger(args.offset, 'offset'),
    })
    return { ok: true, data }
  },
  async get_general_task(supabase, args) {
    const data = await rpc(supabase, 'app_get_general_task', { input_task_id: requireUuid(args.task_id, 'task_id') })
    if (!data) throw new PortfolioRpcError({ message: 'General task not found' })
    return { ok: true, data }
  },
  async get_activity(supabase, args) {
    const data = await rpc(supabase, 'app_get_activity', {
      input_activity_id: requirePositiveInteger(args.activity_id, 'activity_id'),
      input_owner_user_id: null,
    })
    if (!data) throw new PortfolioRpcError({ message: 'Activity not found' })
    return { ok: true, data }
  },
  async list_activity_tags(supabase, args) {
    return { ok: true, data: await rpc(supabase, 'app_list_activity_tags', { input_query: optionalString(args.query) ?? null }) }
  },
  async save_activity_tag(supabase, args) {
    requireSchemaVersion(args)
    const tagId = args.tag_id == null ? null : requireUuid(args.tag_id, 'tag_id')
    const expectedVersion = args.expected_version == null ? null : requirePositiveInteger(args.expected_version, 'expected_version')
    if ((tagId == null) !== (expectedVersion == null)) throw new ToolInputError('tag_id and expected_version must both be set for an update')
    return { ok: true, data: await rpc(supabase, 'app_save_activity_tag', {
      input_tag_id: tagId, input_expected_version: expectedVersion,
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
      input_name: requireString(args.name, 'name'),
    }) }
  },
  async list_product_feedback_admin(supabase, args) {
    return { ok: true, data: await rpc(supabase, 'app_list_product_feedback_admin', {
      input_cursor: args.cursor == null ? null : requireRecord(args.cursor, 'cursor'),
      input_limit: Math.min(Math.max(Number(args.limit) || 20, 1), 50),
      input_status: args.status == null ? null : requireString(args.status, 'status'),
    }) }
  },
  async update_product_feedback_admin(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: await rpc(supabase, 'app_update_product_feedback_admin', {
      input_feedback_id: requireUuid(args.feedback_id, 'feedback_id'),
      input_expected_version: requirePositiveInteger(args.expected_version, 'expected_version'),
      input_status: requireString(args.status, 'status'),
      input_response: args.response == null ? null : requireString(args.response, 'response'),
      input_github_issue_url: args.github_issue_url == null ? null : requireString(args.github_issue_url, 'github_issue_url'),
    }) }
  },
  async delete_activity_tag(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: await rpc(supabase, 'app_delete_activity_tag', {
      input_tag_id: requireUuid(args.tag_id, 'tag_id'),
      input_expected_version: requirePositiveInteger(args.expected_version, 'expected_version'),
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
    }) }
  },
  async set_activity_tags(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: await rpc(supabase, 'app_set_activity_tags', {
      input_activity_id: requirePositiveInteger(args.activity_id, 'activity_id'),
      input_expected_version: requirePositiveInteger(args.expected_version, 'expected_version'),
      input_tag_ids: requireArray(args.tag_ids, 'tag_ids').map((value,index) => requireUuid(value, `tag_ids[${index}]`)),
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
    }) }
  },
  async set_general_task_tags(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: await rpc(supabase, 'app_set_general_task_tags', {
      input_task_id: requireUuid(args.task_id, 'task_id'),
      input_expected_version: requirePositiveInteger(args.expected_version, 'expected_version'),
      input_tag_ids: requireArray(args.tag_ids, 'tag_ids').map((value,index) => requireUuid(value, `tag_ids[${index}]`)),
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
    }) }
  },
  async search_activities(supabase, args) {
    const data = await hybridSearchActivities(supabase, {
      owner_user_id: null,
      query: optionalString(args.query) ?? null,
      from: optionalString(args.from) ?? null,
      to: optionalString(args.to) ?? null,
      record_state: (optionalString(args.record_state) ?? 'all') as 'all' | 'todo' | 'done',
      instrument_id: args.instrument_id == null ? null : requirePositiveInteger(args.instrument_id, 'instrument_id'),
      tag_ids: Array.isArray(args.tag_ids) ? args.tag_ids.map((value,index) => requireUuid(value, `tag_ids[${index}]`)) : [],
      tag_match: (optionalString(args.tag_match) ?? 'any') as 'all' | 'any',
      limit: args.limit == null ? 30 : requirePositiveInteger(args.limit, 'limit'),
      cursor: args.cursor == null ? null : requireRecord(args.cursor, 'cursor'),
      timezone: optionalString(args.timezone) ?? 'Asia/Seoul',
    })
    return { ok: true, data }
  },
  async save_general_task(supabase, args) {
    requireSchemaVersion(args)
    const taskId = args.task_id == null ? null : requireUuid(args.task_id, 'task_id')
    const expectedVersion = args.expected_version == null ? null : requirePositiveInteger(args.expected_version, 'expected_version')
    if ((taskId == null) !== (expectedVersion == null)) throw new ToolInputError('task_id and expected_version must both be set for an update')
    const idempotencyKey = requireUuid(args.idempotency_key, 'idempotency_key')
    const tagIds = args.tag_ids == null ? [] : requireArray(args.tag_ids, 'tag_ids').map((value, index) => requireUuid(value, `tag_ids[${index}]`))
    const payload = {
        title: requireString(args.title, 'title'), subject: requireRecord(args.subject, 'subject'),
        due_date: optionalString(args.due_date) ?? null, timezone: requireString(args.timezone, 'timezone'),
        trigger_text: optionalString(args.trigger_text) ?? null,
        recurrence_kind: optionalString(args.recurrence_kind) ?? 'none',
        recurrence_start_on: optionalString(args.recurrence_start_on) ?? null,
        recurrence_weekdays: args.recurrence_weekdays == null ? [] : requireArray(args.recurrence_weekdays, 'recurrence_weekdays'),
        recurrence_time: optionalString(args.recurrence_time) ?? null,
        authored_via: 'agent',
    }
    if (Object.hasOwn(args, 'origin_activity_id')) throw new ToolInputError('origin_activity_id is no longer supported; create an independent task')
    const editingTags = taskId != null && Object.hasOwn(args, 'tag_ids')
    const data = await rpc(supabase, taskId == null ? 'app_create_general_task_with_tags' : editingTags ? 'app_save_general_task_detail' : 'app_save_general_task', {
      input_idempotency_key: idempotencyKey, input_payload: payload,
      ...(taskId == null ? { input_tag_ids: tagIds } : { input_task_id: taskId, input_expected_version: expectedVersion, ...(editingTags ? { input_tag_ids: tagIds } : {}) }),
    })
    return { ok: true, data }
  },
  async delete_general_task(supabase, args) {
    requireSchemaVersion(args)
    return { ok: true, data: await rpc(supabase, 'app_delete_general_task', {
      input_task_id: requireUuid(args.task_id, 'task_id'),
      input_expected_version: requirePositiveInteger(args.expected_version, 'expected_version'),
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
    }) }
  },
  async transition_general_task(supabase, args) {
    requireSchemaVersion(args)
    const action = requireString(args.action, 'action')
    if (!['complete','reopen','cancel'].includes(action)) throw new ToolInputError('action is invalid')
    const data = await rpc(supabase, 'app_transition_general_task', {
      input_task_id: requireUuid(args.task_id, 'task_id'),
      input_expected_version: requirePositiveInteger(args.expected_version, 'expected_version'),
      input_action: action, input_result: optionalString(args.result) ?? null, input_reason: optionalString(args.reason) ?? null,
      input_occurrence_on: optionalString(args.occurrence_on) ?? null,
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'), input_authored_via: 'agent',
    })
    return { ok: true, data }
  },
  async record_manual_activity(supabase, args) {
    requireSchemaVersion(args)
    const tagIds = args.tag_ids == null ? [] : requireArray(args.tag_ids, 'tag_ids').map((value, index) => requireUuid(value, `tag_ids[${index}]`))
    const data = await rpc(supabase, 'app_create_activity_with_tags', {
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
      input_tag_ids: tagIds,
      input_payload: {
        title: requireString(args.title, 'title'),
        body: optionalString(args.body) ?? null,
        occurred_at: optionalString(args.occurred_at) ?? null,
        timezone: requireString(args.timezone, 'timezone'),
        task_id: args.task_id == null ? null : requireUuid(args.task_id, 'task_id'),
        instrument_id: args.instrument_id == null ? null : requirePositiveInteger(args.instrument_id, 'instrument_id'),
        authored_via: 'agent',
      },
    })
    return { ok: true, data }
  },
  async update_activity(supabase, args) {
    requireSchemaVersion(args)
    const patch = requireRecord(args.patch, 'patch')
    const allowed = new Set(['title', 'body', 'occurred_at', 'timezone', 'task_id', 'instrument_id'])
    for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new ToolInputError(`patch.${key} is not editable`)
    const hasTagIds = Object.hasOwn(args, 'tag_ids')
    if (!hasTagIds && Object.keys(patch).length === 0) throw new ToolInputError('patch or tag_ids is required')
    const tagIds = hasTagIds ? requireArray(args.tag_ids, 'tag_ids').map((value, index) => requireUuid(value, `tag_ids[${index}]`)) : null
    const data = await rpc(supabase, hasTagIds ? 'app_save_activity_detail' : 'app_update_activity', {
      input_activity_id: requirePositiveInteger(args.activity_id, 'activity_id'),
      input_expected_version: requirePositiveInteger(args.expected_version, 'expected_version'),
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'),
      input_patch: patch,
      ...(hasTagIds ? { input_tag_ids: tagIds } : {}),
      input_authored_via: 'agent',
    })
    return { ok: true, data }
  },
  async delete_activity(supabase, args) {
    requireSchemaVersion(args)
    const data = await rpc(supabase, 'app_delete_activity', {
      input_activity_id: requirePositiveInteger(args.activity_id, 'activity_id'),
      input_expected_version: requirePositiveInteger(args.expected_version, 'expected_version'),
    })
    return { ok: true, data }
  },
  async get_activity_report_context(supabase, args) {
    const data = await rpc(supabase, 'app_get_activity_report_context', {
      input_period_start: requireString(args.period_start, 'period_start'), input_period_end: requireString(args.period_end, 'period_end'),
      input_timezone: requireString(args.timezone, 'timezone'), input_limit: args.limit == null ? 200 : requirePositiveInteger(args.limit, 'limit'),
      input_cursor: args.cursor == null ? null : requireRecord(args.cursor, 'cursor'),
    })
    return { ok: true, data }
  },
  async list_principles(supabase, args) {
    const data = await rpc(supabase, 'app_list_principles', {
      input_on: args.on_date ?? null,
      input_timezone: args.timezone ?? 'Asia/Seoul',
      input_include_ended: args.include_ended === true,
    })
    return { ok: true, data }
  },
  async save_principle(supabase, args) {
    requireSchemaVersion(args)
    if (args.expected_body !== null && typeof args.expected_body !== 'string') throw new ToolInputError('expected_body must be a string or null')
    if (args.expected_change_note !== null && typeof args.expected_change_note !== 'string') throw new ToolInputError('expected_change_note must be a string or null')
    const data = await rpc(supabase, 'app_save_principle_with_activity', {
      input_principle_id: requireUuid(args.principle_id, 'principle_id'),
      input_expected_row_id: args.expected_row_id == null ? null : requirePositiveInteger(args.expected_row_id, 'expected_row_id'),
      input_expected_body: args.expected_body,
      input_expected_change_note: args.expected_change_note,
      input_body: requireString(args.body, 'body'),
      input_change_note: args.change_note == null ? null : requireString(args.change_note, 'change_note'),
      input_activity_tag_ids: args.activity_tag_ids == null ? [] : requireArray(args.activity_tag_ids, 'activity_tag_ids').map((value, index) => requireUuid(value, `activity_tag_ids[${index}]`)),
    })
    return { ok: true, data }
  },
  async list_principle_changes(supabase, args) {
    const data = await rpc(supabase, 'app_list_principle_changes', {
      input_limit: args.limit == null ? 20 : requirePositiveInteger(args.limit, 'limit'),
      input_cursor: args.cursor == null ? null : requireRecord(args.cursor, 'cursor'),
      input_owner_user_id: null,
    })
    return { ok: true, data }
  },
  async get_principle_row(supabase, args) {
    const data = await rpc(supabase, 'app_get_principle_row', { input_row_id: requirePositiveInteger(args.row_id, 'row_id') })
    return { ok: true, data }
  },
  async correct_principle_row(supabase, args) {
    requireSchemaVersion(args)
    if (typeof args.expected_body !== 'string') throw new ToolInputError('expected_body must be a string')
    if (args.expected_change_note !== null && typeof args.expected_change_note !== 'string') throw new ToolInputError('expected_change_note must be a string or null')
    const data = await rpc(supabase, 'app_correct_principle_row', {
      input_row_id: requirePositiveInteger(args.row_id, 'row_id'),
      input_expected_body: args.expected_body,
      input_expected_change_note: args.expected_change_note,
      input_body: requireString(args.body, 'body'),
      input_change_note: args.change_note == null ? null : requireString(args.change_note, 'change_note'),
    })
    return { ok: true, data }
  },
  async delete_principle_row(supabase, args) {
    requireSchemaVersion(args)
    if (typeof args.expected_body !== 'string') throw new ToolInputError('expected_body must be a string')
    if (args.expected_change_note !== null && typeof args.expected_change_note !== 'string') throw new ToolInputError('expected_change_note must be a string or null')
    const data = await rpc(supabase, 'app_delete_principle_row', {
      input_row_id: requirePositiveInteger(args.row_id, 'row_id'),
      input_expected_body: args.expected_body,
      input_expected_change_note: args.expected_change_note,
      input_expected_current_row_id: requirePositiveInteger(args.expected_current_row_id, 'expected_current_row_id'),
    })
    return { ok: true, data }
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
    const data = await rpc(supabase, 'app_record_completed_trade', {
      input_account_id: requirePositiveInteger(args.account_id, 'account_id'),
      input_instrument_id: requirePositiveInteger(args.instrument_id, 'instrument_id'),
      input_side: requireString(args.side, 'side'),
      input_quantity: requirePositiveDecimalString(args.quantity, 'quantity'),
      input_unit_price: requirePositiveDecimalString(args.unit_price, 'unit_price'),
      input_executed_on: requireString(args.executed_on, 'executed_on'),
      input_expected_holding_id: args.expected_holding_id == null ? null : requirePositiveInteger(args.expected_holding_id, 'expected_holding_id'),
      input_expected_version: requireNonnegativeInteger(args.expected_version, 'expected_version'),
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
  async preview_holding_reconciliation(supabase, args) {
    const values = requireRecord(args.values, 'values')
    const normalizedValues: Record<string,string> = {}
    for (const [key, value] of Object.entries(values)) normalizedValues[key] = value === '0' ? '0' : requirePositiveDecimalString(value, `values.${key}`)
    return { ok: true, data: await rpc(supabase, 'app_preview_holding_reconciliation', { input_holding_id: requirePositiveInteger(args.holding_id, 'holding_id'), input_values: normalizedValues, input_reason: requireString(args.reason, 'reason'), input_effective_on: requireString(args.effective_on, 'effective_on') }) }
  },
  async reconcile_holding(supabase, args) {
    requireSchemaVersion(args)
    const values = requireRecord(args.values, 'values')
    const normalizedValues: Record<string,string> = {}
    for (const [key, value] of Object.entries(values)) normalizedValues[key] = value === '0' ? '0' : requirePositiveDecimalString(value, `values.${key}`)
    return { ok: true, data: await rpc(supabase, 'app_apply_holding_correction', {
      input_holding_id: requirePositiveInteger(args.holding_id, 'holding_id'),
      input_values: normalizedValues, input_reason: requireString(args.reason, 'reason'),
      input_effective_on: requireString(args.effective_on, 'effective_on'),
      input_expected_version: requirePositiveInteger(args.expected_version, 'expected_version'),
      input_idempotency_key: requireUuid(args.idempotency_key, 'idempotency_key'), input_authored_via: 'agent',
    }) }
  },
}

validateToolRegistry(portfolioToolDefinitions, toolHandlers, {
  workflowGuides: workflowGuideToolNames,
  productFeedback: productFeedbackToolNames,
  entityNotes: entityNoteToolNames,
  sharing: sharingToolNames,
  assets: assetCrudToolNames,
  dailyReview: dailyReviewToolNames,
  decisionActivities: decisionActivityToolNames,
  actionTasks: actionTaskToolNames,
  activityReports: activityReportToolNames,
  investmentPolicy: investmentPolicyToolNames,
  tradeEntry: tradeEntryToolNames,
  holdingIntegrity: holdingIntegrityToolNames,
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
          serverInfo: { name: 'portfolio-mcp', title: 'Portfolio', version: '0.7.0' },
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
