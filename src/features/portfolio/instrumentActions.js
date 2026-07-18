import { normalizeEditableInstrumentType } from '../../constants/portfolio'
import { portfolioMessages } from './messages'

export function createInstrumentActions({
  callRpc,
  canEdit,
  holdingsByTicker,
  instrumentModal,
  openHolding,
  refreshState,
  setInstrumentError,
  setInstrumentModal,
  setInstrumentSaving,
  today,
}) {
  async function handleSaveInstrument() {
    if (!canEdit || !instrumentModal) return
    const linkedAccountId = Number(instrumentModal.linked_account_id)
    const shouldOpenHolding = !instrumentModal.id && Number.isFinite(linkedAccountId) && linkedAccountId > 0
    const instrumentType = normalizeEditableInstrumentType(instrumentModal.instrument_type)
    const ticker = instrumentModal.ticker.trim().toUpperCase()
      || (instrumentType === 'cash' ? instrumentModal.currency : `VALUATION:${crypto.randomUUID().toUpperCase()}`)
    const displayName = instrumentModal.display_name.trim()
    if (!displayName) {
      setInstrumentError(portfolioMessages.instrumentFieldsRequired)
      return
    }

    setInstrumentSaving(true)
    setInstrumentError('')
    const price = Number(instrumentModal.price)
    const tagId = Number(instrumentModal.tag_id)
    try {
      await callRpc('app_save_instrument', {
        input_currency: instrumentModal.currency,
        input_display_name: displayName,
        input_instrument_id: instrumentModal.id ? Number(instrumentModal.id) : null,
        input_instrument_type: instrumentType,
        input_note: instrumentModal.note.trim() || null,
        input_price: instrumentType === 'market' && Number.isFinite(price) && price > 0 ? price : null,
        input_price_date: instrumentModal.price_date || today(),
        input_request: null,
        input_source: 'user',
        input_tag_id: Number.isFinite(tagId) && tagId > 0 ? tagId : null,
        input_ticker: ticker,
      })
      await refreshState()
      setInstrumentModal(null)
      if (shouldOpenHolding) openHolding({ accountId: linkedAccountId, ticker })
    } catch (error) {
      setInstrumentError(error.message)
    } finally {
      setInstrumentSaving(false)
    }
  }

  async function handleDeleteInstrument() {
    if (!canEdit || !instrumentModal?.id || !instrumentModal?.ticker) return
    if ((holdingsByTicker.get(instrumentModal.ticker)?.length ?? 0) > 0) {
      setInstrumentError(portfolioMessages.instrumentDeleteBlocked)
      return
    }
    setInstrumentSaving(true)
    setInstrumentError('')
    try {
      await callRpc('app_delete_instrument', {
        input_instrument_id: Number(instrumentModal.id),
        input_request: null,
        input_source: 'user',
      })
      await refreshState()
      setInstrumentModal(null)
    } catch (error) {
      setInstrumentError(error.message)
    } finally {
      setInstrumentSaving(false)
    }
  }

  return { handleDeleteInstrument, handleSaveInstrument }
}
