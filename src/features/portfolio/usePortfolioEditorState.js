import { useState } from 'react'

export function usePortfolioEditorState() {
  const [accountModal, setAccountModal] = useState(null)
  const [accountSaving, setAccountSaving] = useState(false)
  const [accountError, setAccountError] = useState('')
  const [instrumentModal, setInstrumentModal] = useState(null)
  const [instrumentSaving, setInstrumentSaving] = useState(false)
  const [instrumentError, setInstrumentError] = useState('')
  const [holdingModal, setHoldingModal] = useState(null)
  const [holdingSaving, setHoldingSaving] = useState(false)
  const [holdingError, setHoldingError] = useState('')
  const [holdingLookupSaving, setHoldingLookupSaving] = useState(false)
  const [holdingLookupError, setHoldingLookupError] = useState('')
  const [holdingLookupResult, setHoldingLookupResult] = useState(null)
  const [tagModal, setTagModal] = useState(null)
  const [tagSaving, setTagSaving] = useState(false)
  const [tagError, setTagError] = useState('')
  const [syncingPrices, setSyncingPrices] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')

  return {
    accountError,
    accountModal,
    accountSaving,
    holdingError,
    holdingLookupError,
    holdingLookupResult,
    holdingLookupSaving,
    holdingModal,
    holdingSaving,
    instrumentError,
    instrumentModal,
    instrumentSaving,
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
    setSyncMessage,
    setSyncingPrices,
    setTagError,
    setTagModal,
    setTagSaving,
    syncMessage,
    syncingPrices,
    tagError,
    tagModal,
    tagSaving,
  }
}
