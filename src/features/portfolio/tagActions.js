import { portfolioMessages } from './messages'

export function createTagActions({ callRpc, canEdit, refreshState, setTagError, setTagModal, setTagSaving, tagModal }) {
  async function handleSaveTag() {
    if (!canEdit || !tagModal) return
    const name = tagModal.name.trim()
    if (!name) {
      setTagError(portfolioMessages.tagNameRequired)
      return
    }
    setTagSaving(true)
    setTagError('')
    try {
      await callRpc('app_save_tag', {
        input_name: name,
        input_request: null,
        input_sort_order: Number(tagModal.sort_order) || 0,
        input_source: 'user',
        input_tag_id: tagModal.id ? Number(tagModal.id) : null,
      })
      await refreshState()
      setTagModal(null)
    } catch (error) {
      setTagError(error.message)
    } finally {
      setTagSaving(false)
    }
  }

  async function handleDeleteTag() {
    if (!canEdit || !tagModal?.id) return
    setTagSaving(true)
    setTagError('')
    try {
      await callRpc('app_delete_tag', {
        input_request: null,
        input_source: 'user',
        input_tag_id: Number(tagModal.id),
      })
      await refreshState()
      setTagModal(null)
    } catch (error) {
      setTagError(error.message)
    } finally {
      setTagSaving(false)
    }
  }

  return { handleDeleteTag, handleSaveTag }
}
