export async function fetchPrivateHoldingNotes(supabase) {
  const { data, error } = await supabase.rpc('app_list_private_holding_notes')
  if (error) throw error
  return data?.items ?? []
}

export async function savePrivateHoldingNote(supabase, { instrumentId, accountId = null, expectedNote = null, note = '' }) {
  const { data, error } = await supabase.rpc('app_save_private_holding_note', {
    input_instrument_id: instrumentId,
    input_account_id: accountId,
    input_expected_note: expectedNote,
    input_note: note.trim() || null,
  })
  if (error) throw error
  return data
}
