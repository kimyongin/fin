import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { embedSearchText } from './search-embedding.ts'

const values = Array(1024).fill(0.01)
beforeEach(() => {
  vi.stubGlobal('Deno', { env: { get: (name) => name === 'PINECONE_API_KEY' ? 'local-test-key' : undefined } })
})
afterEach(() => vi.unstubAllGlobals())

describe('Pinecone search embedding', () => {
  it('sends passage purpose without truncation and verifies the dense response', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ model: 'multilingual-e5-large', vector_type: 'dense',
        data: [{ values }], usage: { total_tokens: 7 } }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await embedSearchText('가나다', 'passage')).toHaveLength(1024)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.pinecone.io/embed')
    expect(options.headers).toMatchObject({ 'X-Pinecone-Api-Version': '2025-10' })
    expect(JSON.parse(options.body)).toMatchObject({
      model: 'multilingual-e5-large', inputs: [{ text: '가나다' }],
      parameters: { input_type: 'passage', truncate: 'NONE' },
    })
  })

  it('uses the query purpose for questions', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ model: 'multilingual-e5-large', vector_type: 'dense',
        data: [{ values }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    await embedSearchText('심리', 'query')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).parameters.input_type).toBe('query')
  })

  it('rejects a wrong dimension or zero vector', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ model: 'multilingual-e5-large', vector_type: 'dense',
        data: [{ values: [1, 2] }] }),
    })))
    await expect(embedSearchText('a', 'passage')).rejects.toThrow('Invalid Pinecone')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ model: 'multilingual-e5-large', vector_type: 'dense',
        data: [{ values: Array(1024).fill(0) }] }),
    })))
    await expect(embedSearchText('a', 'passage')).rejects.toThrow('Invalid Pinecone')
  })

  it('does not expose a provider error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429,
      text: async () => 'sensitive submitted text' })))
    await expect(embedSearchText('sensitive submitted text', 'query'))
      .rejects.toThrow('Pinecone embed HTTP 429')
  })
})
