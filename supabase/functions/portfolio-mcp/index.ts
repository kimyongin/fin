import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type JsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

type RpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>
}

type ToolHandlerContext = {
  args: Record<string, unknown>
  supabase: RpcClient
  tokenHash: string
}

type ToolHandler = (context: ToolHandlerContext) => Promise<unknown>

const protocolVersion = '2024-11-05'
const yahooBase = 'https://query1.finance.yahoo.com/v8/finance/chart'

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: corsHeaders,
  })
}

function jsonRpcResult(id: JsonRpcRequest['id'], result: unknown) {
  return jsonResponse({
    jsonrpc: '2.0',
    id,
    result,
  })
}

function jsonRpcError(id: JsonRpcRequest['id'], code: number, message: string) {
  return jsonResponse({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  })
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bearerToken(req: Request) {
  const header = req.headers.get('Authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? ''
}

function textContent(value: unknown) {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  }
}

function firstRow(data: unknown) {
  return Array.isArray(data) ? data[0] ?? null : data
}

async function rpcResult(
  supabase: RpcClient,
  name: string,
  args: Record<string, unknown>,
  fallback: unknown = null,
) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data ?? fallback
}

async function rpcFirstRow(
  supabase: RpcClient,
  name: string,
  args: Record<string, unknown>,
) {
  return firstRow(await rpcResult(supabase, name, args))
}

function stringArg(args: Record<string, unknown>, key: string, fallback = '') {
  return args[key] == null ? fallback : String(args[key])
}

function nullableStringArg(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed ? trimmed : null
}

function nullableNumberArg(args: Record<string, unknown>, key: string) {
  const value = Number(args[key])
  return Number.isFinite(value) ? value : null
}

function nullableIntegerArg(args: Record<string, unknown>, key: string) {
  const value = Number(args[key])
  return Number.isFinite(value) ? Math.trunc(value) : null
}

function nullableDateArg(args: Record<string, unknown>, key: string) {
  return nullableStringArg(args, key)
}

function normalizeTickerInput(value: unknown) {
  return String(value ?? '').trim().toUpperCase()
}

function mapYahooInstrumentType(value: unknown) {
  const normalized = String(value ?? '').toUpperCase()
  if (normalized === 'CURRENCY') return 'fx'
  return 'market'
}

function yahooTickerCandidates(ticker: string) {
  const normalized = normalizeTickerInput(ticker)
  const candidates = [normalized]
  const prefixedKrxShortCode = /^A[0-9A-Z]{6}$/.test(normalized)
  const krxShortCode = prefixedKrxShortCode ? normalized.slice(1) : normalized

  if (/^\d{6}$/.test(normalized) || prefixedKrxShortCode) {
    candidates.unshift(`${krxShortCode}.KS`, `${krxShortCode}.KQ`)
  }

  return [...new Set(candidates)]
}

async function fetchYahooChart(symbol: string, query: string) {
  const response = await fetch(`${yahooBase}/${encodeURIComponent(symbol)}?${query}`, {
    headers: {
      'user-agent': 'Mozilla/5.0',
      accept: 'application/json,text/plain,*/*',
    },
  })

  if (!response.ok) return null
  const data = await response.json()
  const result = data?.chart?.result?.[0]
  if (!result?.meta) return null

  return { data, result, meta: result.meta }
}

async function lookupTicker(ticker: string) {
  for (const candidate of yahooTickerCandidates(ticker)) {
    const chart = await fetchYahooChart(candidate, 'interval=1d&range=5d')
    if (!chart?.meta) continue

    const timestamps = Array.isArray(chart.result?.timestamp) ? chart.result.timestamp : null
    const timestamp = timestamps?.length ? timestamps[timestamps.length - 1] : null
    const priceDate = Number.isFinite(timestamp)
      ? new Date(timestamp * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)

    return {
      ticker,
      lookup_symbol: candidate,
      display_name: chart.meta.longName || chart.meta.shortName || candidate || ticker,
      currency: chart.meta.currency ?? 'KRW',
      instrument_type: mapYahooInstrumentType(chart.meta.instrumentType ?? chart.meta.quoteType),
      price: Number.isFinite(chart.meta.regularMarketPrice) ? chart.meta.regularMarketPrice : null,
      price_date: priceDate,
      source: 'registered',
    }
  }

  throw new Error('No ticker data found.')
}

