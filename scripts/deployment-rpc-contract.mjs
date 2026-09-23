// PostgREST exposes callable RPC argument names in its read-only OpenAPI document.
export const requiredMutationSignatures = {
  app_create_activity_with_tags: ['input_idempotency_key', 'input_payload', 'input_tag_ids'],
  app_create_general_task_with_tags: ['input_idempotency_key', 'input_payload', 'input_tag_ids'],
  app_save_principle: ['input_body', 'input_end', 'input_expected_row_id', 'input_kind', 'input_principle_id', 'input_scope'],
  app_set_activity_tags: ['input_activity_id', 'input_expected_version', 'input_idempotency_key', 'input_tag_ids'],
  app_transition_general_task: ['input_action', 'input_authored_via', 'input_expected_version', 'input_idempotency_key', 'input_occurrence_on', 'input_reason', 'input_result', 'input_task_id'],
}

export function assertMutationRpcSignatures(document, required = requiredMutationSignatures) {
  for (const [name, expected] of Object.entries(required)) {
    const operation = document?.paths?.[`/rpc/${name}`]?.post
    if (!operation) throw new Error(`${name} RPC is missing from the authenticated PostgREST schema cache`)
    const body = operation.parameters?.find((parameter) => parameter.in === 'body' && parameter.name === 'args')
    const actual = Object.keys(body?.schema?.properties ?? {}).sort()
    const wanted = [...expected].sort()
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      throw new Error(`${name} RPC input signature mismatch (expected: ${wanted.join(', ')}; found: ${actual.join(', ') || 'none'})`)
    }
  }
  return Object.keys(required).length
}
