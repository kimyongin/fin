import { useState } from 'react'
import { CopyIcon } from '../../components/icons'
import { writeClipboard } from '../../lib/clipboard'
import { buildBulkSnapshotCsv } from './snapshotCsv'
import ActivityKindBadge from './ActivityKindBadge'
import { TimelineEntry } from '../../components/Timeline'

const actionLabels = {
  create_account: '계좌 추가', update_account: '계좌 수정', delete_account: '계좌 삭제',
  create_instrument: '종목 추가', update_instrument: '종목 수정', delete_instrument: '종목 삭제',
  create_holding: '보유 종목 추가', update_holding: '보유 종목 수정', update_holding_avg_price: '평균 단가 수정', delete_holding: '보유 종목 삭제',
  create_tag: '태그 추가', update_tag: '태그 수정', delete_tag: '태그 삭제',
  sync_prices: '가격 동기화', update_viewer_profile: '공유 보기 설정 수정', update_strategy: '전략 수정',
  create_news_fact: '뉴스 팩트 기록', create_news_annotation: '뉴스 신호 의견 기록', update_news_annotation: '뉴스 의견 수정',
  update_news_fact: '뉴스 팩트 수정',
  delete_news_fact: '뉴스 팩트 삭제', delete_news_annotation: '뉴스 신호 의견 삭제',
  bulk_edit_portfolio: '표로 자산 일괄 수정',
  update_entity_note: '대상 메모 수정', save_operating_rule: '데이터 관리 규칙 저장',
  archive_operating_rule: '데이터 관리 규칙 보관', save_todo_bundle: 'ToDo 묶음 저장',
  create_general_task: '할 일 추가', update_general_task: '할 일 수정', complete_general_task: '활동',
  reopen_general_task: '할 일 다시 열기', pause_general_task: '할 일 보류', resume_general_task: '할 일 재개',
  cancel_general_task: '할 일 취소', record_manual_activity: '활동', verify_holding: '보유 정보 확인',
  link_trade_to_task: '체결과 실행 계획 연결', transition_execution_task: '실행 계획 상태 변경',
  transition_portfolio_task: '조사 과제 상태 변경', transition_investment_decision: '투자 판단 상태 변경',
  record_investment_decision: '투자 판단 기록', save_daily_briefing: '일일 점검 저장',
}

const fieldLabels = {
  account_name: '계좌', avg_price: '평균 단가', broker: '증권사', currency: '통화', display_name: '종목명',
  is_active: '사용 여부', manual_price: '수동 가격', manual_price_date: '가격 기준일', name: '이름', note: '메모',
  quantity: '수량', sharing_enabled: '공유 보기', sort_order: '정렬 순서', tag_id: '태그', ticker: '티커', viewer_password_updated_at: '비밀번호',
}

const ignoredFields = new Set(['id', 'user_id', 'account_id', 'created_at', 'updated_at'])
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

function repairMojibake(value) {
  if (typeof value !== 'string' || !/[\u00c0-\u00ff]/.test(value)) return value
  try {
    const repaired = utf8Decoder.decode(Uint8Array.from(value, (character) => character.charCodeAt(0)))
    return /[\uac00-\ud7a3]/.test(repaired) ? repaired : value
  } catch {
    return value
  }
}

function formatValue(value) {
  if (value == null || value === '') return '없음'
  if (typeof value === 'boolean') return value ? '사용' : '사용 안 함'
  if (typeof value === 'number') return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 6 }).format(value)
  if (typeof value === 'object') return JSON.stringify(value)
  return repairMojibake(String(value))
}

function comparableValue(value) {
  if (typeof value === 'string') return repairMojibake(value)
  if (Array.isArray(value)) return value.map(comparableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, comparableValue(item)]))
  }
  return value
}

function formatDate(value) {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full', timeZone: 'Asia/Seoul' }).format(new Date(value))
}

function formatTime(value) {
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Seoul' }).format(new Date(value))
}

function eventData(action) {
  return action.after_data ?? action.before_data ?? {}
}

