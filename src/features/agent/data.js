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
