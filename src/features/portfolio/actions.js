import { formatSupabaseError, isViewerSchemaMissingError } from '../../lib/viewerAccess'
import { recordUserActivity } from '../agent/data'
import { createAccountActions } from './accountActions'
import { createHoldingActions } from './holdingActions'
import { createInstrumentActions } from './instrumentActions'
import {
  createAccountModalDraft,
  createHoldingModalDraft,
  createInstrumentModalDraft,
  createTagModalDraft,
} from './helpers'
import { portfolioMessages, viewerProfileSavedMessage } from './messages'
import { createTagActions } from './tagActions'

function createRpcCaller(supabase) {
  return async function callRpc(name, args) {
    const { data, error } = await supabase.rpc(name, args)
    if (error) throw error
    return data
  }
}

export function createPortfolioActions(params) {
  const {
    accountModal,
    canEdit,
    createGuestUnlockDraft,
    createViewerProfileDraft,
    guestUnlockDraft,
    holdingLookupResult,
    holdingModal,
    holdingsByAccountId,
    holdingsByTicker,
    instrumentModal,
    latestPriceByTicker,
    refreshState,
    session,
    setAccountError,
    setAccountModal,
    setAccountSaving,
    setAuthStatus,
    setGuestUnlockDraft,
    setGuestUnlockError,
    setGuestUnlockSaving,
    setHoldingError,
    setHoldingLookupError,
    setHoldingLookupResult,
    setHoldingLookupSaving,
    setHoldingModal,
    setHoldingSaving,
    setInstrumentError,
    setInstrumentModal,
    setInstrumentSaving,
    setSession,
    setSyncMessage,
    setSyncingPrices,
    setTagError,
    setTagModal,
    setTagSaving,
    setViewContext,
    setViewerProfile,
    setViewerProfileDraft,
    setViewerProfileError,
    setViewerProfileMessage,
    setViewerProfileSaving,
    setViewerProfileSchemaReady,
    state,
    supabase,
    tagMapByTicker,
    tagModal,
    today,
    viewerProfile,
    viewerProfileDraft,
  } = params
  const callRpc = createRpcCaller(supabase)

  async function recordActivity(event) {
    try {
      await recordUserActivity(supabase, event)
    } catch {
      // Activity logging should never block the portfolio edit itself.
    }
  }

  async function signOut() {
    setGuestUnlockError('')
    setGuestUnlockDraft(createGuestUnlockDraft())
    setViewContext({ mode: 'owner', ownerUserId: null, ownerPublicName: '' })
    await supabase.auth.signOut()
  }

  function openAccount(account = null) {
    if (!canEdit) return
    setAccountError('')
    setAccountModal(createAccountModalDraft(account))
  }

  function openInstrument(instrument = null) {
    if (!canEdit) return
    const latestPrice = instrument?.ticker ? latestPriceByTicker.get(instrument.ticker) : null
    const tagId = instrument?.ticker ? tagMapByTicker.get(instrument.ticker)?.id ?? '' : ''
    setInstrumentError('')
    setInstrumentModal(createInstrumentModalDraft({ instrument, latestPrice, tagId }))
  }

  function openHolding(options = {}) {
    if (!canEdit) return
    setHoldingError('')
    setHoldingLookupError('')
    const { draft, lookupResult } = createHoldingModalDraft({
      ...options,
      instruments: state.instruments,
      latestPriceByTicker,
    })
    setHoldingLookupResult(lookupResult)
    setHoldingModal(draft)
  }

  function openTag(tag = null) {
    if (!canEdit) return
    setTagError('')
    setTagModal(createTagModalDraft({ nextSortOrder: state.tags.length, tag, tags: state.tags }))
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
      setViewContext({
        mode: 'shared',
        ownerUserId: access?.owner_user_id ?? null,
        ownerPublicName: access?.owner_public_name ?? guestUnlockDraft.public_name.trim(),
      })
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
    } finally {
      setGuestUnlockSaving(false)
    }
  }

  async function handleSyncPrices() {
    if (!canEdit) return
    setSyncingPrices(true)
    setSyncMessage('')
    try {
      const { error } = await supabase.functions.invoke('sync-prices', { body: {} })
      if (error) throw error
      await refreshState()
      await recordActivity({ actionType: 'sync_prices', targetTable: 'holding_prices_daily' })
      setSyncMessage(portfolioMessages.syncPricesSuccess)
    } catch (error) {
      setSyncMessage(error.message ?? portfolioMessages.syncPricesFailed)
    } finally {
      setSyncingPrices(false)
    }
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

      const data = await callRpc('set_viewer_profile', {
        input_public_name: publicName,
        input_sharing_enabled: Boolean(viewerProfileDraft.sharing_enabled),
        input_viewer_password: password,
      })
      const nextProfile = createViewerProfileDraft(Array.isArray(data) ? data[0] : data)
      await recordActivity({
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
      setViewerProfileSchemaReady(true)
      setViewerProfile(nextProfile)
      setViewerProfileDraft(nextProfile)
      setViewerProfileMessage(viewerProfileSavedMessage(Boolean(viewerProfileDraft.viewer_password)))
    } catch (error) {
      if (isViewerSchemaMissingError(error)) {
        setViewerProfileSchemaReady(false)
        setViewerProfileError(formatSupabaseError(error, portfolioMessages.viewerProfileSchemaFailed))
      } else setViewerProfileError(error.message ?? portfolioMessages.viewerProfileSaveFailed)
    } finally {
      setViewerProfileSaving(false)
    }
  }

  return {
    ...createAccountActions({ accountModal, callRpc, canEdit, holdingsByAccountId, refreshState, setAccountError, setAccountModal, setAccountSaving }),
    ...createHoldingActions({ callRpc, canEdit, holdingLookupResult, holdingModal, latestPriceByTicker, refreshState, setHoldingError, setHoldingLookupError, setHoldingLookupResult, setHoldingLookupSaving, setHoldingModal, setHoldingSaving, state, supabase }),
    ...createInstrumentActions({ callRpc, canEdit, holdingsByTicker, instrumentModal, openHolding, refreshState, setInstrumentError, setInstrumentModal, setInstrumentSaving, today }),
    ...createTagActions({ callRpc, canEdit, refreshState, setTagError, setTagModal, setTagSaving, tagModal }),
    handleGuestUnlock,
    handleSaveViewerProfile,
    handleSyncPrices,
    openAccount,
    openHolding,
    openInstrument,
    openTag,
    signOut,
  }
}
