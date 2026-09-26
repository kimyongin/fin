import TagChip from '../../components/TagChip'

export default function ActivityTagPicker({ disabled = false, onChange, selectedIds = [], tags = [] }) {
  function toggle(id) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id])
  }

  return <fieldset className="min-w-0" disabled={disabled}>
    <legend className="sr-only">활동 태그</legend>
    <span aria-hidden="true" className="form-label block">활동 태그</span>
    <div className="mt-2 flex flex-wrap gap-2">
      {tags.map((tag) => <TagChip disabled={disabled} key={tag.id} onClick={() => toggle(tag.id)} selected={selectedIds.includes(tag.id)}>{tag.name}</TagChip>)}
      {selectedIds.length > 0 && <button className="type-action min-h-11 rounded-xl px-2 underline disabled:opacity-50" disabled={disabled} onClick={() => onChange([])} type="button">선택 해제</button>}
    </div>
    {tags.length === 0 && <p className="type-secondary mt-2 text-[var(--muted-ink)]">활동 페이지의 태그 관리에서 태그를 추가할 수 있습니다.</p>}
  </fieldset>
}
