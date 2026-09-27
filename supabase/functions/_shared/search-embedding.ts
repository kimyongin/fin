export const SEARCH_EMBEDDING_MODEL = 'multilingual-e5-large'
export const SEARCH_EMBEDDING_DIMENSIONS = 1024
export const SEARCH_PIPELINE = 'pinecone-e5-context-v1'

export async function embedSearchText(text: string, inputType: 'passage' | 'query'): Promise<number[]> {
  const key = Deno.env.get('PINECONE_API_KEY')
  if (!key) throw new Error('Pinecone search embedding is not configured')
  const startedAt = Date.now()
  const response = await fetch('https://api.pinecone.io/embed', {
    method: 'POST',
    headers: {
      'Api-Key': key,
      'X-Pinecone-Api-Version': '2025-10',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: SEARCH_EMBEDDING_MODEL,
      inputs: [{ text }],
      parameters: { input_type: inputType, truncate: 'NONE' },
    }),
    signal: AbortSignal.timeout(8000),
  })
  // Provider error bodies can include submitted text. Keep them out of logs.
  if (!response.ok) throw new Error(`Pinecone embed HTTP ${response.status}`)
  const result = await response.json()
  const values = result?.data?.[0]?.values
  if (result?.model !== SEARCH_EMBEDDING_MODEL || result?.vector_type !== 'dense' ||
      !Array.isArray(result?.data) || result.data.length !== 1 ||
      !Array.isArray(values) || values.length !== SEARCH_EMBEDDING_DIMENSIONS ||
      values.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value)) ||
      values.every((value: number) => value === 0)) {
    throw new Error('Invalid Pinecone search embedding')
  }
  console.info('Pinecone embedding usage', {
    input_type: inputType,
    tokens: Number(result?.usage?.total_tokens) || 0,
    elapsed_ms: Date.now() - startedAt,
  })
  return values
}
