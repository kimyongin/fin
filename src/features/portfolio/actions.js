import { formatFunctionInvokeError, formatSupabaseError, isViewerSchemaMissingError } from '../../lib/viewerAccess'
import { recordUserActivity } from '../agent/data'
import {
  createHoldingLookupResult,
  createHoldingModalDraft,
  createAccountModalDraft,
  createInstrumentModalDraft,
  createTagModalDraft,
} from './helpers'
import { portfolioMessages, viewerProfileSavedMessage } from './messages'

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
    loadActiveViewerAccess,
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

  async function recordActivity(event) {
    try {
      await recordUserActivity(supabase, event)
    } catch {
      // Activity logging should never block the portfolio edit itself.
    }
  }

  async function callRpc(name, args) {
    const { data, error } = await supabase.rpc(name, args)
    if (error) throw error
    return data
  }

  function draftId(draft) {
    return draft?.id ? Number(draft.id) : null
  }

  async function signOut() {
    setGuestUnlockError('')
    setGuestUnlockDraft(createGuestUnlockDraft())
    setViewContext({
      mode: 'owner',
      ownerUserId: null,
      ownerPublicName: '',
    })
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
    setTagModal(createTagModalDraft({ nextSortOrder: state.tags.length, tag }))
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
        setSession(data.session ?? null)
        setAuthStatus(data.session ? 'signed-in' : 'signed-out')
      }

      if (!nextSession) {
        throw new Error(portfolioMessages.guestUnlockStartError)
      }

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
      await refreshState()
      setGuestUnlockDraft(createGuestUnlockDraft())
    } catch (error) {
      if (error.code === 'anonymous_provider_disabled') {
        setGuestUnlockError(portfolioMessages.guestUnlockAnonymousDisabled)
      } else {
        setGuestUnlockError(formatSupabaseError(error, portfolioMessages.guestUnlockFailed))
      }
    } finally {
      setGuestUnlockSaving(false)
    }
  }

  async function handleSaveAccount() {
    if (!canEdit || !accountModal) return

    const payload = {
      name: accountModal.name.trim(),
      broker: accountModal.broker.trim() || null,
      note: accountModal.note.trim() || null,
      is_active: true,
    }

    if (!payload.name) {
      setAccountError(portfolioMessages.accountNameRequired)
      return
    }

    setAccountSaving(true)
    setAccountError('')
    try {
      await callRpc('app_save_account', {
        input_account_id: draftId(accountModal),
        input_name: payload.name,
        input_broker: payload.broker,
        input_note: payload.note,
        input_source: 'user',
        input_request: null,
      })
      await refreshState()
      setAccountModal(null)
    } catch (error) {
      setAccountError(error.message)
    } finally {
      setAccountSaving(false)
    }
  }

  async function handleDeleteAccount() {
    if (!canEdit || !accountModal?.id) return

    const holdingCount = holdingsByAccountId.get(accountModal.id)?.length ?? 0
    if (holdingCount > 0) {
      setAccountError(portfolioMessages.accountDeleteBlocked)
      return
    }

    setAccountSaving(true)
    setAccountError('')
    try {
      await callRpc('app_delete_account', {
        input_account_id: Number(accountModal.id),
        input_source: 'user',
        input_request: null,
      })
      await refreshState()
      setAccountModal(null)
    } catch (error) {
      setAccountError(error.message)
    } finally {
      setAccountSaving(false)
    }
  }

  async function handleSaveInstrument() {
    if (!canEdit || !instrumentModal) return
    const linkedAccountId = Number(instrumentModal.linked_account_id)
    const shouldOpenHoldingAfterSave = !instrumentModal.id && Number.isFinite(linkedAccountId) && linkedAccountId > 0

    const tickerValue = instrumentModal.ticker.trim().toUpperCase()
    const payload = {
      ticker: tickerValue,
      display_name: instrumentModal.display_name.trim(),
      currency: instrumentModal.currency,
      instrument_type: instrumentModal.instrument_type,
      note: instrumentModal.note.trim() || null,
      price_source: 'yfinance',
    }

    if (!payload.ticker || !payload.display_name) {
      setInstrumentError(portfolioMessages.instrumentFieldsRequired)
      return
    }

    setInstrumentSaving(true)
    setInstrumentError('')
    const priceValue = Number(instrumentModal.price)
    const tagId = Number(instrumentModal.tag_id)

    try {
      await callRpc('app_save_instrument', {
        input_instrument_id: draftId(instrumentModal),
        input_ticker: tickerValue,
        input_display_name: payload.display_name,
        input_currency: payload.currency,
        input_instrument_type: payload.instrument_type,
        input_price: Number.isFinite(priceValue) && priceValue > 0 ? priceValue : null,
        input_price_date: instrumentModal.price_date || today(),
        input_tag_id: Number.isFinite(tagId) && tagId > 0 ? tagId : null,
        input_source: 'user',
        input_request: null,
        input_note: payload.note,
      })
      await refreshState()
      setInstrumentModal(null)
      if (shouldOpenHoldingAfterSave) {
        openHolding({ accountId: linkedAccountId, ticker: tickerValue })
      }
    } catch (error) {
      setInstrumentError(error.message)
    } finally {
      setInstrumentSaving(false)
    }
  }

  async function handleDeleteInstrument() {
    if (!canEdit || !instrumentModal?.id || !instrumentModal?.ticker) return

    const holdingCount = holdingsByTicker.get(instrumentModal.ticker)?.length ?? 0
    if (holdingCount > 0) {
      setInstrumentError(portfolioMessages.instrumentDeleteBlocked)
      return
    }

    setInstrumentSaving(true)
    setInstrumentError('')
    try {
      await callRpc('app_delete_instrument', {
        input_instrument_id: Number(instrumentModal.id),
        input_source: 'user',
        input_request: null,
      })
      await refreshState()
      setInstrumentModal(null)
    } catch (error) {
      setInstrumentError(error.message)
    } finally {
      setInstrumentSaving(false)
    }
  }

  async function handleLookupHoldingTicker() {
    if (!canEdit || !holdingModal) return

    const ticker = holdingModal.ticker.trim().toUpperCase()
    if (!ticker) {
      setHoldingLookupResult(null)
      setHoldingLookupError(portfolioMessages.holdingLookupTickerRequired)
      return
    }

    const existingInstrument = state.instruments.find((item) => item.ticker === ticker) ?? null
    const existingLatestPrice = latestPriceByTicker.get(ticker)
    if (existingInstrument) {
      setHoldingLookupError('')
      setHoldingLookupResult(
        createHoldingLookupResult({
          instrument: existingInstrument,
          latestPrice: existingLatestPrice,
          ticker,
        }),
      )
      setHoldingModal((current) => (current ? { ...current, ticker } : current))
      return
    }

    setHoldingLookupSaving(true)
    setHoldingLookupError('')
    setHoldingLookupResult(null)

    try {
      const { data, error } = await supabase.functions.invoke('lookup-ticker', {
        body: { ticker },
      })
      if (error) throw error
      if (!data?.ticker) throw new Error(portfolioMessages.holdingLookupInvalid)

      await refreshState()
      setHoldingLookupResult(data)
      setHoldingModal((current) => (current ? { ...current, ticker } : current))
    } catch (error) {
      setHoldingLookupError(await formatFunctionInvokeError(error, portfolioMessages.holdingLookupFailed))
    } finally {
      setHoldingLookupSaving(false)
    }
  }

  async function handleSaveHolding() {
    if (!canEdit || !holdingModal) return

    const normalizedTicker = holdingModal.ticker.trim().toUpperCase()
    const payload = {
      account_id: Number(holdingModal.account_id),
      ticker: normalizedTicker,
      quantity: Number(holdingModal.quantity),
      avg_price: Number(holdingModal.avg_price),
      note: holdingModal.note.trim() || null,
    }

    if (!payload.account_id || !payload.ticker || !Number.isFinite(payload.quantity) || !Number.isFinite(payload.avg_price)) {
      setHoldingError(portfolioMessages.holdingFieldsRequired)
      return
    }

    setHoldingSaving(true)
    setHoldingError('')
    try {
      const existingInstrument = state.instruments.find((item) => item.ticker === normalizedTicker) ?? null
      if (!existingInstrument) {
        if (!holdingLookupResult || holdingLookupResult.ticker !== normalizedTicker) {
          throw new Error(portfolioMessages.holdingLookupFirst)
        }
        await refreshState()
      }

      await callRpc('app_save_holding', {
        input_holding_id: draftId(holdingModal),
        input_account_id: payload.account_id,
        input_ticker: payload.ticker,
        input_quantity: payload.quantity,
        input_avg_price: payload.avg_price,
        input_note: payload.note,
        input_source: 'user',
        input_request: null,
      })

      await refreshState()
      setHoldingModal(null)
      setHoldingLookupResult(null)
      setHoldingLookupError('')
    } catch (error) {
      setHoldingError(error.message ?? portfolioMessages.holdingSaveFailed)
    } finally {
      setHoldingSaving(false)
    }
  }

  async function handleDeleteHolding() {
    if (!canEdit || !holdingModal?.id) return
    setHoldingSaving(true)
    setHoldingError('')
    try {
      await callRpc('app_delete_holding', {
        input_holding_id: Number(holdingModal.id),
        input_source: 'user',
        input_request: null,
      })
      await refreshState()
      setHoldingModal(null)
    } catch (error) {
      setHoldingError(error.message)
    } finally {
      setHoldingSaving(false)
    }
  }

  async function handleSaveTag() {
    if (!canEdit || !tagModal) return

    const payload = {
      name: tagModal.name.trim(),
      color: tagModal.color,
      sort_order: Number(tagModal.sort_order) || 0,
    }
    if (!payload.name) {
      setTagError(portfolioMessages.tagNameRequired)
      return
    }

    setTagSaving(true)
    setTagError('')
    try {
      await callRpc('app_save_tag', {
        input_tag_id: draftId(tagModal),
        input_name: payload.name,
        input_color: payload.color,
        input_sort_order: payload.sort_order,
        input_source: 'user',
        input_request: null,
      })
      await refreshState()
      setTagModal(null)
    } catch (error) {
      setTagError(error.message)
    } finally {
      setTagSaving(false)
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
      await recordActivity({
        actionType: 'sync_prices',
        targetTable: 'holding_prices_daily',
      })
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
      const trimmedPublicName = viewerProfileDraft.public_name.trim()
      const trimmedPassword = viewerProfileDraft.viewer_password.trim()

      if (viewerProfileDraft.sharing_enabled && !trimmedPublicName) {
        throw new Error(portfolioMessages.viewerPublicNameRequired)
      }

      if (trimmedPassword && trimmedPassword.length < 4) {
        throw new Error(portfolioMessages.viewerPasswordTooShort)
      }

      if (viewerProfileDraft.sharing_enabled && !trimmedPassword && !viewerProfile.viewer_password_updated_at) {
        throw new Error(portfolioMessages.viewerPasswordRequired)
      }

      const data = await callRpc('set_viewer_profile', {
        input_public_name: trimmedPublicName,
        input_viewer_password: trimmedPassword,
        input_sharing_enabled: Boolean(viewerProfileDraft.sharing_enabled),
      })

      const nextProfile = createViewerProfileDraft(Array.isArray(data) ? data[0] : data)
      await recordActivity({
        actionType: 'update_viewer_profile',
        targetTable: 'profiles',
        targetId: session.user.id,
        beforeData: {
          public_name: viewerProfile.public_name,
          sharing_enabled: viewerProfile.sharing_enabled,
          viewer_password_updated_at: viewerProfile.viewer_password_updated_at,
        },
        afterData: {
          public_name: nextProfile.public_name,
          sharing_enabled: nextProfile.sharing_enabled,
          viewer_password_updated_at: nextProfile.viewer_password_updated_at,
          password_updated: Boolean(viewerProfileDraft.viewer_password),
        },
      })
      setViewerProfileSchemaReady(true)
      setViewerProfile(nextProfile)
      setViewerProfileDraft(nextProfile)
      setViewerProfileMessage(viewerProfileSavedMessage(Boolean(viewerProfileDraft.viewer_password)))
    } catch (error) {
      if (isViewerSchemaMissingError(error)) {
        setViewerProfileSchemaReady(false)
        setViewerProfileError(formatSupabaseError(error, portfolioMessages.viewerProfileSchemaFailed))
      } else {
        setViewerProfileError(error.message ?? portfolioMessages.viewerProfileSaveFailed)
      }
    } finally {
      setViewerProfileSaving(false)
    }
  }

  return {
    handleDeleteAccount,
    handleDeleteHolding,
    handleDeleteInstrument,
    handleGuestUnlock,
    handleLookupHoldingTicker,
    handleSaveAccount,
    handleSaveHolding,
    handleSaveInstrument,
    handleSaveTag,
    handleSaveViewerProfile,
    handleSyncPrices,
    openAccount,
    openHolding,
    openInstrument,
    openTag,
    signOut,
  }
}