const toolHandlers: Record<string, ToolHandler> = {
  async get_portfolio_state({ supabase, tokenHash }) {
    return rpcResult(supabase, 'mcp_get_portfolio_state', {
      input_token_hash: tokenHash,
    })
  },

  async get_strategy_state({ supabase, tokenHash }) {
    return rpcResult(supabase, 'mcp_get_strategy_state', {
      input_token_hash: tokenHash,
    })
  },

  async save_strategy({ args, supabase, tokenHash }) {
    return rpcResult(supabase, 'mcp_save_strategy', {
      input_token_hash: tokenHash,
      input_targets: Array.isArray(args.targets) ? args.targets : [],
      input_expected_targets: Array.isArray(args.expected_targets) ? args.expected_targets : [],
    })
  },

  async find_holdings({ args, supabase, tokenHash }) {
    return rpcResult(
      supabase,
      'mcp_find_holdings',
      {
        input_token_hash: tokenHash,
        input_query: String(args.query ?? ''),
      },
      [],
    )
  },

  async save_account({ args, supabase, tokenHash }) {
    return rpcFirstRow(supabase, 'mcp_save_account', {
      input_token_hash: tokenHash,
      input_account_id: nullableIntegerArg(args, 'account_id'),
      input_name: stringArg(args, 'name'),
      input_broker: nullableStringArg(args, 'broker'),
      input_note: nullableStringArg(args, 'note'),
      input_request: nullableStringArg(args, 'request'),
    })
  },

  async delete_account({ args, supabase, tokenHash }) {
    return rpcFirstRow(supabase, 'mcp_delete_account', {
      input_token_hash: tokenHash,
      input_account_id: Number(args.account_id),
      input_request: nullableStringArg(args, 'request'),
    })
  },

  async lookup_ticker({ args, supabase, tokenHash }) {
    const ticker = normalizeTickerInput(args.ticker)
    if (!ticker) throw new Error('Ticker is required.')

    const lookupResult = await lookupTicker(ticker)
    const instrument = await rpcFirstRow(supabase, 'mcp_save_instrument', {
      input_token_hash: tokenHash,
      input_instrument_id: null,
      input_ticker: lookupResult.ticker,
      input_display_name: lookupResult.display_name,
      input_currency: lookupResult.currency,
      input_instrument_type: lookupResult.instrument_type,
      input_price: null,
      input_price_date: null,
      input_tag_id: nullableIntegerArg(args, 'tag_id'),
      input_request: nullableStringArg(args, 'request') ?? `Ticker lookup: ${ticker}`,
      input_price_source: 'lookup',
      input_note: null,
    })

    return { ...lookupResult, instrument }
  },

  async save_instrument({ args, supabase, tokenHash }) {
    return rpcFirstRow(supabase, 'mcp_save_instrument', {
      input_token_hash: tokenHash,
      input_instrument_id: nullableIntegerArg(args, 'instrument_id'),
      input_ticker: stringArg(args, 'ticker'),
      input_display_name: stringArg(args, 'display_name'),
      input_currency: stringArg(args, 'currency', 'KRW'),
      input_instrument_type: stringArg(args, 'instrument_type', 'market'),
      input_price: nullableNumberArg(args, 'price'),
      input_price_date: nullableDateArg(args, 'price_date'),
      input_tag_id: nullableIntegerArg(args, 'tag_id'),
      input_request: nullableStringArg(args, 'request'),
      input_price_source: stringArg(args, 'price_source', 'manual'),
      input_note: nullableStringArg(args, 'note'),
    })
  },

  async delete_instrument({ args, supabase, tokenHash }) {
    return rpcFirstRow(supabase, 'mcp_delete_instrument', {
      input_token_hash: tokenHash,
      input_instrument_id: Number(args.instrument_id),
      input_request: nullableStringArg(args, 'request'),
    })
  },

  async save_holding({ args, supabase, tokenHash }) {
    return rpcFirstRow(supabase, 'mcp_save_holding', {
      input_token_hash: tokenHash,
      input_holding_id: nullableIntegerArg(args, 'holding_id'),
      input_account_id: Number(args.account_id),
      input_ticker: stringArg(args, 'ticker'),
      input_quantity: nullableNumberArg(args, 'quantity'),
      input_avg_price: nullableNumberArg(args, 'avg_price'),
      input_purchase_amount: nullableNumberArg(args, 'purchase_amount'),
      input_valuation_amount: nullableNumberArg(args, 'valuation_amount'),
      input_request: nullableStringArg(args, 'request'),
    })
  },

  async delete_holding({ args, supabase, tokenHash }) {
    return rpcFirstRow(supabase, 'mcp_delete_holding', {
      input_token_hash: tokenHash,
      input_holding_id: Number(args.holding_id),
      input_request: nullableStringArg(args, 'request'),
    })
  },

  async save_tag({ args, supabase, tokenHash }) {
    return rpcFirstRow(supabase, 'mcp_save_tag', {
      input_token_hash: tokenHash,
      input_tag_id: nullableIntegerArg(args, 'tag_id'),
      input_name: stringArg(args, 'name'),
      input_sort_order: nullableIntegerArg(args, 'sort_order') ?? 0,
      input_request: nullableStringArg(args, 'request'),
    })
  },

  async delete_tag({ args, supabase, tokenHash }) {
    return rpcFirstRow(supabase, 'mcp_delete_tag', {
      input_token_hash: tokenHash,
      input_tag_id: Number(args.tag_id),
      input_request: nullableStringArg(args, 'request'),
    })
  },

  async update_holding_avg_price({ args, supabase, tokenHash }) {
    return rpcFirstRow(supabase, 'mcp_update_holding_avg_price', {
      input_token_hash: tokenHash,
      input_holding_id: Number(args.holding_id),
      input_avg_price: Number(args.avg_price),
      input_request: nullableStringArg(args, 'request'),
    })
  },

  async list_recent_activity({ args, supabase, tokenHash }) {
    return rpcResult(
      supabase,
      'mcp_list_recent_activity',
      {
        input_token_hash: tokenHash,
        limit_count: Number.isFinite(Number(args.limit)) ? Number(args.limit) : 20,
      },
      [],
    )
  },
}

