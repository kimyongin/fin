import { normalizeEditableInstrumentType } from '../../constants/portfolio'
import { formatFunctionInvokeError } from '../../lib/viewerAccess'
import { portfolioMessages } from './messages'

export function createInstrumentActions({
  callRpc,
  canEdit,
  holdingsByTicker,
  instrumentModal,
  instrumentLookupResult,
  onInstrumentSaved,
  refreshAfterMutation,
  setInstrumentError,
  setInstrumentLookupError,
  setInstrumentLookupResult,
  setInstrumentLookupSaving,
  setInstrumentModal,
  setInstrumentSaving,
  state,
  supabase,
}) {
  async function handleLookupInstrumentTicker() {
    if (!canEdit || !instrumentModal || instrumentModal.id) return
    const ticker = instrumentModal.ticker.trim().toUpperCase()
    if (!ticker) { setInstrumentLookupError('티커를 입력해 주세요.'); return }
    if (state.instruments.some((item) => item.ticker === ticker)) {
      setInstrumentLookupError('이미 등록된 종목입니다. 자산 목록에서 선택해 주세요.')
      return
    }
    setInstrumentLookupSaving(true)
    setInstrumentLookupError('')
    setInstrumentLookupResult(null)
    try {
      const { data, error } = await supabase.functions.invoke('lookup-ticker', { body: { ticker } })
      if (error) throw error
      if (!data?.ticker || data.ticker !== ticker) throw new Error('티커 조회 결과가 일치하지 않습니다.')
      setInstrumentLookupResult(data)
      setInstrumentModal((current) => current?.ticker === ticker ? {
        ...current, display_name: data.display_name || current.display_name,
        currency: data.currency || current.currency,
      } : current)
    } catch (error) {
      setInstrumentLookupError(await formatFunctionInvokeError(error, '티커를 조회하지 못했습니다.'))
    } finally {
      setInstrumentLookupSaving(false)
    }
  }

  async function handleSaveInstrument() {
    if (!canEdit || !instrumentModal) return
    const instrumentType = normalizeEditableInstrumentType(instrumentModal.instrument_type)
    const ticker = instrumentModal.ticker.trim().toUpperCase()
      || (instrumentType === 'cash' ? instrumentModal.currency : `VALUATION:${crypto.randomUUID().toUpperCase()}`)
    const displayName = instrumentModal.display_name.trim()
    if (!displayName) {
      setInstrumentError(portfolioMessages.instrumentFieldsRequired)
      return
    }
    if (!instrumentModal.id && instrumentType === 'market' && instrumentLookupResult?.ticker !== ticker) {
      setInstrumentError('티커를 조회한 뒤 등록해 주세요.')
      return
    }
    if (!instrumentModal.id && state.instruments.some((item) => item.ticker === ticker)) {
      setInstrumentError('이미 등록된 종목입니다. 자산 목록에서 선택해 주세요.')
      return
    }

    setInstrumentSaving(true)
    setInstrumentError('')
    const tagId = Number(instrumentModal.tag_id)
    try {
      const fields = {
        input_currency: instrumentModal.currency,
        input_display_name: displayName,
        input_instrument_type: instrumentType,
        input_note: instrumentModal.note.trim() || null,
        input_tag_id: Number.isFinite(tagId) && tagId > 0 ? tagId : null,
        input_ticker: ticker,
      }
      if (instrumentModal.id) await callRpc('app_save_instrument', {
        ...fields, input_instrument_id: Number(instrumentModal.id), input_price: null,
        input_price_date: null, input_request: null, input_source: 'user',
      })
      else await callRpc('app_create_instrument', fields)
      setInstrumentModal(null)
      const refreshed = await refreshAfterMutation()
      if (!instrumentModal.id && refreshed) onInstrumentSaved?.(ticker)
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
      setInstrumentModal(null)
      await refreshAfterMutation()
    } catch (error) {
      setInstrumentError(error.message)
    } finally {
      setInstrumentSaving(false)
    }
  }

  return { handleDeleteInstrument, handleLookupInstrumentTicker, handleSaveInstrument }
}
