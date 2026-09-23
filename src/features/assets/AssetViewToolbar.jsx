import { useState } from 'react'
import { assetViewOptions } from '../../constants/portfolio'
import { PageToolbar, ViewTabs } from '../../components/PageControls'
import ModalShell from '../../components/ModalShell'

export default function AssetViewToolbar({ canEdit, copied, onCopyCsv, onCreateTag, onEditTag, onSyncPrices, onViewChange, syncMessage, syncingPrices, tags = [], value }) {
  const [managingTags, setManagingTags] = useState(false)
  return <>
  <PageToolbar secondary={<>
    {value !== 'allocation' && <button className="min-h-11 rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] px-4 text-sm font-semibold text-[var(--accent)] transition hover:bg-[var(--surface-2)]" onClick={() => onViewChange('allocation')} type="button">목표와 비교</button>}
    {canEdit && <button className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold" disabled={syncingPrices} onClick={onSyncPrices} type="button">{syncingPrices ? '갱신 중' : '가격 갱신'}</button>}
    {canEdit && <details className="relative group"><summary className="flex min-h-11 cursor-pointer list-none items-center rounded-xl border border-[var(--line)] px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">더보기</summary><div className="absolute right-0 z-20 mt-1 min-w-44 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-1 shadow-[var(--shadow-soft)]"><button className="min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-[var(--surface-2)]" onClick={(event) => { event.currentTarget.closest('details').open = false; setManagingTags(true) }} type="button">종목 태그 관리</button></div></details>}
    <button className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold" onClick={onCopyCsv} type="button">CSV 복사</button>
    <span aria-live="polite" className="text-xs text-[var(--muted-ink)]" role="status">{copied ? 'CSV를 복사했어요' : ''}</span>
  </>}>
    {value === 'allocation'
      ? <button className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold" onClick={() => onViewChange('tags')} type="button">자산으로 돌아가기</button>
      : <ViewTabs ariaLabel="자산 보기 전환" className="grid-cols-4" idBase="asset-view" onChange={onViewChange} options={assetViewOptions} panelId="asset-view-panel" value={value} />}
  </PageToolbar>
  {canEdit && syncMessage && <p aria-live="polite" className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm" role="status">{syncMessage}</p>}
  {managingTags && <ModalShell onClose={() => setManagingTags(false)} title="종목 태그 관리" footer={<button className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm" onClick={() => setManagingTags(false)} type="button">닫기</button>}>
    <p className="text-sm text-[var(--muted-ink)]">종목마다 태그 하나를 연결할 수 있습니다.</p>
    <button className="mt-4 min-h-11 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white" onClick={() => { setManagingTags(false); onCreateTag() }} type="button">태그 추가</button>
    <div className="mt-4 grid gap-2">{tags.length === 0 && <p className="text-sm text-[var(--muted-ink)]">등록된 종목 태그가 없습니다.</p>}{tags.map((tag) => <button className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-3 text-left text-sm" key={tag.id} onClick={() => { setManagingTags(false); onEditTag(tag) }} type="button"><span className="min-w-0 break-words">{tag.name}</span><span className="shrink-0 text-[var(--muted-ink)]">순서 {tag.sort_order}</span></button>)}</div>
  </ModalShell>}
  </>
}
