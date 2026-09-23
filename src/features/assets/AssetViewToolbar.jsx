import { assetViewOptions } from '../../constants/portfolio'
import { PageToolbar, ViewTabs } from '../../components/PageControls'

export default function AssetViewToolbar({ copied, onCopyCsv, onViewChange, value }) {
  return <PageToolbar secondary={<>
    {value !== 'allocation' && <button className="min-h-11 rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] px-4 text-sm font-semibold text-[var(--accent)] transition hover:bg-[var(--surface-2)]" onClick={() => onViewChange('allocation')} type="button">목표와 비교</button>}
    <button className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold" onClick={onCopyCsv} type="button">CSV 복사</button>
    <span aria-live="polite" className="text-xs text-[var(--muted-ink)]" role="status">{copied ? 'CSV를 복사했어요' : ''}</span>
  </>}>
    {value === 'allocation'
      ? <button className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold" onClick={() => onViewChange('tags')} type="button">자산으로 돌아가기</button>
      : <ViewTabs ariaLabel="자산 보기 전환" className="grid-cols-4" idBase="asset-view" onChange={onViewChange} options={assetViewOptions} panelId="asset-view-panel" value={value} />}
  </PageToolbar>
}
