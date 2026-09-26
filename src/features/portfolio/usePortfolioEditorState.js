import { useState } from 'react'

export function usePortfolioEditorState() {
  const [accountModal, setAccountModal] = useState(null)
  const [accountSaving, setAccountSaving] = useState(false)
  const [accountError, setAccountError] = useState('')
  const [instrumentModal, setInstrumentModal] = useState(null)
  const [instrumentSaving, setInstrumentSaving] = useState(false)
  const [instrumentError, setInstrumentError] = useState('')
  const [instrumentLookupSaving, setInstrumentLookupSaving] = useState(false)
  const [instrumentLookupError, setInstrumentLookupError] = useState('')
  const [instrumentLookupResult, setInstrumentLookupResult] = useState(null)
  const [syncingPrices, setSyncingPrices] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')

  return {
    accountError,
    accountModal,
    accountSaving,
    instrumentError,
    instrumentLookupSaving,
    instrumentLookupError,
    instrumentLookupResult,
    instrumentModal,
    instrumentSaving,
    setAccountError,
    setAccountModal,
    setAccountSaving,
    setInstrumentError,
    setInstrumentLookupSaving,
    setInstrumentLookupError,
    setInstrumentLookupResult,
    setInstrumentModal,
    setInstrumentSaving,
    setSyncMessage,
    setSyncingPrices,
    syncMessage,
    syncingPrices,
  }
}
