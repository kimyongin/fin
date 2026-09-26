import { createAccountActions } from './accountActions'
import { createInstrumentActions } from './instrumentActions'
import {
  createAccountModalDraft,
  createInstrumentModalDraft,
} from './helpers'
import { portfolioMessages } from './messages'
import { summarizePriceSync } from './priceSync'

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
    holdingsByAccountId,
    holdingsByTicker,
    instrumentModal,
    instrumentLookupResult,
    refreshState,
    setAccountError,
    setAccountModal,
    setAccountSaving,
    setInstrumentError,
    setInstrumentLookupError,
    setInstrumentLookupResult,
    setInstrumentLookupSaving,
    setInstrumentModal,
    setInstrumentSaving,
    setLoadError = () => {},
    setSyncMessage,
    setSyncingPrices,
    state,
    supabase,
    tagMapByTicker,
    onInstrumentSaved,
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
    const tagId = instrument?.ticker ? tagMapByTicker.get(instrument.ticker)?.id ?? '' : ''
    setInstrumentError('')
    setInstrumentLookupError('')
    setInstrumentLookupResult(null)
    setInstrumentModal(createInstrumentModalDraft({ instrument, tagId }))
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
    ...createInstrumentActions({ callRpc, canEdit, holdingsByTicker, instrumentModal, instrumentLookupResult, onInstrumentSaved, refreshAfterMutation, setInstrumentError, setInstrumentLookupError, setInstrumentLookupResult, setInstrumentLookupSaving, setInstrumentModal, setInstrumentSaving, state, supabase }),
    handleSyncPrices,
    openAccount,
    openInstrument,
  }
}
