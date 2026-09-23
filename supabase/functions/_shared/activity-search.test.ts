import { afterEach, describe, expect, it, vi } from 'vitest'

import { hybridSearchActivities } from './activity-search.ts'

afterEach(() => {
  delete (globalThis as any).Supabase
})

describe('activity hybrid search', () => {
  it('passes ordinary tag OR filters without inventing an activity kind', async () => {
    const client = { rpc: vi.fn(async () => ({ data: { items: [], next_cursor: null }, error: null })) }
    const result = await hybridSearchActivities(client, { query: '점검', record_state: 'todo', tag_ids: ['tag-1', 'tag-2'] })
    expect(result.semantic_status).toBe('keyword_page')
    expect(client.rpc).toHaveBeenCalledTimes(1)
    expect(client.rpc).toHaveBeenCalledWith('app_search_activities', expect.objectContaining({ input_tag_ids: ['tag-1', 'tag-2'], input_tag_match: 'any' }))
  })

  it('uses keyword search without invoking embeddings when no query is supplied', async () => {
    const client = { rpc: vi.fn(async () => ({ data: { items: [{ record_type: 'task', record_id: '1' }], next_cursor: null }, error: null })) }
    const result = await hybridSearchActivities(client, { query: null })
    expect(result.semantic_status).toBe('not_requested')
    expect(client.rpc).toHaveBeenCalledTimes(1)
  })

  it('falls back to keyword results when the Edge embedding runtime is unavailable', async () => {
    const client = { rpc: vi.fn(async (name) => ({ data: name === 'app_search_activities' ? { items: [{ record_type: 'activity', record_id: '1' }], next_cursor: null } : [], error: null })) }
    const result = await hybridSearchActivities(client, { query: '비슷한 판단' })
    expect(result.semantic_status).toBe('unavailable')
    expect(result.items).toHaveLength(1)
  })

  it('indexes current content and merges keyword with semantic rankings', async () => {
    const run = vi.fn(async (text: string) => text === '질문' ? [1, 0] : [0, 1])
    ;(globalThis as any).Supabase = { ai: { Session: class { run = run } } }
    const client = { rpc: vi.fn(async (name) => {
      if (name === 'app_search_activities') return { data: { items: [{ record_type: 'activity', record_id: '1', title: '키워드' }], next_cursor: null }, error: null }
      if (name === 'app_list_activity_embedding_jobs') return { data: [{ activity_id: 2, content: '문서', content_hash: 'hash' }], error: null }
      if (name === 'app_upsert_activity_embedding') return { data: { embedded: true }, error: null }
      if (name === 'app_search_activity_semantic') return { data: { items: [{ record_type: 'activity', record_id: '2', title: '의미' }] }, error: null }
      return { data: null, error: { message: 'unexpected' } }
    }) }
    const result = await hybridSearchActivities(client, { query: '질문', limit: 10 })
    expect(result.semantic_status).toBe('active')
    expect(result.indexed_count).toBe(1)
    expect(result.items).toHaveLength(2)
    expect(run).toHaveBeenCalledTimes(2)
  })
})
