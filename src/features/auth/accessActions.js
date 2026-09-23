import { recordUserActivity } from '../agent/data'
import { portfolioMessages, viewerProfileSavedMessage } from '../portfolio/messages'
import { formatSupabaseError, isViewerSchemaMissingError } from '../../lib/viewerAccess'

export function createAccessActions({
  canEdit, createGuestUnlockDraft, createViewerProfileDraft, guestUnlockDraft, refreshState, session,
  setAuthStatus, setGuestUnlockDraft, setGuestUnlockError, setGuestUnlockSaving, setSession,
  setViewContext, setViewerProfile, setViewerProfileDraft, setViewerProfileError,
  setViewerProfileMessage, setViewerProfileSaving, setViewerProfileSchemaReady,
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

  async function handleSaveViewerProfile() {
    if (!canEdit) return
    setViewerProfileSaving(true)
    setViewerProfileError('')
    setViewerProfileMessage('')
    try {
      const publicName = viewerProfileDraft.public_name.trim()
      const password = viewerProfileDraft.viewer_password.trim()
      if (viewerProfileDraft.sharing_enabled && !publicName) throw new Error(portfolioMessages.viewerPublicNameRequired)
      if (password && password.length < 4) throw new Error(portfolioMessages.viewerPasswordTooShort)
      if (viewerProfileDraft.sharing_enabled && !password && !viewerProfile.viewer_password_updated_at) throw new Error(portfolioMessages.viewerPasswordRequired)

      const { data, error } = await supabase.rpc('set_viewer_profile', {
        input_public_name: publicName,
        input_sharing_enabled: Boolean(viewerProfileDraft.sharing_enabled),
        input_viewer_password: password,
      })
      if (error) throw error
      const nextProfile = createViewerProfileDraft(Array.isArray(data) ? data[0] : data)
      try {
        await recordUserActivity(supabase, {
          actionType: 'update_viewer_profile',
          afterData: {
            password_updated: Boolean(viewerProfileDraft.viewer_password),
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
      setViewerProfile(nextProfile)
      setViewerProfileDraft(nextProfile)
      setViewerProfileMessage(viewerProfileSavedMessage(Boolean(viewerProfileDraft.viewer_password)))
    } catch (error) {
      if (isViewerSchemaMissingError(error)) {
        setViewerProfileSchemaReady(false)
        setViewerProfileError(formatSupabaseError(error, portfolioMessages.viewerProfileSchemaFailed))
      } else setViewerProfileError(error.message ?? portfolioMessages.viewerProfileSaveFailed)
    } finally { setViewerProfileSaving(false) }
  }

  return { handleGuestUnlock, handleSaveViewerProfile, signOut }
}
