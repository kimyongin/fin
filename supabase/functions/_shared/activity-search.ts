declare const Supabase: {
  ai: {
    Session: new (model: string) => {
      run(input: string, options: { mean_pool: boolean; normalize: boolean }): Promise<number[]>
    }
  }
}

type SupabaseClientLike = {
  rpc(name: string, params?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>
}

type SearchArgs = {
  owner_user_id?: string | null
  query?: string | null
  from?: string | null
  to?: string | null
  record_state?: 'all' | 'todo' | 'done'
  record_kind?: string
  record_kinds?: string[]
  has_conclusion?: boolean | null
  instrument_id?: number | null
  account_id?: number | null
  tag_ids?: string[]
  tag_match?: 'all' | 'any'
  limit?: number
  cursor?: Record<string, unknown> | null
  timezone?: string
}

type SearchItem = Record<string, unknown> & {
  record_type?: string
  record_id?: string
}

const embeddingModel = 'gte-small'

function rpcParams(args: SearchArgs) {
  return {
    input_owner_user_id: args.owner_user_id ?? null,
    input_query: args.query?.trim() || null,
    input_from: args.from || null,
    input_to: args.to || null,
    input_record_state: args.record_state ?? 'all',
    input_record_kind: args.record_kind ?? 'all',
    input_record_kinds: args.record_kinds ?? null,
    input_has_conclusion: typeof args.has_conclusion === 'boolean' ? args.has_conclusion : null,
    input_instrument_id: args.instrument_id ?? null,
    input_account_id: args.account_id ?? null,
    input_tag_ids: args.tag_ids ?? [],
    input_tag_match: args.tag_match ?? 'all',
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

function mergeHybrid(keywordItems: SearchItem[], semanticItems: SearchItem[], limit: number) {
  const scores = new Map<string, { item: SearchItem; score: number }>()
  function add(items: SearchItem[], weight: number) {
    items.forEach((item, index) => {
      const key = `${item.record_type}:${item.record_id}`
      const current = scores.get(key)
      scores.set(key, { item: current?.item ?? item, score: (current?.score ?? 0) + weight / (60 + index + 1) })
    })
  }
  add(keywordItems, 1)
  add(semanticItems, 1)
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit).map(({ item }) => item)
}

export async function hybridSearchActivities(client: SupabaseClientLike, args: SearchArgs) {
  const params = rpcParams(args)
  const keyword = await rpc(client, 'app_search_activities', params)
  const keywordItems = Array.isArray(keyword.items) ? keyword.items as SearchItem[] : []
  const query = args.query?.trim()
  if (!query || args.cursor || args.record_state === 'todo' || (args.record_kinds?.length ?? 0) > 0 || (!args.record_kinds && args.record_kind && args.record_kind !== 'all')) {
    return { ...keyword, semantic_status: query ? 'keyword_page' : 'not_requested', indexed_count: 0 }
  }

  try {
    const model = new Supabase.ai.Session(embeddingModel)
    const jobs = await rpc(client, 'app_list_activity_embedding_jobs', { input_limit: 12 })
    const jobItems = Array.isArray(jobs) ? jobs as Record<string, unknown>[] : []
    const indexed = await Promise.all(jobItems.map(async (job) => {
      const embedding = await model.run(String(job.content ?? ''), { mean_pool: true, normalize: true })
      await rpc(client, 'app_upsert_activity_embedding', {
        input_activity_id: job.activity_id,
        input_content_hash: job.content_hash,
        input_model: embeddingModel,
        input_embedding: JSON.stringify(embedding),
      })
      return job.activity_id
    }))
    const queryEmbedding = await model.run(query, { mean_pool: true, normalize: true })
    const semantic = await rpc(client, 'app_search_activity_semantic', {
      input_query_embedding: JSON.stringify(queryEmbedding),
      input_owner_user_id: args.owner_user_id ?? null,
      input_from: args.from || null,
      input_to: args.to || null,
      input_has_conclusion: typeof args.has_conclusion === 'boolean' ? args.has_conclusion : null,
      input_instrument_id: args.instrument_id ?? null,
      input_account_id: args.account_id ?? null,
      input_tag_ids: args.tag_ids ?? [],
      input_tag_match: args.tag_match ?? 'all',
      input_limit: Math.min(Math.max(args.limit ?? 30, 1), 100),
      input_timezone: args.timezone ?? 'Asia/Seoul',
    })
    const semanticItems = Array.isArray(semantic.items) ? semantic.items as SearchItem[] : []
    return {
      ...keyword,
      items: mergeHybrid(keywordItems, semanticItems, Math.min(Math.max(args.limit ?? 30, 1), 100)),
      semantic_status: 'active',
      indexed_count: indexed.length,
    }
  } catch (error) {
    console.warn(JSON.stringify({ event: 'activity_semantic_fallback', message: (error as Error).message }))
    return { ...keyword, semantic_status: 'unavailable', indexed_count: 0 }
  }
}
