export function createEmptyNewsState() {
  return { facts: [] }
}

export async function fetchNewsState(supabase, ownerUserId = null) {
  const { data, error } = await supabase.rpc('app_get_news_state', {
    input_owner_user_id: ownerUserId,
  })
  if (error) throw error
  return { ...createEmptyNewsState(), ...(data ?? {}) }
}

export async function saveNewsFact(supabase, draft) {
  const { data, error } = await supabase.rpc('app_save_news_fact', {
    input_fact_date: draft.fact_date,
    input_country_code: draft.country_code,
    input_axis: draft.axis,
    input_title: draft.title.trim(),
    input_source_name: draft.source_name.trim(),
    input_source_url: draft.source_url.trim(),
    input_body: draft.body.trim(),
  })
  if (error) throw error
  return Array.isArray(data) ? data[0] : data
}

export async function saveNewsFactAnnotation(supabase, draft) {
  const { error } = await supabase.rpc('app_save_news_fact_annotation', {
    input_fact_id: Number(draft.fact_id),
    input_signal: draft.signal,
    input_body: draft.body.trim(),
  })
  if (error) throw error
}

export async function deleteNewsFact(supabase, factId) {
  const { error } = await supabase.rpc('app_delete_news_fact', { input_fact_id: Number(factId) })
  if (error) throw error
}

export async function deleteNewsFactAnnotation(supabase, annotationId) {
  const { error } = await supabase.rpc('app_delete_news_fact_annotation', { input_annotation_id: Number(annotationId) })
  if (error) throw error
}

export async function updateNewsFact(supabase, draft) {
  const { error } = await supabase.rpc('app_update_news_fact', {
    input_fact_id: Number(draft.id),
    input_country_code: draft.country_code,
    input_body: draft.body.trim(),
  })
  if (error) throw error
}
