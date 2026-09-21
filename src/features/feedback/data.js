function unwrap(data, error) {
  if (error) throw error
  return data
}

export async function submitProductFeedback(supabase, { body, context = {}, idempotencyKey }) {
  const { data, error } = await supabase.rpc('app_submit_product_feedback', {
    input_body: body,
    input_context: context,
    input_source: 'app',
    input_idempotency_key: idempotencyKey,
  })
  return unwrap(data, error)
}

export async function fetchMyProductFeedback(supabase, { cursor = null, limit = 20 } = {}) {
  const { data, error } = await supabase.rpc('app_list_my_product_feedback', {
    input_cursor: cursor,
    input_limit: limit,
  })
  const page = unwrap(data, error) ?? {}
  return {
    items: Array.isArray(page.items) ? page.items : [],
    nextCursor: page.next_cursor ?? null,
    isAdmin: Boolean(page.is_admin),
  }
}

export async function fetchProductFeedbackAdmin(supabase, { cursor = null, limit = 20, status = null } = {}) {
  const { data, error } = await supabase.rpc('app_list_product_feedback_admin', {
    input_cursor: cursor,
    input_limit: limit,
    input_status: status,
  })
  const page = unwrap(data, error) ?? {}
  return {
    items: Array.isArray(page.items) ? page.items : [],
    nextCursor: page.next_cursor ?? null,
  }
}

export async function updateProductFeedbackAdmin(supabase, { id, expectedVersion, status, response, githubIssueUrl }) {
  const { data, error } = await supabase.rpc('app_update_product_feedback_admin', {
    input_feedback_id: id,
    input_expected_version: expectedVersion,
    input_status: status,
    input_response: response || null,
    input_github_issue_url: githubIssueUrl || null,
  })
  return unwrap(data, error)
}