function toolDefinitions() {
  return [
    {
      name: 'get_portfolio_state',
      description: 'Read the full portfolio state for the connected portfolio owner.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_strategy_state',
      description: 'Read the owner\'s current per-tag allocation targets. configured=false means no target set was saved. Targets are numeric percentages and separate from Markdown principles.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'save_strategy',
      description: 'Replace the owner\'s full per-tag allocation target set only after explicit approval. Read get_strategy_state first; send its current targets as expected_targets for conflict detection. Each percentage has at most two decimals and the total must equal 100.00. No modes, buckets, or trades are changed.',
      inputSchema: {
        type: 'object',
        properties: {
          targets: {
            type: 'array',
            description: 'Complete set of asset-tag targets; one row per tag including zero targets.',
            items: {
              type: 'object',
              properties: {
                tag_id: { type: 'integer' },
                target_percentage: { type: 'number' },
              },
              required: ['tag_id', 'target_percentage'],
            },
          },
          expected_targets: { type: 'array', description: 'Current saved tag_id/target_percentage rows from get_strategy_state, or [] when unset.', items: { type: 'object' } },
        },
        required: ['targets', 'expected_targets'],
      },
    },
    {
      name: 'find_holdings',
      description: 'Find holdings by ticker, display name, or account name.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Ticker, display name, or account name to search for.',
          },
        },
      },
    },
    {
      name: 'save_account',
      description: 'Create or update an account. Omit account_id to create a new account.',
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'number', description: 'Existing account id to update.' },
          name: { type: 'string', description: 'Account name.' },
          broker: { type: 'string', description: 'Broker name.' },
          note: { type: 'string', description: 'Optional account note.' },
          request: { type: 'string', description: 'Original user request for the activity log.' },
        },
        required: ['name'],
      },
    },
    {
      name: 'delete_account',
      description: 'Delete an account. The account must not have linked holdings.',
      inputSchema: {
        type: 'object',
        properties: {
          account_id: { type: 'number', description: 'Account id to delete.' },
          request: { type: 'string', description: 'Original user request for the activity log.' },
        },
        required: ['account_id'],
      },
    },
    {
      name: 'lookup_ticker',
      description: 'Look up a ticker from Yahoo Finance and register it as an instrument.',
      inputSchema: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Ticker to look up.' },
          tag_id: { type: 'number', description: 'Optional tag id to assign after registration.' },
          request: { type: 'string', description: 'Original user request for the activity log.' },
        },
        required: ['ticker'],
      },
    },
    {
      name: 'save_instrument',
      description: 'Create or update an instrument. Omit instrument_id to create or upsert by ticker.',
      inputSchema: {
        type: 'object',
        properties: {
          instrument_id: { type: 'number', description: 'Existing instrument id to update.' },
          ticker: { type: 'string', description: 'Ticker symbol.' },
          display_name: { type: 'string', description: 'Display name.' },
          currency: { type: 'string', description: 'Currency such as KRW, USD, or JPY.' },
          instrument_type: { type: 'string', description: 'market, valuation, or cash. Exchange-rate instruments are system-managed.' },
          price: { type: 'number', description: 'Optional latest/manual price.' },
          price_date: { type: 'string', description: 'Optional price date in YYYY-MM-DD format.' },
          tag_id: { type: 'number', description: 'Optional tag id to assign.' },
          note: { type: 'string', description: 'Optional instrument note.' },
          price_source: { type: 'string', description: 'Price source, defaults to manual.' },
          request: { type: 'string', description: 'Original user request for the activity log.' },
        },
        required: ['ticker', 'display_name'],
      },
    },
    {
      name: 'delete_instrument',
      description: 'Delete an instrument. The instrument must not have linked holdings.',
      inputSchema: {
        type: 'object',
        properties: {
          instrument_id: { type: 'number', description: 'Instrument id to delete.' },
          request: { type: 'string', description: 'Original user request for the activity log.' },
        },
        required: ['instrument_id'],
      },
    },
    {
      name: 'save_holding',
      description: 'Create or update an account holding. Market investments use quantity and avg_price; valuation investments use purchase_amount and valuation_amount; cash uses valuation_amount only. The common instrument note is edited separately, never on a holding.',
      inputSchema: {
        type: 'object',
        properties: {
          holding_id: { type: 'number', description: 'Existing holding id to update.' },
          account_id: { type: 'number', description: 'Account id.' },
          ticker: { type: 'string', description: 'Ticker symbol.' },
          quantity: { type: 'number', description: 'Quantity for a market investment. Must be zero or greater.' },
          avg_price: { type: 'number', description: 'Average price. Must be zero or greater.' },
          purchase_amount: { type: 'number', description: 'Purchase amount for a valuation investment.' },
          valuation_amount: { type: 'number', description: 'Current valuation amount for a valuation investment or cash balance.' },
          request: { type: 'string', description: 'Original user request for the activity log.' },
        },
        required: ['account_id', 'ticker'],
      },
    },
    {
      name: 'delete_holding',
      description: 'Delete a holding.',
      inputSchema: {
        type: 'object',
        properties: {
          holding_id: { type: 'number', description: 'Holding id to delete.' },
          request: { type: 'string', description: 'Original user request for the activity log.' },
        },
        required: ['holding_id'],
      },
    },
    {
      name: 'save_tag',
      description: 'Create or update a tag. Omit tag_id to create a new tag.',
      inputSchema: {
        type: 'object',
        properties: {
          tag_id: { type: 'number', description: 'Existing tag id to update.' },
          name: { type: 'string', description: 'Tag name.' },
          sort_order: { type: 'number', description: 'Sort order.' },
          request: { type: 'string', description: 'Original user request for the activity log.' },
        },
        required: ['name'],
      },
    },
    {
      name: 'delete_tag',
      description: 'Delete an asset tag and unlink its instruments. A tag with a positive allocation target must be reassigned and saved first; a zero target is removed with the tag.',
      inputSchema: {
        type: 'object',
        properties: {
          tag_id: { type: 'number', description: 'Tag id to delete.' },
          request: { type: 'string', description: 'Original user request for the activity log.' },
        },
        required: ['tag_id'],
      },
    },
    {
      name: 'update_holding_avg_price',
      description: 'Update the average price of a holding. Call find_holdings first when the target is ambiguous.',
      inputSchema: {
        type: 'object',
        properties: {
          holding_id: {
            type: 'number',
            description: 'The holding id returned by find_holdings.',
          },
          avg_price: {
            type: 'number',
            description: 'The new average price. Must be zero or greater.',
          },
          request: {
            type: 'string',
            description: 'The original user request, for the activity log.',
          },
        },
        required: ['holding_id', 'avg_price'],
      },
    },
    {
      name: 'list_recent_activity',
      description: 'List recent user and agent activity for the connected portfolio owner.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of activity events to return. Defaults to 20.',
          },
        },
      },
    },
  ]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method === 'GET') {
    return jsonResponse({
      name: 'portfolio-mcp',
      status: 'ok',
      protocolVersion,
    })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  let message: JsonRpcRequest
  try {
    message = await req.json()
  } catch {
    return jsonRpcError(null, -32700, 'Invalid JSON')
  }

  if (!message.id && message.method?.startsWith('notifications/')) {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    if (message.method === 'initialize') {
      return jsonRpcResult(message.id, {
        protocolVersion,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'portfolio-mcp',
          version: '0.1.0',
        },
      })
    }

    if (message.method === 'tools/list') {
      return jsonRpcResult(message.id, {
        tools: toolDefinitions(),
      })
    }

    if (message.method !== 'tools/call') {
      return jsonRpcError(message.id, -32601, `Unsupported method: ${message.method ?? ''}`)
    }

    const token = bearerToken(req)
    if (!token) {
      return jsonRpcError(message.id, -32001, 'Missing Authorization bearer token')
    }

    const tokenHash = await sha256Hex(token)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseAnonKey) as unknown as RpcClient

    const toolName = String(message.params?.name ?? '')
    const args = (message.params?.arguments ?? {}) as Record<string, unknown>
    const handler = toolHandlers[toolName]

    if (!handler) {
      return jsonRpcError(message.id, -32602, `Unknown tool: ${toolName}`)
    }

    const result = await handler({ args, supabase, tokenHash })
    return jsonRpcResult(message.id, textContent(result))
  } catch (error) {
    const messageText =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error && 'message' in error
          ? String((error as { message?: unknown }).message)
          : 'Tool call failed'
    return jsonRpcError(message.id, -32000, messageText)
  }
})
