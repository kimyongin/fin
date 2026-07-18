import { formatFunctionInvokeError } from '../../lib/viewerAccess'
import { createHoldingLookupResult } from './helpers'
import { portfolioMessages } from './messages'

export function createHoldingActions({
  callRpc,
  canEdit,
  holdingLookupResult,
  holdingModal,
  latestPriceByTicker,
  refreshState,
  setHoldingError,
  setHoldingLookupError,
  setHoldingLookupResult,
  setHoldingLookupSaving,
  setHoldingModal,
  setHoldingSaving,
  state,
  supabase,
}) {
  const draftId = (draft) => draft?.id ? Number(draft.id) : null

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
      setHoldingLookupResult(createHoldingLookupResult({ instrument: existingInstrument, latestPrice: existingLatestPrice, ticker }))
      setHoldingModal((current) => (current ? { ...current, ticker } : current))
      return
    }

    setHoldingLookupSaving(true)
    setHoldingLookupError('')
    setHoldingLookupResult(null)
    try {
      const { data, error } = await supabase.functions.invoke('lookup-ticker', { body: { ticker } })
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

    const ticker = holdingModal.ticker.trim().toUpperCase()
    const selectedInstrument = state.instruments.find((item) => item.ticker === ticker) ?? null
    const instrumentType = holdingLookupResult?.ticker === ticker
      ? holdingLookupResult.instrument_type
      : selectedInstrument?.instrument_type ?? 'market'
    const payload = {
      accountId: Number(holdingModal.account_id),
      avgPrice: Number(holdingModal.avg_price),
      note: holdingModal.note.trim() || null,
      quantity: Number(holdingModal.quantity),
      ticker,
    }

    if (!payload.accountId || !payload.ticker) {
      setHoldingError(portfolioMessages.holdingFieldsRequired)
      return
    }

    const purchaseAmount = holdingModal.purchase_amount === '' ? Number.NaN : Number(holdingModal.purchase_amount)
    const valuationAmount = holdingModal.valuation_amount === '' ? Number.NaN : Number(holdingModal.valuation_amount)
    if (instrumentType === 'market' && (!Number.isFinite(payload.quantity) || !Number.isFinite(payload.avgPrice))) {
      setHoldingError(portfolioMessages.holdingFieldsRequired)
      return
    }
    if (instrumentType === 'valuation' && (!Number.isFinite(purchaseAmount) || !Number.isFinite(valuationAmount))) {
      setHoldingError('매입금액과 평가금액을 입력해 주세요.')
      return
    }
    if (instrumentType === 'cash' && !Number.isFinite(valuationAmount)) {
      setHoldingError('현금성 자산은 잔액을 입력해 주세요.')
      return
    }

    setHoldingSaving(true)
    setHoldingError('')
    try {
      if (!selectedInstrument) {
        if (!holdingLookupResult || holdingLookupResult.ticker !== ticker) throw new Error(portfolioMessages.holdingLookupFirst)
        await refreshState()
      }

      const common = {
        input_account_id: payload.accountId,
        input_holding_id: draftId(holdingModal),
        input_note: payload.note,
        input_request: null,
        input_source: 'user',
        input_ticker: payload.ticker,
      }
      if (instrumentType === 'valuation') await callRpc('app_save_valuation_holding', {
        ...common,
        input_purchase_amount: purchaseAmount,
        input_valuation_amount: valuationAmount,
      })
      else if (instrumentType === 'cash') await callRpc('app_save_cash_holding', {
        ...common,
        input_balance: valuationAmount,
      })
      else await callRpc('app_save_holding', {
        ...common,
        input_avg_price: payload.avgPrice,
        input_quantity: payload.quantity,
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
        input_request: null,
        input_source: 'user',
      })
      await refreshState()
      setHoldingModal(null)
    } catch (error) {
      setHoldingError(error.message)
    } finally {
      setHoldingSaving(false)
    }
  }

  return { handleDeleteHolding, handleLookupHoldingTicker, handleSaveHolding }
}
