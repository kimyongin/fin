import { recordUserActivity } from '../agent/data'
import { portfolioMessages } from '../portfolio/messages'
import { formatSupabaseError, isViewerSchemaMissingError } from '../../lib/viewerAccess'
import { fetchViewerProfile } from '../portfolio/data'

export function createAccessActions({
  canEdit, createGuestUnlockDraft, createViewerProfileDraft, guestUnlockDraft, refreshState, session,
  setAuthStatus, setGuestUnlockDraft, setGuestUnlockError, setGuestUnlockSaving, setSession,
  setViewContext, setViewerProfile, setViewerProfileDraft, setViewerProfileError,
  setViewerProfileErrorTarget, setViewerProfileLoaded, setViewerProfileMessage,
  setViewerProfileSaving, setViewerProfileSchemaReady, profileWriteRef,
  supabase, viewerProfile, viewerProfileDraft,
}) {
  async function signOut() {
    setGuestUnlockError('')
    setGuestUnlockDraft(createGuestUnlockDraft())
    setViewContext({ mode: 'owner', ownerUserId: null, ownerPublicName: '' })
    await supabase.auth.signOut()
  }

  async function handleGuestUnlock() {
    setGuestUnlockSaving(true)
    setGuestUnlockError('')
    try {
      let nextSession = session
      if (!nextSession) {
        const { data, error } = await supabase.auth.signInAnonymously()
        if (error) throw error
        nextSession = data.session
      }
      if (!nextSession) throw new Error(portfolioMessages.guestUnlockStartError)

      const { data, error } = await supabase.rpc('unlock_viewer_access', {
        input_public_name: guestUnlockDraft.public_name,
        input_viewer_password: guestUnlockDraft.viewer_password,
      })
      if (error) throw error
      const access = Array.isArray(data) ? data[0] : data
      setViewContext({ mode: 'shared', ownerUserId: access?.owner_user_id ?? null, ownerPublicName: access?.owner_public_name ?? guestUnlockDraft.public_name.trim() })
      await refreshState(access?.owner_user_id ?? null)
      setGuestUnlockDraft(createGuestUnlockDraft())
      if (!session) {
        setSession({ ...nextSession })
        setAuthStatus('signed-in')
      }
    } catch (error) {
      setGuestUnlockError(error.code === 'anonymous_provider_disabled'
        ? portfolioMessages.guestUnlockAnonymousDisabled
        : formatSupabaseError(error, portfolioMessages.guestUnlockFailed))
    } finally { setGuestUnlockSaving(false) }
  }

  async function saveViewerProfile() {
    if (!canEdit || profileWriteRef.current) return
    const publicName = viewerProfileDraft.public_name.trim()
    const password = viewerProfileDraft.viewer_password.trim()
    const sharingEnabled = Boolean(viewerProfileDraft.sharing_enabled)
    const validationError = sharingEnabled && !publicName ? portfolioMessages.viewerPublicNameRequired
      : password && password.length < 4 ? portfolioMessages.viewerPasswordTooShort
        : sharingEnabled && !password && !viewerProfile.viewer_password_updated_at ? portfolioMessages.viewerPasswordRequired : ''
    if (validationError) {
      setViewerProfileErrorTarget(validationError === portfolioMessages.viewerPublicNameRequired ? 'public_name' : 'viewer_password')
      setViewerProfileError(validationError)
      return
    }
    profileWriteRef.current = true
    setViewerProfileSaving(true)
    setViewerProfileError('')
    setViewerProfileMessage('')
    setViewerProfileErrorTarget('credentials')
    try {
      const { data, error } = await supabase.rpc('set_viewer_profile', {
        input_public_name: publicName,
        input_sharing_enabled: sharingEnabled,
        input_share_scope: 'portfolio_all',
        input_viewer_password: password,
      })
      if (error) throw error
      const nextProfile = createViewerProfileDraft(Array.isArray(data) ? data[0] : data)
      try {
        await recordUserActivity(supabase, {
          actionType: 'update_viewer_profile',
          afterData: {
            password_updated: Boolean(password),
            public_name: nextProfile.public_name,
            sharing_enabled: nextProfile.sharing_enabled,
            viewer_password_updated_at: nextProfile.viewer_password_updated_at,
          },
          beforeData: {
            public_name: viewerProfile.public_name,
            sharing_enabled: viewerProfile.sharing_enabled,
            viewer_password_updated_at: viewerProfile.viewer_password_updated_at,
          },
          targetId: session.user.id,
          targetTable: 'profiles',
        })
      } catch { /* Activity logging should never block the profile edit. */ }
      setViewerProfileSchemaReady(true)
      setViewerProfileLoaded(true)
      setViewerProfile((current) => ({ ...current, ...nextProfile, avatar_key: current.avatar_key }))
      setViewerProfileDraft((current) => ({
        ...current, public_name: nextProfile.public_name, sharing_enabled: nextProfile.sharing_enabled,
        viewer_password: '', viewer_password_updated_at: nextProfile.viewer_password_updated_at,
      }))
      setViewerProfileMessage('공유 설정을 저장했습니다.')
    } catch (error) {
      if (isViewerSchemaMissingError(error)) {
        setViewerProfileSchemaReady(false)
      }
      try {
        const actual = createViewerProfileDraft(await fetchViewerProfile(supabase))
        setViewerProfileLoaded(true)
        setViewerProfile((current) => ({ ...current, ...actual, avatar_key: current.avatar_key }))
        setViewerProfileError(formatSupabaseError(error, portfolioMessages.viewerProfileSaveFailed))
      } catch {
        setViewerProfileLoaded(false)
        setViewerProfileError('저장 결과를 확인하지 못했습니다. 다시 조회해 주세요.')
      }
    } finally {
      profileWriteRef.current = false
      setViewerProfileSaving(false)
    }
  }

  return {
    handleGuestUnlock,
    handleSaveViewerProfile: saveViewerProfile,
    signOut,
  }
}
