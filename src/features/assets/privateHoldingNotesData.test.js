import { describe, expect, it, vi } from 'vitest'
import { fetchPrivateHoldingNotes, savePrivateHoldingNote } from './privateHoldingNotesData'

describe('private holding note data adapter', () => {
  it('reads only the owner note RPC and keeps read failures visible', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { items: [] }, error: null }) }
    await expect(fetchPrivateHoldingNotes(supabase)).resolves.toEqual([])
    expect(supabase.rpc).toHaveBeenCalledWith('app_list_private_holding_notes')
    supabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('read failed') })
    await expect(fetchPrivateHoldingNotes(supabase)).rejects.toThrow('read failed')
  })

  it('saves the chosen scope without touching financial or public note fields', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: { note: '새 이유' }, error: null }) }
    await expect(savePrivateHoldingNote(supabase, {
      instrumentId: 7, accountId: 3, expectedNote: '기존 이유', note: ' 새 이유 ',
    })).resolves.toEqual({ note: '새 이유' })
    expect(supabase.rpc).toHaveBeenCalledWith('app_save_private_holding_note', {
      input_instrument_id: 7, input_account_id: 3,
      input_expected_note: '기존 이유', input_note: '새 이유',
    })
  })
})
