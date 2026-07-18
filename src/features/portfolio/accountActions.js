import { portfolioMessages } from './messages'

export function createAccountActions({ accountModal, callRpc, canEdit, holdingsByAccountId, refreshState, setAccountError, setAccountModal, setAccountSaving }) {
  async function handleSaveAccount() {
    if (!canEdit || !accountModal) return
    const payload = {
      broker: accountModal.broker.trim() || null,
      name: accountModal.name.trim(),
      note: accountModal.note.trim() || null,
    }
    if (!payload.name) {
      setAccountError(portfolioMessages.accountNameRequired)
      return
    }

    setAccountSaving(true)
    setAccountError('')
    try {
      await callRpc('app_save_account', {
        input_account_id: accountModal.id ? Number(accountModal.id) : null,
        input_broker: payload.broker,
        input_name: payload.name,
        input_note: payload.note,
        input_request: null,
        input_source: 'user',
      })
      await refreshState()
      setAccountModal(null)
    } catch (error) {
      setAccountError(error.message)
    } finally {
      setAccountSaving(false)
    }
  }

  async function handleDeleteAccount() {
    if (!canEdit || !accountModal?.id) return
    if ((holdingsByAccountId.get(accountModal.id)?.length ?? 0) > 0) {
      setAccountError(portfolioMessages.accountDeleteBlocked)
      return
    }

    setAccountSaving(true)
    setAccountError('')
    try {
      await callRpc('app_delete_account', {
        input_account_id: Number(accountModal.id),
        input_request: null,
        input_source: 'user',
      })
      await refreshState()
      setAccountModal(null)
    } catch (error) {
      setAccountError(error.message)
    } finally {
      setAccountSaving(false)
    }
  }

  return { handleDeleteAccount, handleSaveAccount }
}
