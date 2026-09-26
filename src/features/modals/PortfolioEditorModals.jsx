import {
  AccountEditorModal,
  InstrumentEditorModal,
} from './EditorModals'

export default function PortfolioEditorModals({
  accountError,
  accountModal,
  accountSaving,
  accounts,
  instrumentError,
  instrumentLookupError,
  instrumentLookupResult,
  instrumentLookupSaving,
  instrumentModal,
  instrumentSaving,
  instruments,
  onDeleteAccount,
  onDeleteInstrument,
  onLookupInstrumentTicker,
  onSaveAccount,
  onSaveInstrument,
  setAccountError,
  setAccountModal,
  setInstrumentError,
  setInstrumentLookupError,
  setInstrumentLookupResult,
  setInstrumentModal,
  tags,
}) {
  return (
    <>
      {accountModal && (
        <AccountEditorModal
          accountError={accountError}
          accountSaving={accountSaving}
          draft={accountModal}
          onChange={(field, value) => {
            setAccountError('')
            setAccountModal((current) => ({ ...current, [field]: value }))
          }}
          onClose={() => {
            if (!accountSaving) {
              setAccountError('')
              setAccountModal(null)
            }
          }}
          onDelete={onDeleteAccount}
          onSave={onSaveAccount}
        />
      )}

      {instrumentModal && (
        <InstrumentEditorModal
          draft={instrumentModal}
          instrumentError={instrumentError}
          instrumentLookupError={instrumentLookupError}
          instrumentLookupResult={instrumentLookupResult}
          instrumentLookupSaving={instrumentLookupSaving}
          instrumentSaving={instrumentSaving}
          onChange={(field, value) => {
            setInstrumentError('')
            setInstrumentLookupError('')
            if (field === 'ticker') setInstrumentLookupResult(null)
            setInstrumentModal((current) => ({ ...current, [field]: value }))
          }}
          onClose={() => {
            if (!instrumentSaving) {
              setInstrumentError('')
              setInstrumentModal(null)
            }
          }}
          onDelete={onDeleteInstrument}
          onLookup={onLookupInstrumentTicker}
          onSave={onSaveInstrument}
          tags={tags}
        />
      )}

    </>
  )
}
