import { useEffect } from 'react'
import { createEmptyPortfolioState, createOwnerViewContext } from './data'

export function usePortfolioBootstrap({
  createViewerProfileDraft,
  guestUnlockSaving,
  loadActiveViewerAccess,
  loadFriends,
  loadViewerProfile,
  refreshState,
  session,
  setGuestUnlockError,
  setLoadError,
  setState,
  setViewContext,
  setViewerProfile,
  setViewerProfileDraft,
}) {
  useEffect(() => {
    if (!session) {
      setViewContext(createOwnerViewContext())
      setState(createEmptyPortfolioState())
      setViewerProfile(createViewerProfileDraft())
      setViewerProfileDraft(createViewerProfileDraft())
      return
    }

    let cancelled = false

    async function bootstrapSession() {
      setLoadError('')

      if (session.user?.is_anonymous) {
        if (guestUnlockSaving) return
        setViewerProfile(createViewerProfileDraft())
        setViewerProfileDraft(createViewerProfileDraft())
        let access = await loadActiveViewerAccess()
        if (cancelled) return

        if (!access?.owner_user_id) {
          await new Promise((resolve) => window.setTimeout(resolve, 100))
          access = await loadActiveViewerAccess()
          if (cancelled) return
        }

        if (!access?.owner_user_id) {
          setGuestUnlockError('')
          setViewContext({ mode: 'guest', ownerUserId: null, ownerPublicName: '' })
          setState(createEmptyPortfolioState())
          return
        }

        setViewContext({
          mode: 'shared',
          ownerUserId: access.owner_user_id,
          ownerPublicName: access.owner_public_name ?? '',
        })
        await refreshState(access.owner_user_id)
        return
      }

      setViewContext(createOwnerViewContext(session.user.id))
      await Promise.all([refreshState(), loadViewerProfile(), loadFriends?.()])
    }

    bootstrapSession().catch((error) => {
      if (!cancelled) {
        setLoadError(error.message ?? String(error))
      }
    })

    return () => {
      cancelled = true
    }
  }, [
    createViewerProfileDraft,
    guestUnlockSaving,
    loadActiveViewerAccess,
    loadFriends,
    loadViewerProfile,
    refreshState,
    session,
    setGuestUnlockError,
    setLoadError,
    setState,
    setViewContext,
    setViewerProfile,
    setViewerProfileDraft,
  ])
}
