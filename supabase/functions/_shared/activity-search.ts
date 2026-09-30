import { getSearchWorkerKey } from './search-worker-auth.ts'
import { SEARCH_EMBEDDING_DIMENSIONS, SEARCH_EMBEDDING_MODEL } from './search-embedding.ts'

type SupabaseClientLike = {
  rpc(name: string, params?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>
}

type SearchArgs = {
  owner_user_id?: string | null
  query?: string | null
  from?: string | null
  to?: string | null
  record_state?: 'all' | 'todo' | 'done'
  instrument_ticker?: string | null
  tag_ids?: string[]
  tag_match?: 'all' | 'any'
  limit?: number
  cursor?: Record<string, unknown> | null
  timezone?: string
}

declare const Deno: { env: { get(name: string): string | undefined } }

type QueryVector = { model: string; embedding: number[] }
type EmbedQuery = (query: string) => Promise<QueryVector>

async function requestQueryVector(query: string): Promise<QueryVector> {
  const url = Deno.env.get('SUPABASE_URL')
  if (!url) throw new Error('Search embedding service is not configured')
  const key = getSearchWorkerKey()
  const response = await fetch(`${url}/functions/v1/activity-search-index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key },
    body: JSON.stringify({ kind: 'query', query }),
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) {
    const failure = new Error('Search embedding is unavailable')
    if ([408, 504].includes(response.status)) failure.name = 'TimeoutError'
    throw failure
  }
  const result = await response.json() as QueryVector
  if (result.model !== SEARCH_EMBEDDING_MODEL || !Array.isArray(result.embedding) ||
      result.embedding.length !== SEARCH_EMBEDDING_DIMENSIONS ||
      result.embedding.some((value) => !Number.isFinite(value))) throw new Error('Search embedding model mismatch')
  return result
}

function rpcParams(args: SearchArgs, query: string | null) {
  return {
    input_owner_user_id: args.owner_user_id ?? null,
    input_query: query,
    input_from: args.from || null,
    input_to: args.to || null,
    input_record_state: args.record_state ?? 'all',
    input_instrument_ticker: args.instrument_ticker ?? null,
    input_tag_ids: args.tag_ids ?? [],
    input_tag_match: args.tag_match ?? 'any',
    input_limit: Math.min(Math.max(args.limit ?? 30, 1), 100),
    input_cursor: args.cursor ?? null,
    input_timezone: args.timezone ?? 'Asia/Seoul',
  }
}

async function rpc(client: SupabaseClientLike, name: string, params: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, params)
  if (error) throw new Error(error.message ?? `${name} failed`)
  return data as Record<string, unknown>
}

// Search creates one query vector in an isolated Edge invocation. Document
// indexing is entirely decoupled from this request and runs from the queue.
export async function hybridSearchActivities(
  client: SupabaseClientLike, args: SearchArgs, embedQuery: EmbedQuery = requestQueryVector,
) {
  const query = args.query?.trim() || null
  const params = rpcParams(args, query)
  if (!query) {
    const page = await rpc(client, 'app_search_activities_ticker', params)
    return { ...page, search_mode: 'browse', fallback_reason: null,
      embedding_model: null, semantic_threshold: null, index_status: 'not_checked',
      semantic_status: 'not_requested' }
  }
  let vector: QueryVector | null = null
  let fallbackReason: string | null = null
  try {
    if (args.cursor?.mode !== 'keyword' &&
        (embedQuery !== requestQueryVector || Deno.env.get('ACTIVITY_SEARCH_SEMANTIC_ENABLED') === 'true')) {
      vector = await embedQuery(query)
    } else if (args.cursor?.mode === 'hybrid') {
      throw new Error('Semantic search is temporarily unavailable; retry this page or start a new search')
    }
  } catch (error) {
    if (args.cursor?.mode === 'hybrid') {
      throw new Error('Semantic search is temporarily unavailable; retry this page or start a new search')
    }
    fallbackReason = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
      ? 'embedding_timeout' : 'embedding_unavailable'
  }
  const page = await rpc(client, 'app_search_activities_ranked_ticker', {
    ...params, input_query_embedding: vector ? JSON.stringify(vector.embedding) : null,
    ...(vector ? { input_query_model: vector.model } : {}),
  })
  if (!vector) return { ...page, search_mode: 'keyword', fallback_reason: fallbackReason,
    embedding_model: null, semantic_threshold: null, index_status: 'not_checked',
    semantic_status: 'unavailable' }
  try {
    const coverage = await rpc(client, 'app_activity_search_index_coverage', {
      input_owner_user_id: args.owner_user_id ?? null,
    })
    return {
      ...page,
      search_mode: 'hybrid', fallback_reason: null,
      index_status: Number(coverage.missing_count ?? 0) + Number(coverage.excluded_count ?? 0) > 0 ? 'partial' : 'complete',
      semantic_status: Number(coverage.missing_count ?? 0) > 0 ? 'indexing' : 'active',
      missing_count: Number(coverage.missing_count ?? 0),
      excluded_count: Number(coverage.excluded_count ?? 0),
      embedding_model: vector.model,
    }
  } catch {
    return { ...page, search_mode: 'hybrid', fallback_reason: null,
      index_status: 'unknown', semantic_status: 'indexing', embedding_model: vector.model }
  }
}
