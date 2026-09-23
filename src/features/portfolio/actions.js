import { createAccountActions } from './accountActions'
import { createHoldingActions } from './holdingActions'
import { createInstrumentActions } from './instrumentActions'
import {
  createAccountModalDraft,
  createHoldingModalDraft,
  createInstrumentModalDraft,
  createTagModalDraft,
} from './helpers'
import { portfolioMessages } from './messages'
import { summarizePriceSync } from './priceSync'
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
    holdingLookupResult,
    holdingModal,
    holdingsByAccountId,
    holdingsByTicker,
    instrumentModal,
    latestPriceByTicker,
    refreshState,
    setAccountError,
    setAccountModal,
    setAccountSaving,
    setHoldingError,
    setHoldingLookupError,
    setHoldingLookupResult,
    setHoldingLookupSaving,
    setHoldingModal,
    setHoldingSaving,
    setInstrumentError,
    setInstrumentModal,
    setInstrumentSaving,
    setLoadError = () => {},
    setSyncMessage,
    setSyncingPrices,
    setTagError,
    setTagModal,
    setTagSaving,
    state,
    supabase,
    tagMapByTicker,
    tagModal,
    today,
  } = params
  const callRpc = createRpcCaller(supabase)

  async function refreshAfterMutation() {
    try {
      await refreshState()
      return true
    } catch (error) {
      setLoadError(`변경은 저장됐지만 최신 화면을 불러오지 못했습니다. 다시 불러와 주세요. ${error.message ?? ''}`.trim())
      return false
    }
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

  async function handleSyncPrices() {
    if (!canEdit) return
    setSyncingPrices(true)
    setSyncMessage('')
    try {
      const { data, error } = await supabase.functions.invoke('sync-prices', { body: {} })
      if (error) throw error
      const summary = summarizePriceSync(data)
      await refreshState()
      setSyncMessage(summary.message)
    } catch (error) {
      setSyncMessage(error.message ?? portfolioMessages.syncPricesFailed)
    } finally {
      setSyncingPrices(false)
    }
  }

  return {
    ...createAccountActions({ accountModal, callRpc, canEdit, holdingsByAccountId, refreshAfterMutation, setAccountError, setAccountModal, setAccountSaving }),
    ...createHoldingActions({ callRpc, canEdit, holdingLookupResult, holdingModal, latestPriceByTicker, refreshAfterMutation, refreshState, setHoldingError, setHoldingLookupError, setHoldingLookupResult, setHoldingLookupSaving, setHoldingModal, setHoldingSaving, state, supabase }),
    ...createInstrumentActions({ callRpc, canEdit, holdingsByTicker, instrumentModal, openHolding, refreshAfterMutation, setInstrumentError, setInstrumentModal, setInstrumentSaving, today }),
    ...createTagActions({ callRpc, canEdit, refreshAfterMutation, setTagError, setTagModal, setTagSaving, tagModal }),
    handleSyncPrices,
    openAccount,
    openHolding,
    openInstrument,
    openTag,
  }
}