function SnapshotCopyButton({ label, snapshot }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await writeClipboard(buildBulkSnapshotCsv(snapshot))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="relative">
      <button
        aria-label={`${label} CSV 복사`}
        className={`inline-flex h-5 items-center gap-0.5 rounded border px-1 font-medium transition [&>svg]:h-3 [&>svg]:w-3 ${copied ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--line)] text-[var(--muted-ink)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'}`}
        onClick={handleCopy}
        style={{ fontSize: '12px', lineHeight: '16px' }}
        title={`${label} CSV 복사`}
        type="button"
      >
        <CopyIcon />
        {label}
      </button>
      <span aria-live="polite" className="sr-only">{copied ? `${label} CSV를 복사했습니다.` : ''}</span>
    </div>
  )
}

function eventTarget(action) {
  if (action.title) return repairMojibake(action.title)
  const data = eventData(action)
  if (action.action_type === 'bulk_edit_portfolio') return `${data.row_count ?? 0}개 보유내역`
  return repairMojibake(data.title ?? data.display_name ?? data.name ?? data.ticker ?? data.account_name ?? action.target_table ?? '포트폴리오')
}

function eventContext(action) {
  if (['record_manual_activity', 'complete_general_task'].includes(action.action_type)) return ''
  const data = eventData(action)
  const values = action.target_table === 'accounts'
    ? [data.broker, data.note]
    : action.target_table === 'holdings'
      ? [data.ticker, data.account_name]
      : action.target_table === 'instruments'
        ? [data.ticker, data.currency]
        : [action.target_table]
  return values.filter(Boolean).map((value) => repairMojibake(String(value))).join(' · ')
}

function changedFields(action) {
  const before = action.before_data ?? null
  const after = action.after_data ?? null
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  return [...keys]
    .filter((key) => !ignoredFields.has(key))
    .filter((key) => JSON.stringify(comparableValue(before?.[key])) !== JSON.stringify(comparableValue(after?.[key])))
    .map((key) => ({ key, label: fieldLabels[key] ?? key, before: before?.[key], after: after?.[key] }))
}

function groupByDate(actions) {
  const groups = []
  for (const action of actions) {
    const label = formatDate(action.occurred_at ?? action.created_at)
    const current = groups.at(-1)
    if (!current || current.label !== label) groups.push({ label, actions: [action] })
    else current.actions.push(action)
  }
  return groups
}

