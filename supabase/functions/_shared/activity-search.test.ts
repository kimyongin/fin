import { describe, expect, it, vi } from 'vitest'

import { hybridSearchActivities } from './activity-search.ts'

const vector = { model: 'multilingual-e5-large', embedding: Array(1024).fill(0.01) }

describe('activity hybrid search', () => {
  it('never indexes documents while searching and forwards the same filters to ranked search', async () => {
    const rpc = vi.fn(async (name) => ({
      data: name === 'app_activity_search_index_coverage'
        ? { missing_count: 0 } : { items: [{ record_type: 'task', record_id: 'task-1' }], next_cursor: null },
      error: null,
    }))
    const embed = vi.fn(async () => vector)
    const result = await hybridSearchActivities({ rpc }, {
      query: '심리', record_state: 'done', tag_ids: ['tag-1'], tag_match: 'all',
    }, embed)
    expect(result.semantic_status).toBe('active')
    expect(result).toMatchObject({ search_mode: 'hybrid', fallback_reason: null,
      index_status: 'complete', embedding_model: 'multilingual-e5-large' })
    expect(embed).toHaveBeenCalledOnce()
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'app_search_activities_ranked_ticker', 'app_activity_search_index_coverage',
    ])
    expect(rpc).toHaveBeenCalledWith('app_search_activities_ranked_ticker',
      expect.objectContaining({ input_record_state: 'done', input_tag_ids: ['tag-1'],
        input_tag_match: 'all', input_query_embedding: JSON.stringify(vector.embedding),
        input_query_model: 'multilingual-e5-large' }))
  })

  it('reports incomplete indexing without treating missing vectors as no history', async () => {
    const rpc = vi.fn(async (name) => ({ data: name === 'app_activity_search_index_coverage'
      ? { missing_count: 12 } : { items: [], next_cursor: null }, error: null }))
    const result = await hybridSearchActivities({ rpc }, { query: '투자 이론' }, async () => vector)
    expect(result.semantic_status).toBe('indexing')
    expect(result.index_status).toBe('partial')
    expect(result.missing_count).toBe(12)
  })

  it('keeps keyword search available if embedding inference fails', async () => {
    const rpc = vi.fn(async () => ({ data: { items: [{ title: '심리' }], next_cursor: null }, error: null }))
    const result = await hybridSearchActivities({ rpc }, { query: '심리' }, async () => { throw new Error('546') })
    expect(result.semantic_status).toBe('unavailable')
    expect(result).toMatchObject({ search_mode: 'keyword', fallback_reason: 'embedding_unavailable',
      index_status: 'not_checked' })
    expect(result.items).toHaveLength(1)
    expect(rpc).toHaveBeenCalledWith('app_search_activities_ranked_ticker',
      expect.objectContaining({ input_query_embedding: null }))
  })

  it('does not silently switch cursor contracts if semantic search fails on a later page', async () => {
    const rpc = vi.fn()
    await expect(hybridSearchActivities({ rpc }, { query: '심리', cursor: { rank: 80, mode: 'hybrid' } },
      async () => { throw new Error('private inference detail') })).rejects.toThrow('Semantic search is temporarily unavailable')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('does not request an embedding for the ordinary feed', async () => {
    const rpc = vi.fn(async () => ({ data: { items: [], next_cursor: null }, error: null }))
    const embed = vi.fn()
    const result = await hybridSearchActivities({ rpc }, { query: null }, embed)
    expect(result.semantic_status).toBe('not_requested')
    expect(result.search_mode).toBe('browse')
    expect(embed).not.toHaveBeenCalled()
  })

  it('reports a timeout without leaking the internal error and keeps a keyword cursor unchanged', async () => {
    const rpc = vi.fn(async () => ({ data: { items: [], next_cursor: null }, error: null }))
    const timeout = new Error('sensitive upstream details')
    timeout.name = 'TimeoutError'
    const result = await hybridSearchActivities({ rpc }, { query: '심리' }, async () => { throw timeout })
    expect(result.fallback_reason).toBe('embedding_timeout')
    expect(JSON.stringify(result)).not.toContain('sensitive upstream details')

    const embed = vi.fn()
    const next = await hybridSearchActivities({ rpc }, { query: '심리', cursor: { mode: 'keyword' } }, embed)
    expect(next.fallback_reason).toBeNull()
    expect(embed).not.toHaveBeenCalled()
  })

  it('marks index coverage failure as unknown instead of pending', async () => {
    const rpc = vi.fn(async (name) => name === 'app_activity_search_index_coverage'
      ? { data: null, error: { message: 'private diagnostic' } }
      : { data: { items: [], next_cursor: null }, error: null })
    const result = await hybridSearchActivities({ rpc }, { query: '심리' }, async () => vector)
    expect(result).toMatchObject({ search_mode: 'hybrid', index_status: 'unknown' })
  })
})
