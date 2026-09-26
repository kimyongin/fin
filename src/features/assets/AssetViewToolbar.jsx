import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { pagePanelActionClass } from '../../components/PageControls'
import TagManagerModal from '../../components/TagManagerModal'
import { useDetailHistoryEntry } from '../../hooks/useDetailHistoryEntry'
import { deletePortfolioTag, savePortfolioTag } from '../portfolio/data'

export default function AssetViewToolbar({ canEdit, onTagsChanged, supabase, tags = [] }) {
  const [managingTags, setManagingTags] = useState(false)
  const historyGuard = useRef(null)
  const requestClose = useDetailHistoryEntry(managingTags, (confirmed) => {
    if (!confirmed && historyGuard.current?.() === false) return false
    setManagingTags(false)
  })
  if (!canEdit) return null

  return <>
    <button className={pagePanelActionClass} onClick={() => setManagingTags(true)} type="button">태그 관리</button>
    {managingTags && createPortal(<TagManagerModal deleteImpact="연결된 종목은 태그 없음으로 바뀝니다. 목표 비중이 0보다 크면 먼저 목표를 조정해야 삭제할 수 있습니다." historyGuardRef={historyGuard} onClose={requestClose} onDelete={(tag) => deletePortfolioTag(supabase, tag)} onRefresh={onTagsChanged} onSave={(tag) => savePortfolioTag(supabase, tag)} showSortOrder tags={tags} title="자산 태그 관리" />, document.body)}
  </>
}
