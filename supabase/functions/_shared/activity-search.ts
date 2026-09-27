type SupabaseClientLike = {
  rpc(name: string, params?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>
}

type SearchArgs = {
  owner_user_id?: string | null
  query?: string | null
  from?: string | null
  to?: string | null
  record_state?: 'all' | 'todo' | 'done'
  instrument_id?: number | null
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
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Search embedding service is not configured')
  const response = await fetch(`${url}/functions/v1/activity-search-index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({ kind: 'query', query }),
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`Search embedding failed: ${response.status}`)
  const result = await response.json() as QueryVector
  if (result.model !== 'gte-small' || !Array.isArray(result.embedding) ||
      result.embedding.length !== 384) throw new Error('Search embedding model mismatch')
  return result
}

function rpcParams(args: SearchArgs, query: string | null) {
  return {
    input_owner_user_id: args.owner_user_id ?? null,
    input_query: query,
    input_from: args.from || null,
    input_to: args.to || null,
    input_record_state: args.record_state ?? 'all',
    input_instrument_id: args.instrument_id ?? null,
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
    const page = await rpc(client, 'app_search_activities', params)
    return { ...page, semantic_status: 'not_requested' }
  }
  let vector: QueryVector | null = null
  try {
    if (args.cursor?.mode !== 'keyword') vector = await embedQuery(query)
  } catch (error) {
    if (args.cursor?.mode === 'hybrid') throw error
  }
  const page = await rpc(client, 'app_search_activities_ranked', {
    ...params, input_query_embedding: vector ? JSON.stringify(vector.embedding) : null,
  })
  if (!vector) return { ...page, semantic_status: 'unavailable' }
  try {
    const coverage = await rpc(client, 'app_activity_search_index_coverage', {
      input_owner_user_id: args.owner_user_id ?? null,
    })
    return {
      ...page,
      semantic_status: Number(coverage.missing_count ?? 0) > 0 ? 'indexing' : 'active',
      missing_count: Number(coverage.missing_count ?? 0),
      embedding_model: vector.model,
    }
  } catch {
    return { ...page, semantic_status: 'indexing', embedding_model: vector.model }
  }
}
