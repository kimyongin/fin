import {
  AccountEditorModal,
  HoldingEditorModal,
  InstrumentEditorModal,
  TagEditorModal,
} from './EditorModals'
import { normalizeTickerInput } from '../../lib/portfolioMath'

export default function PortfolioEditorModals({
  accountError,
  accountModal,
  accountSaving,
  accounts,
  holdingError,
  holdingLookupError,
  holdingLookupResult,
  holdingLookupSaving,
  holdingModal,
  holdingSaving,
  instrumentError,
  instrumentModal,
  instrumentSaving,
  instruments,
  onDeleteAccount,
  onDeleteHolding,
  onDeleteInstrument,
  onDeleteTag,
  onLookupHoldingTicker,
  onSaveAccount,
  onSaveHolding,
  onSaveInstrument,
  onSaveTag,
  setAccountError,
  setAccountModal,
  setHoldingError,
  setHoldingLookupError,
  setHoldingLookupResult,
  setHoldingModal,
  setInstrumentError,
  setInstrumentModal,
  setTagError,
  setTagModal,
  tagError,
  tagModal,
  tagSaving,
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
          accounts={accounts}
          draft={instrumentModal}
          instrumentError={instrumentError}
          instrumentSaving={instrumentSaving}
          onChange={(field, value) => {
            setInstrumentError('')
            setInstrumentModal((current) => ({ ...current, [field]: value }))
          }}
          onClose={() => {
            if (!instrumentSaving) {
              setInstrumentError('')
              setInstrumentModal(null)
            }
          }}
          onDelete={onDeleteInstrument}
          onSave={onSaveInstrument}
          tags={tags}
        />
      )}

      {holdingModal && (
        <HoldingEditorModal
          accounts={accounts}
          draft={holdingModal}
          holdingError={holdingError}
          holdingLookupError={holdingLookupError}
          holdingLookupResult={holdingLookupResult}
          holdingLookupSaving={holdingLookupSaving}
          holdingSaving={holdingSaving}
          instruments={instruments.filter((item) => item.instrument_type !== 'fx')}
          onChange={(field, value) => {
            setHoldingError('')
            setHoldingLookupError('')
            if (field === 'ticker') {
              setHoldingLookupResult((current) =>
                current?.ticker === normalizeTickerInput(value) ? current : null,
              )
            }
            setHoldingModal((current) => ({ ...current, [field]: value }))
          }}
          onClose={() => {
            if (!holdingSaving) {
              setHoldingError('')
              setHoldingLookupError('')
              setHoldingLookupResult(null)
              setHoldingModal(null)
            }
          }}
          onLookupTicker={onLookupHoldingTicker}
          onDelete={onDeleteHolding}
          onSave={onSaveHolding}
        />
      )}

      {tagModal && (
        <TagEditorModal
          draft={tagModal}
          onChange={(field, value) => {
            setTagError('')
            setTagModal((current) => ({ ...current, [field]: value }))
          }}
          onClose={() => {
            if (!tagSaving) {
              setTagError('')
              setTagModal(null)
            }
          }}
          onDelete={onDeleteTag}
          onSave={onSaveTag}
          tagError={tagError}
          tagSaving={tagSaving}
        />
      )}
    </>
  )
}
