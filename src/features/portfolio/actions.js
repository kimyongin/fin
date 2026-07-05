import { formatFunctionInvokeError, formatSupabaseError, isViewerSchemaMissingError, sha256Hex } from '../../lib/viewerAccess'
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
    const query = accountModal.id
      ? supabase.from('accounts').update(payload).eq('id', accountModal.id)
      : supabase.from('accounts').insert(payload)
    const { error } = await query
    setAccountSaving(false)

    if (error) {
      setAccountError(error.message)
      return
    }

    await refreshState()
    setAccountModal(null)
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
    const { error } = await supabase.from('accounts').delete().eq('id', accountModal.id)
    setAccountSaving(false)

    if (error) {
      setAccountError(error.message)
      return
    }

    await refreshState()
    setAccountModal(null)
  }

  async function handleSaveInstrument() {
    if (!canEdit || !instrumentModal) return
    const linkedAccountId = Number(instrumentModal.linked_account_id)
    const shouldOpenHoldingAfterSave = !instrumentModal.id && Number.isFinite(linkedAccountId) && linkedAccountId > 0

    const tickerValue = instrumentModal.ticker.trim()
    const payload = {
      ticker: tickerValue,
      display_name: instrumentModal.display_name.trim(),
      currency: instrumentModal.currency,
      instrument_type: instrumentModal.instrument_type,
      price_source: 'yfinance',
    }

    if (!payload.ticker || !payload.display_name) {
      setInstrumentError(portfolioMessages.instrumentFieldsRequired)
      return
    }

    setInstrumentSaving(true)
    setInstrumentError('')
    const query = instrumentModal.id
      ? supabase.from('instruments').update(payload).eq('id', instrumentModal.id)
      : supabase.from('instruments').insert(payload)
    const { error } = await query

    if (error) {
      setInstrumentSaving(false)
      setInstrumentError(error.message)
      return
    }

    const priceValue = Number(instrumentModal.price)
    if (Number.isFinite(priceValue) && priceValue > 0) {
      const { error: priceError } = await supabase
        .from('holding_prices_daily')
        .upsert(
          {
            ticker: tickerValue,
            price_date: instrumentModal.price_date || today(),
            close_price: priceValue,
            source: 'manual',
          },
          { onConflict: 'user_id,ticker,price_date' },
        )
      if (priceError) {
        setInstrumentSaving(false)
        setInstrumentError(priceError.message)
        return
      }
    }

    const { error: deleteTagError } = await supabase.from('instrument_tags').delete().eq('ticker', tickerValue)
    if (deleteTagError) {
      setInstrumentSaving(false)
      setInstrumentError(deleteTagError.message)
      return
    }

    const tagId = Number(instrumentModal.tag_id)
    if (Number.isFinite(tagId) && tagId > 0) {
      const { error: tagError } = await supabase.from('instrument_tags').insert({
        ticker: tickerValue,
        tag_id: tagId,
      })
      if (tagError) {
        setInstrumentSaving(false)
        setInstrumentError(tagError.message)
        return
      }
    }

    setInstrumentSaving(false)
    await refreshState()
    setInstrumentModal(null)
    if (shouldOpenHoldingAfterSave) {
      openHolding({ accountId: linkedAccountId, ticker: tickerValue })
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
    const { error: tagError } = await supabase.from('instrument_tags').delete().eq('ticker', instrumentModal.ticker)
    if (tagError) {
      setInstrumentSaving(false)
      setInstrumentError(tagError.message)
      return
    }

    const { error: priceError } = await supabase.from('holding_prices_daily').delete().eq('ticker', instrumentModal.ticker)
    if (priceError) {
      setInstrumentSaving(false)
      setInstrumentError(priceError.message)
      return
    }

    const { error } = await supabase.from('instruments').delete().eq('id', instrumentModal.id)
    setInstrumentSaving(false)
    if (error) {
      setInstrumentError(error.message)
      return
    }

    await refreshState()
    setInstrumentModal(null)
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

      const query = holdingModal.id
        ? supabase.from('holdings').update(payload).eq('id', holdingModal.id)
        : supabase.from('holdings').upsert(payload, { onConflict: 'account_id,ticker' })
      const { error } = await query
      if (error) throw error

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
    const { error } = await supabase.from('holdings').delete().eq('id', holdingModal.id)
    setHoldingSaving(false)

    if (error) {
      setHoldingError(error.message)
      return
    }

    await refreshState()
    setHoldingModal(null)
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
    const query = tagModal.id
      ? supabase.from('tags').update(payload).eq('id', tagModal.id)
      : supabase.from('tags').insert(payload)
    const { error } = await query
    setTagSaving(false)
    if (error) {
      setTagError(error.message)
      return
    }

    await refreshState()
    setTagModal(null)
  }

  async function handleSyncPrices() {
    if (!canEdit) return
    setSyncingPrices(true)
    setSyncMessage('')
    try {
      const { error } = await supabase.functions.invoke('sync-prices', { body: {} })
      if (error) throw error
      await refreshState()
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

      const payload = {
        user_id: session.user.id,
        public_name: trimmedPublicName || null,
        public_name_normalized: trimmedPublicName ? trimmedPublicName.toLowerCase() : null,
        sharing_enabled: Boolean(viewerProfileDraft.sharing_enabled),
      }

      if (trimmedPassword) {
        payload.viewer_password_hash = await sha256Hex(trimmedPassword)
        payload.viewer_password_updated_at = new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'user_id' })
        .select('public_name, sharing_enabled, viewer_password_updated_at')
        .limit(1)

      if (error) throw error

      const nextProfile = createViewerProfileDraft(Array.isArray(data) ? data[0] : data)
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
