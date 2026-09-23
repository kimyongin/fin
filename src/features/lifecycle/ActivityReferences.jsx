import { useEffect, useRef, useState } from 'react'

const fieldClass = 'min-h-11 w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm text-[var(--ink)]'

export default function ActivityReferences({ disabled = false, holdingId, holdingSummary, onHoldingChange, onTaskChange, supabase, taskId, taskSummary }) {
  const [tasks, setTasks] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [holdings, setHoldings] = useState([])
  const [holdingQuery, setHoldingQuery] = useState('')
  const [error, setError] = useState('')
  const [loadingTasks, setLoadingTasks] = useState(false)
  const holdingRequest = useRef(0)

  async function loadTasks(cursor = null) {
    setLoadingTasks(true)
    setError('')
    const { data, error: nextError } = await supabase.rpc('app_list_general_task_page', {
      input_filter: 'all', input_limit: 100, input_cursor: cursor,
    })
    if (nextError) setError('할 일 목록을 불러오지 못했습니다.')
    else {
      setTasks((current) => cursor ? [...current, ...(data?.items ?? [])] : (data?.items ?? []))
      setNextCursor(data?.next_cursor ?? null)
    }
    setLoadingTasks(false)
  }

  useEffect(() => { loadTasks() }, [supabase])
  useEffect(() => {
    const request = ++holdingRequest.current
    const timer = setTimeout(async () => {
      const { data, error: nextError } = await supabase.rpc('app_find_holdings', { input_query: holdingQuery || null })
      if (holdingRequest.current !== request) return
      if (nextError) setError('보유 목록을 불러오지 못했습니다.')
      else setHoldings(data ?? [])
    }, 180)
    return () => clearTimeout(timer)
  }, [holdingQuery, supabase])

  const selectedTask = taskId && !tasks.some((task) => task.id === taskId)
    ? [{ id: taskId, title: taskSummary?.title ?? `할 일 ${taskId}` }] : []
  const selectedHolding = holdingId && !holdings.some((holding) => Number(holding.holding_id) === Number(holdingId))
    ? [{ holding_id: holdingId, account_name: holdingSummary?.account_name ?? '', display_name: holdingSummary?.display_name ?? `보유 #${holdingId}`, ticker: holdingSummary?.ticker ?? '' }] : []

  return <section className="grid gap-3 rounded-2xl border border-[var(--line)] p-4">
    <div><h4 className="text-sm font-semibold">관련 대상</h4><p className="mt-1 text-xs leading-5 text-[var(--muted-ink)]">탐색을 위한 연결입니다. 기록 저장만으로 할 일이 완료되거나 잔고가 바뀌지는 않습니다.</p></div>
    {error && <p className="text-xs text-red-200" role="alert">{error}</p>}
    <label className="grid gap-2 text-xs font-semibold text-[var(--muted-ink)]">관련 할 일
      <select className={fieldClass} disabled={disabled || loadingTasks} onChange={(event) => onTaskChange(event.target.value || null)} value={taskId ?? ''}>
        <option value="">연결 안 함</option>
        {[...selectedTask, ...tasks].map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
      </select>
    </label>
    {nextCursor && <button className="justify-self-start rounded-xl border border-[var(--line)] px-3 py-2 text-xs" disabled={disabled || loadingTasks} onClick={() => loadTasks(nextCursor)} type="button">이전 할 일 더 보기</button>}
    <label className="grid gap-2 text-xs font-semibold text-[var(--muted-ink)]">관련 보유 검색
      <input className={fieldClass} disabled={disabled} onChange={(event) => setHoldingQuery(event.target.value)} placeholder="계좌·종목명·티커" value={holdingQuery} />
    </label>
    <label className="grid gap-2 text-xs font-semibold text-[var(--muted-ink)]">관련 보유
      <select className={fieldClass} disabled={disabled} onChange={(event) => onHoldingChange(event.target.value ? Number(event.target.value) : null)} value={holdingId ?? ''}>
        <option value="">연결 안 함</option>
        {[...selectedHolding, ...holdings].map((holding) => <option key={holding.holding_id} value={holding.holding_id}>{holding.account_name} · {holding.display_name} ({holding.ticker})</option>)}
      </select>
    </label>
  </section>
}
