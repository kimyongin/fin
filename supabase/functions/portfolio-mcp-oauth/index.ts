import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { pipeline } from 'npm:@supabase/middleware@^0.5.0'
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@^1.7.0'

type JsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

const protocolVersion = '2025-06-18'
const oauthSecurity = [{ type: 'oauth2', scopes: ['openid', 'email', 'profile'] }]
const readOnlyAnnotations = {
  readOnlyHint: true,
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

const toolDefinitions = [
  {
    name: 'get_profile',
    title: 'Connected portfolio profile',
    description: 'Return the profile represented by the authenticated Portfolio account.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: profileOutputSchema,
    annotations: readOnlyAnnotations,
    securitySchemes: oauthSecurity,
    _meta: { 'openai/profile': true },
  },
  {
    name: 'get_portfolio_state',
    title: 'Portfolio state',
    description: 'Read accounts, holdings, instruments, tags, and latest prices for the authenticated user.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotations,
    securitySchemes: oauthSecurity,
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
    securitySchemes: oauthSecurity,
  },
  {
    name: 'get_strategy_state',
    title: 'Investment strategy',
    description: 'Read the authenticated user\'s active strategy, target buckets, and tag mappings.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotations,
    securitySchemes: oauthSecurity,
  },
  {
    name: 'get_news_state',
    title: 'Saved market news',
    description: 'Read market news facts and opinions saved by the authenticated user.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotations,
    securitySchemes: oauthSecurity,
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
    securitySchemes: oauthSecurity,
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

async function rpc(supabase: any, name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}

Deno.serve(
  pipeline(
    [withOAuthProtectedResource(), withSupabase({ auth: 'user' })],
    async (req, { supabase }) => {
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
          capabilities: { tools: {} },
          serverInfo: { name: 'portfolio-mcp', version: '0.2.0' },
        })
      }

      if (message.method === 'tools/list') {
        return jsonRpcResult(message.id, { tools: toolDefinitions })
      }

      if (message.method !== 'tools/call') {
        return jsonRpcError(message.id, -32601, `Unsupported method: ${message.method ?? ''}`)
      }

      const toolName = String(message.params?.name ?? '')
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>

      try {
        if (toolName === 'get_profile') {
          const { data, error } = await supabase.auth.getUser()
          if (error || !data.user) throw new Error(error?.message ?? 'Authenticated user not found')
          const profile = {
            id: data.user.id,
            ...(data.user.user_metadata?.full_name ? { name: String(data.user.user_metadata.full_name) } : {}),
            ...(data.user.email ? { email: data.user.email } : {}),
            nickname: 'Portfolio account',
          }
          return jsonRpcResult(message.id, toolResult(profile))
        }

        if (toolName === 'get_portfolio_state') {
          return jsonRpcResult(message.id, toolResult(await rpc(supabase, 'app_get_portfolio_state', { input_owner_user_id: null })))
        }
        if (toolName === 'find_holdings') {
          return jsonRpcResult(message.id, toolResult(await rpc(supabase, 'app_find_holdings', { input_query: String(args.query ?? '') })))
        }
        if (toolName === 'get_strategy_state') {
          return jsonRpcResult(message.id, toolResult(await rpc(supabase, 'app_get_strategy_state', { input_owner_user_id: null })))
        }
        if (toolName === 'get_news_state') {
          return jsonRpcResult(message.id, toolResult(await rpc(supabase, 'app_get_news_state', { input_owner_user_id: null })))
        }
        if (toolName === 'list_recent_activity') {
          const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100)
          return jsonRpcResult(message.id, toolResult(await rpc(supabase, 'app_list_recent_activity', { limit_count: limit })))
        }

        return jsonRpcError(message.id, -32602, `Unknown tool: ${toolName}`)
      } catch (error) {
        const messageText = error instanceof Error ? error.message : 'Tool call failed'
        return jsonRpcError(message.id, -32000, messageText)
      }
    },
  ),
)