export function ChangeSummary({ action }) {
  if (action.action_type === 'bulk_edit_portfolio') {
    const hasBulkSnapshot = action.before_data?.portfolio_snapshot && action.after_data?.portfolio_snapshot
    return <div className="grid gap-2"><p className="text-sm text-[var(--ink)]">표 편집으로 보유자산 {action.after_data?.row_count ?? 0}개를 저장했습니다.</p>{hasBulkSnapshot && <div className="flex items-center gap-1.5"><SnapshotCopyButton label="Before" snapshot={action.before_data.portfolio_snapshot} /><SnapshotCopyButton label="After" snapshot={action.after_data.portfolio_snapshot} /></div>}</div>
  }
  const changes = changedFields(action)
  if (changes.length === 0) return null
  return (
    <dl className="grid gap-1.5">
      {changes.map((change) => (
        <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3" key={change.key}>
          <dt className="text-xs font-medium text-[var(--muted-ink)]">{change.label}</dt>
          <dd className="min-w-0 break-words text-sm text-[var(--ink)]">
            {action.before_data && action.after_data ? `${formatValue(change.before)} → ${formatValue(change.after)}` : formatValue(action.after_data ? change.after : change.before)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function ActivityEvent({ action, onOpenActivity }) {
  if (onOpenActivity) {
    const meta = <><ActivityKindBadge completed={action.action_type === 'complete_general_task'} kind={action.record_kind} />{action.tags?.slice(0, 3).map((tag) => <span className="ml-1 rounded-full border border-[var(--line)] px-2 py-0.5" key={tag.id}>{tag.name}</span>)}{action.tags?.length > 3 && <span className="ml-1">+{action.tags.length - 3}</span>}{action.status === 'failed' && <span className="ml-2 text-red-200">실패</span>}</>
    return <TimelineEntry ariaLabel={eventTarget(action)} meta={meta} occurredAt={action.occurred_at ?? action.created_at} onOpen={() => onOpenActivity(action)} summary={action.result || action.conclusion || action.note} title={eventTarget(action)} />
  }
  const failed = action.status === 'failed'
  const narrativeActivity = ['record_manual_activity', 'complete_general_task'].includes(action.action_type)
  return (
    <li className="relative grid gap-3 py-4 pl-5 first:pt-0 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-5 sm:pl-0">
      <span aria-hidden="true" className={`absolute left-0 top-6 h-2.5 w-2.5 rounded-full sm:left-[6.18rem] ${failed ? 'bg-red-400' : action.source === 'agent' ? 'bg-[var(--accent)]' : 'bg-emerald-400'}`} />
      <time className="text-xs text-[var(--muted-ink)] sm:pt-1">{formatTime(action.occurred_at ?? action.created_at)}</time>
      <article className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <ActivityKindBadge completed={action.action_type === 'complete_general_task'} kind={action.record_kind} />
          {onOpenActivity ? <button className="text-left text-sm font-semibold text-[var(--ink)] hover:text-[var(--accent)]" onClick={() => onOpenActivity(action)} type="button">{eventTarget(action)}</button> : <h3 className="text-sm font-semibold text-[var(--ink)]">{eventTarget(action)}</h3>}
          {!narrativeActivity && <span className="text-sm text-[var(--muted-ink)]">{actionLabels[action.action_type] ?? action.action_type}</span>}
          <span className={`rounded-full border px-2 py-0.5 text-xs ${failed ? 'border-red-400/40 text-red-100' : 'border-[var(--line)] text-[var(--muted-ink)]'}`}>{failed ? '실패' : action.source === 'agent' ? '에이전트' : '앱'}</span>
        </div>
        {eventContext(action) && <p className="mt-1 text-xs text-[var(--muted-ink)]">{eventContext(action)}{action.target_id ? ` · #${action.target_id}` : ''}</p>}
        {(action.result || action.conclusion || action.note) && <div className="mt-3 grid gap-2 border-l-2 border-[var(--line)] pl-3">{action.result && <p className="text-sm leading-6"><span className="font-medium">결과:</span> {repairMojibake(action.result)}</p>}{action.conclusion && <p className="text-sm leading-6"><span className="font-medium">결론:</span> {repairMojibake(action.conclusion)}</p>}{action.note && <p className="text-sm leading-6 text-[var(--muted-ink)]">{repairMojibake(action.note)}</p>}</div>}
        {!narrativeActivity && <div className="mt-3 border-l-2 border-[var(--line)] pl-3"><ChangeSummary action={action} /></div>}
        {action.source === 'agent' && action.natural_language_request && <p className="mt-3 text-sm leading-6 text-[var(--muted-ink)]"><span className="font-medium text-[var(--ink)]">요청:</span> {repairMojibake(action.natural_language_request)}</p>}
        {action.error_message && <p className="mt-3 text-sm text-red-100">{repairMojibake(action.error_message)}</p>}
      </article>
    </li>
  )
}

export default function ActivityEventViewer({ actions, loading, onOpenActivity, showDateGroups = true }) {
  if (!loading && actions.length === 0) {
    return <p className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm text-[var(--muted-ink)]">아직 기록된 작업이 없습니다.</p>
  }
  if (!showDateGroups) {
    return <ol className="relative border-l border-[var(--line)] sm:border-l-0">{actions.map((action) => <ActivityEvent action={action} key={action.id} onOpenActivity={onOpenActivity} />)}</ol>
  }
  return (
    <div className="grid gap-5">
      {groupByDate(actions).map((group) => (
        <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]" key={group.label}>
          <h2 className="border-b border-[var(--line)] pb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">{group.label}</h2>
          <ol className="relative mt-4 border-l border-[var(--line)] sm:border-l-0">
            {group.actions.map((action) => <ActivityEvent action={action} key={action.id} onOpenActivity={onOpenActivity} />)}
          </ol>
        </article>
      ))}
    </div>
  )
}
