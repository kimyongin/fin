import { useState } from 'react'
import ModalShell from '../../components/ModalShell'

export default function AssetViewToolbar({ canEdit, onCreateTag, onEditTag, onViewChange, tags = [] }) {
  const [managingTags, setManagingTags] = useState(false)
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold" onClick={() => onViewChange('holdings')} type="button">← 자산으로 돌아가기</button>
      {canEdit && <button className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold" onClick={() => setManagingTags(true)} type="button">태그 관리</button>}
    </div>
    {managingTags && <ModalShell onClose={() => setManagingTags(false)} title="종목 태그 관리">
      <p className="text-sm text-[var(--muted-ink)]">종목마다 태그 하나를 연결할 수 있습니다.</p>
      <button className="mt-4 min-h-11 rounded-2xl bg-[var(--accent)] px-4 text-sm font-semibold text-white" onClick={() => { setManagingTags(false); onCreateTag() }} type="button">태그 추가</button>
      <div className="mt-4 grid gap-2">{tags.length === 0 && <p className="text-sm text-[var(--muted-ink)]">등록된 종목 태그가 없습니다.</p>}{tags.map((tag) => <button className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-[var(--line)] px-3 text-left text-sm" key={tag.id} onClick={() => { setManagingTags(false); onEditTag(tag) }} type="button"><span className="min-w-0 break-words">{tag.name}</span><span className="shrink-0 text-[var(--muted-ink)]">순서 {tag.sort_order}</span></button>)}</div>
    </ModalShell>}
  </>
}
