import { describe, expect, it, vi } from 'vitest'
import { createAccessActions } from './accessActions'
import { createGuestUnlockDraft, createViewerProfileDraft } from '../../lib/viewerAccess'

function params(overrides = {}) {
  return {
    canEdit: true, createGuestUnlockDraft, createViewerProfileDraft,
    guestUnlockDraft: { public_name: 'friend', viewer_password: 'secret' },
    refreshState: vi.fn(async () => {}), session: { user: { id: 'guest', is_anonymous: true } },
    setAuthStatus: vi.fn(), setGuestUnlockDraft: vi.fn(), setGuestUnlockError: vi.fn(),
    setGuestUnlockSaving: vi.fn(), setSession: vi.fn(), setViewContext: vi.fn(),
    setViewerProfile: vi.fn(), setViewerProfileDraft: vi.fn(), setViewerProfileError: vi.fn(),
    setViewerProfileMessage: vi.fn(), setViewerProfileSaving: vi.fn(), setViewerProfileSchemaReady: vi.fn(),
    supabase: {
      auth: { signOut: vi.fn(async () => {}), signInAnonymously: vi.fn(async () => ({ data: { session: { user: { id: 'anon' } } }, error: null })) },
      rpc: vi.fn(async (name) => name === 'unlock_viewer_access'
        ? { data: { owner_user_id: 'owner-1', owner_public_name: 'friend' }, error: null }
        : { data: null, error: null }),
    },
    viewerProfile: createViewerProfileDraft(), viewerProfileDraft: createViewerProfileDraft(),
    ...overrides,
  }
}

describe('access actions', () => {
  it('loads the unlocked owner portfolio after a guest enters shared view', async () => {
    const input = params()
    await createAccessActions(input).handleGuestUnlock()
    expect(input.refreshState).toHaveBeenCalledWith('owner-1')
    expect(input.setViewContext).toHaveBeenCalledWith({ mode: 'shared', ownerUserId: 'owner-1', ownerPublicName: 'friend' })
  })

  it('resets guest state on sign out', async () => {
    const input = params()
    await createAccessActions(input).signOut()
    expect(input.setGuestUnlockDraft).toHaveBeenCalledWith(createGuestUnlockDraft())
    expect(input.setViewContext).toHaveBeenCalledWith({ mode: 'owner', ownerUserId: null, ownerPublicName: '' })
    expect(input.supabase.auth.signOut).toHaveBeenCalledOnce()
  })

  it('saves the sharing profile without requiring asset editor state', async () => {
    const input = params({
      session: { user: { id: 'owner-1' } },
      viewerProfileDraft: { public_name: 'owner', viewer_password: 'secret', sharing_enabled: true },
    })
    input.supabase.rpc = vi.fn(async (name) => name === 'set_viewer_profile'
      ? { data: { public_name: 'owner', sharing_enabled: true, viewer_password_updated_at: '2026-09-23' }, error: null }
      : { data: null, error: null })
    await createAccessActions(input).handleSaveViewerProfile()
    expect(input.supabase.rpc).toHaveBeenCalledWith('set_viewer_profile', {
      input_public_name: 'owner', input_sharing_enabled: true, input_viewer_password: 'secret',
    })
    expect(input.setViewerProfileSchemaReady).toHaveBeenCalledWith(true)
    expect(input.setViewerProfile).toHaveBeenCalledWith(expect.objectContaining({ public_name: 'owner' }))
  })

  it('rejects an invalid guest password without switching owners', async () => {
    const input = params()
    input.supabase.rpc = vi.fn(async () => ({ data: null, error: { message: '비밀번호가 다릅니다.' } }))
    await createAccessActions(input).handleGuestUnlock()
    expect(input.setGuestUnlockError).toHaveBeenCalledWith(expect.stringContaining('비밀번호가 다릅니다.'))
    expect(input.setViewContext).not.toHaveBeenCalled()
  })
})
