declare const Supabase: {
  ai: {
    Session: new (model: string) => {
      run(input: string, options: { mean_pool: boolean; normalize: boolean }): Promise<number[]>
    }
  }
}

// Query and document vectors use one provider. A future model with another
// dimension needs a new vector column/index and a backfill.
export const SEARCH_EMBEDDING_MODEL = 'gte-small'

export async function embedSearchText(text: string): Promise<number[]> {
  const session = new Supabase.ai.Session(SEARCH_EMBEDDING_MODEL)
  const embedding = await session.run(text, { mean_pool: true, normalize: true })
  if (!Array.isArray(embedding) || embedding.length !== 384 ||
      embedding.some((value) => !Number.isFinite(value))) {
    throw new Error('Invalid search embedding')
  }
  return embedding
}
