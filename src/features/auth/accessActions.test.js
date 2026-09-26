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
    setViewerProfileErrorTarget: vi.fn(), setViewerProfileLoaded: vi.fn(),
    setViewerProfileMessage: vi.fn(), setViewerProfileSaving: vi.fn(), setViewerProfileSchemaReady: vi.fn(),
    profileWriteRef: { current: false },
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
      viewerProfileDraft: { public_name: 'owner', viewer_password: 'secret', sharing_enabled: false },
    })
    input.supabase.rpc = vi.fn(async (name) => name === 'app_save_sharing_profile'
      ? { data: { public_name: 'owner', sharing_enabled: false, viewer_password_updated_at: '2026-09-23' }, error: null }
      : { data: null, error: null })
    await createAccessActions(input).handleSaveViewerProfile()
    expect(input.supabase.rpc).toHaveBeenCalledWith('app_save_sharing_profile', {
      input_public_name: 'owner', input_sharing_enabled: false, input_viewer_password: 'secret',
    })
    expect(input.setViewerProfileSchemaReady).toHaveBeenCalledWith(true)
    expect(input.setViewerProfile.mock.calls.at(-1)[0](createViewerProfileDraft()).public_name).toBe('owner')
  })

  it('enables sharing with the initial name and password in one write', async () => {
    const input = params({
      session: { user: { id: 'owner-1' } },
      viewerProfileDraft: { ...createViewerProfileDraft(), public_name: 'owner', viewer_password: 'secret', sharing_enabled: true },
    })
    input.supabase.rpc = vi.fn(async () => ({ data: { public_name: 'owner', sharing_enabled: true, viewer_password_updated_at: '2026-09-26' }, error: null }))
    await createAccessActions(input).handleSaveViewerProfile()
    expect(input.supabase.rpc).toHaveBeenCalledWith('app_save_sharing_profile', {
      input_public_name: 'owner', input_sharing_enabled: true, input_viewer_password: 'secret',
    })
    expect(input.setViewerProfileDraft.mock.calls.at(-1)[0](input.viewerProfileDraft)).toMatchObject({ sharing_enabled: true, viewer_password: '' })
  })

  it('saves the draft name, password and sharing together without saving avatar', async () => {
    const input = params({
      session: { user: { id: 'owner-1' } },
      viewerProfile: { public_name: 'saved-name', sharing_enabled: true, viewer_password_updated_at: '2026-09-23', avatar_key: 'bear' },
      viewerProfileDraft: { public_name: 'new-name', viewer_password: 'new-password', sharing_enabled: false, avatar_key: 'fox' },
    })
    input.supabase.rpc = vi.fn(async () => ({ data: { public_name: 'saved-name', sharing_enabled: false, viewer_password_updated_at: '2026-09-23' }, error: null }))
    await createAccessActions(input).handleSaveViewerProfile()
    expect(input.supabase.rpc).toHaveBeenCalledWith('app_save_sharing_profile', {
      input_public_name: 'new-name', input_sharing_enabled: false, input_viewer_password: 'new-password',
    })
    const mergeDraft = input.setViewerProfileDraft.mock.calls.at(-1)[0]
    expect(mergeDraft(input.viewerProfileDraft)).toMatchObject({ public_name: 'saved-name', viewer_password: '', avatar_key: 'fox', sharing_enabled: false })
  })

  it('requires credentials only when enabling sharing', async () => {
    const input = params({ viewerProfileDraft: { ...createViewerProfileDraft(), sharing_enabled: true } })
    await createAccessActions(input).handleSaveViewerProfile()
    expect(input.supabase.rpc).not.toHaveBeenCalled()
    expect(input.setViewerProfileError).toHaveBeenCalledWith(expect.stringContaining('공개 이름'))
  })

  it('allows switching sharing off without creating credentials', async () => {
    const input = params({ viewerProfileDraft: createViewerProfileDraft() })
    input.supabase.rpc = vi.fn(async () => ({ data: { public_name: null, sharing_enabled: false }, error: null }))
    await createAccessActions(input).handleSaveViewerProfile()
    expect(input.supabase.rpc).toHaveBeenCalledWith('app_save_sharing_profile', {
      input_public_name: '', input_sharing_enabled: false, input_viewer_password: '',
    })
  })

  it('re-reads the saved state after an uncertain sharing response without retrying the write', async () => {
    const input = params({
      session: { user: { id: 'owner-1' } },
      viewerProfile: { public_name: 'owner', sharing_enabled: false, viewer_password_updated_at: '2026-09-23' },
      viewerProfileDraft: { public_name: 'owner', sharing_enabled: true, viewer_password: '', avatar_key: 'bear' },
    })
    input.supabase.rpc = vi.fn(async (name) => name === 'app_get_sharing_profile'
      ? { data: { public_name: 'owner', sharing_enabled: true, viewer_password_updated_at: '2026-09-23' }, error: null }
      : { data: null, error: { message: 'network error' } })
    await createAccessActions(input).handleSaveViewerProfile()
    expect(input.supabase.rpc).toHaveBeenCalledTimes(2)
    expect(input.setViewerProfile).toHaveBeenCalledWith(expect.any(Function))
    expect(input.setViewerProfile.mock.calls.at(-1)[0](input.viewerProfile).sharing_enabled).toBe(true)
    expect(input.setViewerProfileDraft).not.toHaveBeenCalled()
  })

  it('resets sharing through the safe RPC and clears the local draft', async () => {
    const input = params({
      viewerProfile: { public_name: 'owner', sharing_enabled: true, viewer_password_updated_at: '2026-09-26', avatar_key: 'fox' },
    })
    input.supabase.rpc = vi.fn(async () => ({ data: { public_name: null, sharing_enabled: false, viewer_password_updated_at: null, avatar_key: 'fox' }, error: null }))
    await createAccessActions(input).handleResetViewerProfile()
    expect(input.supabase.rpc).toHaveBeenCalledWith('app_reset_sharing_profile')
    expect(input.setViewerProfile).toHaveBeenCalledWith(expect.objectContaining({ public_name: '', sharing_enabled: false, avatar_key: 'fox' }))
    expect(input.setViewerProfileDraft).toHaveBeenCalledWith(expect.objectContaining({ viewer_password: '', sharing_enabled: false }))
  })

  it('rejects an invalid guest password without switching owners', async () => {
    const input = params()
    input.supabase.rpc = vi.fn(async () => ({ data: null, error: { message: '비밀번호가 다릅니다.' } }))
    await createAccessActions(input).handleGuestUnlock()
    expect(input.setGuestUnlockError).toHaveBeenCalledWith(expect.stringContaining('비밀번호가 다릅니다.'))
    expect(input.setViewContext).not.toHaveBeenCalled()
  })
})
