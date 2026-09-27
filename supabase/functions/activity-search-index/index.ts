import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

import { embedSearchText, SEARCH_EMBEDDING_MODEL } from '../_shared/search-embedding.ts'

type SearchJob = {
  user_id: string
  record_type: 'activity' | 'task'
  record_id: string
  chunk_no: number
  content_hash: string
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!key || request.headers.get('Authorization') !== `Bearer ${key}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  try {
    const body = await request.json()
    if (body.kind === 'query') {
      if (typeof body.query !== 'string' || !body.query.trim() || body.query.length > 500) {
        return new Response('Invalid query', { status: 400 })
      }
      const embedding = await embedSearchText(body.query.slice(0, 400))
      return Response.json({ model: SEARCH_EMBEDDING_MODEL, embedding })
    }
    const job = body.job as SearchJob
    const messageId = Number(body.message_id)
    if (!job || !Number.isSafeInteger(messageId) || messageId < 1 ||
        !['activity', 'task'].includes(job.record_type) ||
        typeof job.record_id !== 'string' || typeof job.content_hash !== 'string' ||
        !Number.isInteger(job.chunk_no) || job.chunk_no < 0) {
      return new Response('Invalid job', { status: 400 })
    }
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, key)
    const { data: source, error: sourceError } = await supabase.rpc('app_get_activity_search_job', {
      input_record_type: job.record_type,
      input_record_id: job.record_id,
      input_chunk_no: job.chunk_no,
      input_content_hash: job.content_hash,
    })
    if (sourceError) throw sourceError
    if (source?.stale) {
      const { error } = await supabase.rpc('app_ack_stale_activity_search_job', { input_message_id: messageId })
      if (error) throw error
      return Response.json({ stale: true })
    }
    const excerpt = String(source?.excerpt ?? '')
    const embedding = await embedSearchText(excerpt)
    const { error } = await supabase.rpc('app_finish_activity_search_job', {
      input_message_id: messageId,
      input_user_id: source.user_id,
      input_record_type: job.record_type,
      input_record_id: job.record_id,
      input_chunk_no: job.chunk_no,
      input_content_hash: job.content_hash,
      input_excerpt: excerpt,
      input_embedding: JSON.stringify(embedding),
    })
    if (error) throw error
    return Response.json({ indexed: true })
  } catch (error) {
    console.error('activity search index failed', (error as Error).message)
    return Response.json({ error: 'Indexing failed' }, { status: 500 })
  }
})
