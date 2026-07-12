export async function fetchRecentAgentActions(supabase, limit = 10) {
  const { data, error } = await supabase.rpc('app_list_recent_activity', {
    limit_count: limit,
  })

  if (error) throw error
  return data ?? []
}

export async function recordUserActivity(
  supabase,
  { actionType, targetTable = null, targetId = null, beforeData = null, afterData = null },
) {
  const { error } = await supabase.rpc('activity_record_user_event', {
    input_action_type: actionType,
    input_target_table: targetTable,
    input_target_id: targetId == null ? null : String(targetId),
    input_before_data: beforeData,
    input_after_data: afterData,
  })

  if (error) throw error
}

export async function fetchAgentTokens(supabase) {
  const { data, error } = await supabase.rpc('agent_list_tokens')

  if (error) throw error
  return data ?? []
}

export async function createAgentToken(supabase, { name, tokenHash, tokenPrefix }) {
  const { data, error } = await supabase.rpc('agent_create_token', {
    input_name: name,
    input_token_hash: tokenHash,
    input_token_prefix: tokenPrefix,
  })

  if (error) throw error
  return Array.isArray(data) ? data[0] ?? null : data
}

export async function revokeAgentToken(supabase, tokenId) {
  const { data, error } = await supabase.rpc('agent_revoke_token', {
    input_token_id: tokenId,
  })

  if (error) throw error
  return Array.isArray(data) ? data[0] ?? null : data
}
