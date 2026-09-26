import { businessDate } from '../../lib/businessDate'
import CalendarDateField from '../../components/CalendarDateField'
import ClockTimeField from '../../components/ClockTimeField'

const days = ['월', '화', '수', '목', '금', '토', '일']
const inputClass = 'form-control'

export function scheduleSummary(task) {
  const kind = task.recurrenceKind ?? task.recurrence_kind ?? 'none'
  const weekdays = task.recurrenceWeekdays ?? task.recurrence_weekdays ?? []
  const at = task.recurrenceTime ?? task.recurrence_time
  const time = at ? ` · ${String(at).slice(0, 5)}` : ''
  if (kind === 'daily') return `매일${time}`
  if (kind === 'weekly') return `매주 ${weekdays.map((day) => days[day - 1]).filter(Boolean).join('·')}${time}`
  const date = task.dueDate ?? task.due_date
  return date ? `${date}${time}` : '날짜 미정'
}

export default function TaskScheduleFields({ draft, onChange }) {
  const recurring = draft.recurrenceKind !== 'none'
  return <section className="grid gap-4" aria-label="할 일 일정">
    <label className="form-field form-label">반복
      <select className={inputClass} onChange={(event) => onChange({ ...draft, recurrenceKind: event.target.value, recurrenceStartOn: event.target.value === 'none' ? '' : (draft.recurrenceStartOn || draft.dueDate || businessDate()), recurrenceWeekdays: event.target.value === 'weekly' ? draft.recurrenceWeekdays : [] })} value={draft.recurrenceKind}>
        <option value="none">반복 없음</option><option value="daily">매일</option><option value="weekly">매주</option>
      </select>
    </label>
    <CalendarDateField label={recurring ? '반복 시작일' : '예정일'} onChange={(value) => onChange({ ...draft, [recurring ? 'recurrenceStartOn' : 'dueDate']: value })} value={recurring ? draft.recurrenceStartOn : draft.dueDate} />
    {draft.recurrenceKind === 'weekly' && <fieldset><legend className="form-label mb-2">반복 요일</legend><div className="flex flex-wrap gap-2">{days.map((label, index) => {
      const day = index + 1
      const selected = draft.recurrenceWeekdays.includes(day)
      return <button aria-pressed={selected} className={`min-h-11 min-w-11 rounded-full border px-3 text-sm ${selected ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--line)]'}`} key={day} onClick={() => onChange({ ...draft, recurrenceWeekdays: selected ? draft.recurrenceWeekdays.filter((value) => value !== day) : [...draft.recurrenceWeekdays, day].sort() })} type="button">{label}</button>
    })}</div></fieldset>}
    <ClockTimeField label="예정 시간 (선택)" onChange={(value) => onChange({ ...draft, recurrenceTime: value })} value={draft.recurrenceTime} />
    <p className="type-secondary type-number text-[var(--muted-ink)]">{scheduleSummary(draft)}{recurring && draft.recurrenceStartOn ? ` · ${draft.recurrenceStartOn}부터` : ''} · 에이전트에 요청하면 도래한 일을 확인합니다.</p>
  </section>
}
