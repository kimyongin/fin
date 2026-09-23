import { activityKindLabels } from './activityKinds'

export default function ActivityKindBadge({ kind, completed = false }) {
  const label = kind === 'task' && completed ? '할 일 완료' : activityKindLabels[kind ?? 'general'] ?? '기타'
  return <span aria-label={`활동 종류: ${label}`} className="inline-flex rounded-full border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--accent)]">{label}</span>
}
