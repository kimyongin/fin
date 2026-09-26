// PostgREST exposes callable RPC argument names in its read-only OpenAPI document.
export const requiredMutationSignatures = {
  app_create_activity_with_tags: ['input_idempotency_key', 'input_payload', 'input_tag_ids'],
  app_create_general_task_with_tags: ['input_idempotency_key', 'input_payload', 'input_tag_ids'],
  app_save_principle: ['input_body', 'input_change_note', 'input_end', 'input_expected_row_id', 'input_principle_id'],
  app_save_principle_checked: ['input_body', 'input_change_note', 'input_expected_body', 'input_expected_change_note', 'input_expected_row_id', 'input_principle_id'],
  app_correct_principle_row: ['input_body', 'input_change_note', 'input_expected_body', 'input_expected_change_note', 'input_row_id'],
  app_delete_principle_row: ['input_expected_body', 'input_expected_change_note', 'input_expected_current_row_id', 'input_row_id'],
  app_save_allocation_targets: ['input_expected_targets', 'input_targets'],
  app_clear_allocation_targets: ['input_expected_targets'],
  app_get_my_product_feedback: ['input_feedback_id'],
  app_update_my_product_feedback: ['input_body', 'input_expected_version', 'input_feedback_id'],
  app_delete_my_product_feedback: ['input_expected_version', 'input_feedback_id'],
  app_set_activity_tags: ['input_activity_id', 'input_expected_version', 'input_idempotency_key', 'input_tag_ids'],
  app_save_activity_detail: ['input_activity_id', 'input_authored_via', 'input_expected_version', 'input_idempotency_key', 'input_patch', 'input_tag_ids'],
  app_save_general_task_detail: ['input_expected_version', 'input_idempotency_key', 'input_payload', 'input_tag_ids', 'input_task_id'],
  app_delete_general_task: ['input_expected_version', 'input_idempotency_key', 'input_task_id'],
  app_delete_holding_checked: ['input_expected_version', 'input_holding_id', 'input_idempotency_key'],
  app_save_sharing_profile: ['input_public_name', 'input_sharing_enabled', 'input_viewer_password'],
  app_reset_sharing_profile: [],
  app_set_profile_avatar: ['input_avatar_key'],
  app_create_instrument: ['input_currency', 'input_display_name', 'input_instrument_type', 'input_note', 'input_tag_id', 'input_ticker'],
  app_save_asset_detail_current: ['input_expected', 'input_holdings', 'input_idempotency_key', 'input_instrument', 'input_instrument_id', 'input_reason'],
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
