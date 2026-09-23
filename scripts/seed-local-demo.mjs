import { createHmac, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const baseUrl = 'http://127.0.0.1:54321'
const email = process.env.DEMO_OWNER_EMAIL
if (!email) throw new Error('Set DEMO_OWNER_EMAIL to the existing ordinary-local Supabase account to seed')
const status = spawnSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' })
if (status.status !== 0) throw new Error('Ordinary local Supabase is not running')
const env = Object.fromEntries(status.stdout.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^([A-Z_]+)=(.*)$/)
  return match ? [[match[1], match[2].replace(/^"|"$/g, '')]] : []
}))
if (env.API_URL !== baseUrl || !env.ANON_KEY || !env.SERVICE_ROLE_KEY || !env.JWT_SECRET) {
  throw new Error('Local Supabase URL or credentials do not match the guarded demo target')
}

async function json(response, label) {
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status} ${JSON.stringify(data)}`)
  return data
}

const users = await json(await fetch(`${baseUrl}/auth/v1/admin/users?per_page=100`, {
  headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SERVICE_ROLE_KEY}` },
}), 'List local users')
const owner = users.users?.find((user) => user.email === email)
if (!owner) throw new Error('Expected local owner account is missing; no demo data was written')

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
  aud: 'authenticated', email, exp: now + 3600, iat: now, iss: 'supabase',
  role: 'authenticated', sub: owner.id,
})}`
const token = `${unsigned}.${createHmac('sha256', env.JWT_SECRET).update(unsigned).digest('base64url')}`
const headers = { apikey: env.ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const verified = await json(await fetch(`${baseUrl}/auth/v1/user`, { headers }), 'Verify local owner token')
if (verified.id !== owner.id) throw new Error('Local owner token belongs to a different user')
console.log('Local owner authentication verified. No data has been written yet.')

async function rpc(name, args = {}) {
  return json(await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST', headers, body: JSON.stringify(args),
  }), name)
}

const initial = await rpc('app_get_portfolio_state', { input_owner_user_id: null })
const date = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

if (!initial.accounts?.some((item) => item.name?.startsWith('데모 ·'))) {
const accountFixtures = [
  ['데모 · 장기 투자', '미래에셋', '장기 보유와 목표 비중을 보는 계좌'],
  ['데모 · 연금 계좌', '미래에셋', '퇴직연금 ETF 예시'],
  ['데모 · 현금·대기', '은행', '예수금과 단기 대기 자금'],
]
for (const [name, broker, note] of accountFixtures) {
  await rpc('app_save_account', {
    input_account_id: null, input_name: name, input_broker: broker, input_note: note,
    input_source: 'user', input_request: null,
  })
}
const accountState = await rpc('app_get_portfolio_state', { input_owner_user_id: null })
const accountIds = Object.fromEntries(accountState.accounts
  .filter((item) => item.name?.startsWith('데모 ·')).map((item) => [item.name, item.id]))
if (Object.keys(accountIds).length !== accountFixtures.length) throw new Error('Could not read back all demo accounts')

const tagNames = ['데모 국내 주식', '데모 해외 주식', '데모 채권', '데모 배당', '데모 현금·대체']
for (const [index, name] of tagNames.entries()) {
  await rpc('app_save_tag', {
    input_tag_id: null, input_name: name, input_sort_order: index,
    input_source: 'user', input_request: null,
  })
}
const taggedState = await rpc('app_get_portfolio_state', { input_owner_user_id: null })
const tagIds = Object.fromEntries(taggedState.tags.filter((item) => tagNames.includes(item.name))
  .map((item) => [item.name, item.id]))
if (Object.keys(tagIds).length !== tagNames.length) throw new Error('Could not read back all demo tags')

const instruments = [
  ['005930.KS', '삼성전자', 'market', '데모 국내 주식', 82000],
  ['000660.KS', 'SK하이닉스', 'market', '데모 국내 주식', 188000],
  ['069500.KS', 'KODEX 200', 'market', '데모 국내 주식', 37200],
  ['360750.KS', 'TIGER 미국S&P500', 'market', '데모 해외 주식', 18900],
  ['379800.KS', 'KODEX 미국S&P500TR', 'market', '데모 해외 주식', 16300],
  ['148070.KS', 'KOSEF 국고채10년', 'market', '데모 채권', 106000],
  ['305540.KS', 'TIGER 2차전지테마', 'market', '데모 배당', 11700],
  ['DEMO:PRIVATE', '데모 비상장 평가자산', 'valuation', '데모 현금·대체', null],
  ['KRW', '원화 예수금', 'cash', '데모 현금·대체', null],
]
for (const [ticker, displayName, instrumentType, tagName, price] of instruments) {
  await rpc('app_save_instrument', {
    input_instrument_id: null, input_ticker: ticker, input_display_name: displayName,
    input_currency: 'KRW', input_instrument_type: instrumentType,
    input_price: price, input_price_date: date, input_tag_id: tagIds[tagName],
    input_note: '데모 데이터: 실제 투자 정보가 아닙니다.',
    input_source: 'user', input_request: null,
  })
}

const holdings = [
  ['데모 · 장기 투자', '005930.KS', 24, 71000],
  ['데모 · 장기 투자', '000660.KS', 9, 162000],
  ['데모 · 장기 투자', '360750.KS', 75, 17500],
  ['데모 · 장기 투자', '148070.KS', 8, 102000],
  ['데모 · 연금 계좌', '069500.KS', 42, 34900],
  ['데모 · 연금 계좌', '360750.KS', 110, 16900],
  ['데모 · 연금 계좌', '379800.KS', 56, 15100],
  ['데모 · 연금 계좌', '305540.KS', 30, 12800],
]
for (const [accountName, ticker, quantity, average] of holdings) {
  await rpc('app_save_holding', {
    input_holding_id: null, input_account_id: accountIds[accountName], input_ticker: ticker,
    input_quantity: quantity, input_avg_price: average,
    input_note: '데모 보유: 수량·평균가는 임의 값입니다.',
    input_source: 'user', input_request: null,
  })
}
await rpc('app_save_valuation_holding', {
  input_holding_id: null, input_account_id: accountIds['데모 · 장기 투자'],
  input_ticker: 'DEMO:PRIVATE', input_purchase_amount: 1200000,
  input_valuation_amount: 1350000, input_note: '데모 평가자산: 수동 평가값입니다.',
  input_source: 'user', input_request: null,
})
await rpc('app_save_cash_holding', {
  input_holding_id: null, input_account_id: accountIds['데모 · 현금·대기'],
  input_ticker: 'KRW', input_balance: 2800000,
  input_note: '데모 대기 자금: 실제 예수금이 아닙니다.',
  input_source: 'user', input_request: null,
})
console.log('Demo accounts, allocation tags, instruments, prices, and holdings saved through owner web RPCs.')
}

async function rows(table, query = '') {
  return json(await fetch(`${baseUrl}/rest/v1/${table}?select=*&${query}`, { headers }), `Read ${table}`)
}
const portfolio = await rpc('app_get_portfolio_state', { input_owner_user_id: null })
const allocationTags = Object.fromEntries(portfolio.tags.map((item) => [item.name, item.id]))
const instrumentIds = Object.fromEntries(portfolio.instruments.map((item) => [item.ticker, item.id]))
const accountIds = Object.fromEntries(portfolio.accounts.map((item) => [item.name, item.id]))
if (!instrumentIds['005930.KS'] || !accountIds['데모 · 장기 투자']) throw new Error('Demo portfolio is incomplete')

const strategy = await rpc('app_get_strategy_state', { input_owner_user_id: null })
if (!strategy.strategy) {
  const buckets = [
    ['국내 핵심', '데모 국내 주식', 35],
    ['해외 지수', '데모 해외 주식', 30],
    ['안정 채권', '데모 채권', 15],
    ['위성 투자', '데모 배당', 5],
    ['현금·대체', '데모 현금·대체', 15],
  ].map(([name, tag, target_percentage], sort_order) => ({
    name, sort_order, target_percentage,
    mode_targets: { growth: target_percentage, neutral: target_percentage, defensive: target_percentage },
    tag_ids: [allocationTags[tag]],
  }))
  await rpc('app_save_strategy', {
    input_name: '데모 · 균형 배분', input_monthly_contribution: 1500000,
    input_review_day: 15, input_drift_threshold: 5, input_buckets: buckets,
    input_mode: 'neutral', input_mode_reason: '데모: 현재는 중립 배분 예시',
    input_principles: { notes: '데모 값입니다. 실제 투자 원칙이 아닙니다.', max_trade_amount: 500000, monthly_trade_limit: 1500000, contribution_repair_months: 3 },
  })
}

const principleFixtures = [
  '데모 원칙 · 투자 전에는 내 비중과 현금 여력을 먼저 확인한다.',
  '데모 원칙 · 단일 종목 비중이 커지면 추가 매수보다 리스크를 먼저 검토한다.',
  '데모 원칙 · 확인하지 않은 뉴스만으로 매매하지 않는다.',
  '## 운영\n데모 운영 · 증권사 수량·평균가와 다르면 현재값을 직접 보정한다.',
]
const currentPrinciples = await rpc('app_list_principles', { input_on: null, input_timezone: 'Asia/Seoul', input_include_ended: false })
const knownBodies = new Set(currentPrinciples.items?.map((item) => item.body))
for (const body of principleFixtures) {
  if (knownBodies.has(body)) continue
  await rpc('app_save_principle', {
    input_principle_id: randomUUID(), input_expected_row_id: null,
    input_body: body, input_change_note: '데모 원칙 등록', input_end: false,
  })
}

const demoInstrument = instrumentIds['005930.KS']
const currentNotes = await rpc('app_list_private_holding_notes')
const existingNote = currentNotes.items?.find((item) => item.instrument_id === demoInstrument && item.account_id == null)
if (!existingNote?.note) {
  await rpc('app_save_private_holding_note', {
    input_instrument_id: demoInstrument, input_account_id: null,
    input_expected_note: existingNote?.note ?? null,
    input_note: '데모 보유 이유: 장기 실적과 현금흐름을 확인한다. 실제 투자 판단이 아닙니다.',
  })
}

const activityTagNames = ['데모 실적', '데모 리스크', '데모 점검', '데모 매매', '데모 회고']
const existingActivityTags = await rpc('app_list_activity_tags', { input_query: null })
const activityTags = Object.fromEntries((Array.isArray(existingActivityTags) ? existingActivityTags : [])
  .map((item) => [item.name, item.id]))
for (const name of activityTagNames) {
  if (activityTags[name]) continue
  const saved = await rpc('app_save_activity_tag', {
    input_tag_id: null, input_expected_version: null,
    input_idempotency_key: randomUUID(), input_name: name,
  })
  activityTags[name] = saved.id
}

const taskFixtures = [
  ['데모 · 오늘 보유 수량 확인', null, 'none', '증권사 앱의 현재 수량과 비교', '데모 점검'],
  ['데모 · 다음 실적 발표 확인', date, 'none', '공식 공시가 나오면 핵심 지표 확인', '데모 실적'],
  ['데모 · 리스크 뉴스 점검', date, 'daily', '최근 24시간의 공식 자료만 확인', '데모 리스크'],
  ['데모 · 월간 비중 검토', null, 'none', '목표 비중과 차이를 보고 조정 필요 여부 기록', '데모 점검'],
  ['데모 · 현금 여력 점검 완료 예시', date, 'none', '실제 예수금과 비교', '데모 점검'],
  ['데모 · 매매 기록 완료 예시', date, 'none', '체결 후 수량·평균가 기록', '데모 매매'],
]
const existingTasks = await rows('portfolio_tasks', `user_id=eq.${owner.id}`)
const taskByTitle = Object.fromEntries(existingTasks.map((item) => [item.title, item]))
for (const [title, dueDate, recurrenceKind, triggerText, tagName] of taskFixtures) {
  if (taskByTitle[title]) continue
  const saved = await rpc('app_create_general_task_with_tags', {
    input_idempotency_key: randomUUID(), input_tag_ids: [activityTags[tagName]],
    input_payload: {
      title, subject: { kind: 'portfolio' }, due_date: dueDate,
      timezone: 'Asia/Seoul', trigger_text: triggerText,
      recurrence_kind: recurrenceKind,
      recurrence_start_on: recurrenceKind === 'daily' ? date : null,
      authored_via: 'app',
    },
  })
  taskByTitle[title] = saved
}
for (const title of ['데모 · 현금 여력 점검 완료 예시', '데모 · 매매 기록 완료 예시']) {
  const task = taskByTitle[title]
  const completed = await rows('activity_events', `user_id=eq.${owner.id}&task_id=eq.${task.id}&record_kind=eq.task`)
  if (completed.length) continue
  await rpc('app_transition_general_task', {
    input_task_id: task.id, input_expected_version: task.version,
    input_action: 'complete', input_result: '데모 수행 결과: 화면 흐름을 확인했습니다.',
    input_reason: null, input_occurrence_on: null,
    input_idempotency_key: randomUUID(), input_authored_via: 'app',
  })
}
console.log('Demo strategy, principles, private note, activity tags, and tasks saved through web RPCs.')

const activityFixtures = [
  ['데모 · 아침 포트폴리오 점검', 'review', 0, '데모 점검', '보유 종목과 가격 기준일을 확인했습니다.', '큰 변화 없음', '005930.KS'],
  ['데모 · 반도체 업황 자료 조사', 'research', 1, '데모 실적', '실제 뉴스가 아닌 예시 조사 기록입니다.', '다음 공시에서 확인할 항목 정리', '000660.KS'],
  ['데모 · 삼성전자 보유 판단', 'decision', 2, '데모 실적', '가상의 실적 확인 예시입니다.', '추가 매매 없이 보유', '005930.KS'],
  ['데모 · 연금 계좌 비중 확인', 'review', 3, '데모 점검', '해외 지수 ETF와 국내 ETF 비중을 비교했습니다.', '다음 월간 점검에서 재확인', '360750.KS'],
  ['데모 · 환율 영향 점검', 'research', 4, '데모 리스크', '환율 변화가 해외 지수 상품에 미치는 영향을 정리했습니다.', '환율 한 가지로 매매하지 않음', '379800.KS'],
  ['데모 · 거래 전 현금 확인', 'general', 5, '데모 매매', '예수금과 예정 거래액을 비교했습니다.', '매매하지 않음', null],
  ['데모 · 금리 변화 판단', 'decision', 6, '데모 리스크', '채권 가격 민감도를 예시로 확인했습니다.', '채권 비중 유지', '148070.KS'],
  ['데모 · 주간 투자 회고', 'retrospective', 7, '데모 회고', '체결보다 확인과 기록이 많았던 주입니다.', '다음 주에도 확인 후 판단', null],
  ['데모 · 가격 기준일 확인', 'review', 8, '데모 점검', '가격이 최신인지 상품별로 비교했습니다.', '오래된 가격은 별도 확인', '069500.KS'],
  ['데모 · 2차전지 리스크 조사', 'research', 9, '데모 리스크', '가상의 위험 시나리오를 정리했습니다.', '비중 확대 보류', '305540.KS'],
  ['데모 · 목표 배분 검토', 'general', 10, '데모 점검', '현재 비중과 목표 비중 차이를 보았습니다.', '즉시 리밸런싱 불필요', null],
  ['데모 · 실적 발표 전 확인 항목', 'research', 11, '데모 실적', '매출·이익·전망을 확인할 목록을 작성했습니다.', '공식 자료 발표를 기다림', '005930.KS'],
  ['데모 · 장기 투자 원칙 재확인', 'decision', 12, '데모 회고', '단기 변동과 원칙을 비교했습니다.', '원칙 유지', null],
  ['데모 · 현금성 자산 점검', 'review', 13, '데모 점검', '대기 자금과 투자 예산을 분리했습니다.', '대기 자금 유지', null],
  ['데모 · 월간 활동 요약', 'retrospective', 14, '데모 회고', '한 달간의 점검·판단·할 일을 훑어본 예시입니다.', '미완료 과제에 집중', null],
]
const existingEvents = await rows('activity_events', `user_id=eq.${owner.id}`)
const existingTitles = new Set(existingEvents.map((item) => item.title))
for (const [title, category, daysAgo, tagName, result, conclusion, ticker] of activityFixtures) {
  if (existingTitles.has(title)) continue
  const occurredAt = new Date(Date.now() - daysAgo * 86400000).toISOString()
  const context = category === 'review'
    ? { status: 'no_action', coverage_status: 'partial', scope: '데모 보유 종목' }
    : category === 'decision'
      ? { decision_state: 'proposed', selected_option: null, reason: '데모 예시이며 사용자 채택 판단이 아닙니다.' }
      : category === 'research'
        ? { scope: '데모 조사 범위' }
        : null
  await rpc('app_create_activity_with_tags', {
    input_idempotency_key: randomUUID(), input_tag_ids: [activityTags[tagName]],
    input_payload: {
      title, note: '데모 데이터입니다. 실제 뉴스·투자 조언이 아닙니다.',
      result, conclusion, occurred_at: occurredAt, timezone: 'Asia/Seoul',
      instrument_id: ticker ? instrumentIds[ticker] : null,
      account_id: ticker ? accountIds['데모 · 장기 투자'] : null,
      category, context, authored_via: 'app',
    },
  })
}

const feedback = await rpc('app_list_my_product_feedback', { input_cursor: null, input_limit: 20 })
if (!feedback.items?.some((item) => item.body?.startsWith('데모 피드백 ·'))) {
  await rpc('app_submit_product_feedback', {
    input_body: '데모 피드백 · 모바일에서 계좌와 보유 목록의 가독성을 확인하고 싶어요.',
    input_context: { page_key: 'overview' },
    input_source: 'app', input_idempotency_key: randomUUID(),
  })
}
console.log('Dated demo research, reviews, decisions, retrospectives, general records, and feedback saved.')

const financialEvents = await rows('activity_events', `user_id=eq.${owner.id}`)
if (!financialEvents.some((item) => item.action_type === 'log_completed_trade')) {
  const preview = await rpc('app_preview_trade_entry', {
    input_account_id: accountIds['데모 · 장기 투자'],
    input_instrument_id: instrumentIds['005930.KS'],
    input_side: 'buy', input_quantity: 2, input_unit_price: 83000,
    input_executed_on: date,
  })
  await rpc('app_record_completed_trade', {
    input_account_id: accountIds['데모 · 장기 투자'],
    input_instrument_id: instrumentIds['005930.KS'],
    input_side: 'buy', input_quantity: 2, input_unit_price: 83000,
    input_executed_on: date, input_expected_holding_id: preview.holding_id,
    input_expected_version: preview.holding_state_version,
    input_idempotency_key: randomUUID(), input_authored_via: 'app',
  })
}
if (!financialEvents.some((item) => item.action_type === 'reconcile_holding')) {
  const current = await rpc('app_get_portfolio_state', { input_owner_user_id: null })
  const holding = current.holdings.find((item) => item.account_id === accountIds['데모 · 장기 투자'] && item.ticker === '000660.KS')
  const values = { quantity: '10', avg_price: '161000' }
  const reason = '데모 기능 확인: 임의의 현재값으로 맞춤'
  const preview = await rpc('app_preview_holding_reconciliation', {
    input_holding_id: holding.id, input_values: values, input_reason: reason,
    input_effective_on: date, input_confirmed_fields: [],
  })
  await rpc('app_apply_holding_correction', {
    input_holding_id: holding.id, input_values: values, input_reason: reason,
    input_effective_on: date, input_confirmed_fields: [],
    input_expected_version: preview.holding_state_version,
    input_idempotency_key: randomUUID(), input_authored_via: 'app',
  })
}
console.log('Demo trade preview/confirmation and absolute holding correction checked through web RPCs.')

async function mcp(method, params = {}) {
  const response = await fetch(`${baseUrl}/functions/v1/portfolio-mcp-oauth`, {
    method: 'POST', headers: mcpHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
  })
  const body = await json(response, `MCP ${method}`)
  if (body.error || body.result?.isError) throw new Error(`MCP ${method}: ${JSON.stringify(body.error ?? body.result?.structuredContent?.error)}`)
  return body.result
}

const mcpEmail = 'fin-local-demo-mcp@example.invalid'
const mcpPassword = createHmac('sha256', env.JWT_SECRET).update('fin-local-demo-mcp-password').digest('hex')
const existingMcpUser = users.users?.find((user) => user.email === mcpEmail)
if (!existingMcpUser) {
  await json(await fetch(`${baseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: mcpEmail, password: mcpPassword, email_confirm: true }),
  }), 'Create local MCP demo user')
} else {
  await json(await fetch(`${baseUrl}/auth/v1/admin/users/${existingMcpUser.id}`, {
    method: 'PUT',
    headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: mcpPassword }),
  }), 'Refresh local MCP demo user password')
}
const mcpSession = await json(await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: env.ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: mcpEmail, password: mcpPassword }),
}), 'Sign in local MCP demo user')
const mcpHeaders = { ...headers, Authorization: `Bearer ${mcpSession.access_token}` }
async function mcpUserRpc(name, args = {}) {
  return json(await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: mcpHeaders, body: JSON.stringify(args),
  }), `MCP demo web RPC ${name}`)
}
const mcpUserState = await mcpUserRpc('app_get_portfolio_state', { input_owner_user_id: null })
if (!mcpUserState.accounts?.some((item) => item.name === '데모 · MCP 교차 검증')) {
  await mcpUserRpc('app_save_account', {
    input_account_id: null, input_name: '데모 · MCP 교차 검증',
    input_broker: '로컬 테스트', input_note: '웹 API에서 만들고 MCP로 읽는 계좌',
    input_source: 'user', input_request: null,
  })
}

const initialized = await mcp('initialize', {
  protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'local-demo-check', version: '1' },
})
if (initialized.protocolVersion !== '2025-06-18') throw new Error('MCP protocol initialization failed')
const discovered = await mcp('tools/list')
const names = new Set(discovered.tools?.map((tool) => tool.name))
for (const name of ['get_workflow_guide', 'get_portfolio_state', 'list_principles', 'search_activities', 'record_manual_activity']) {
  if (!names.has(name)) throw new Error(`MCP tool not discoverable: ${name}`)
}
async function tool(name, args) {
  const result = await mcp('tools/call', { name, arguments: args })
  return result.structuredContent?.data ?? result.structuredContent
}
const mcpPortfolio = await tool('get_portfolio_state', {})
if (!mcpPortfolio?.accounts?.some((item) => item.name === '데모 · MCP 교차 검증')) {
  throw new Error('MCP cannot read the demo account saved through web RPC')
}
if (mcpPortfolio.accounts.some((item) => item.name === '데모 · 장기 투자')) {
  throw new Error('MCP demo user can see the owner\'s private account')
}
const mcpPrinciples = await tool('list_principles', {})
if (!Array.isArray(mcpPrinciples?.items)) throw new Error('MCP principles list returned an invalid shape')
const mcpPrincipleBody = '데모 원칙 · MCP 기록은 웹에서도 같은 현재 원칙으로 보인다.'
if (!mcpPrinciples.items.some((item) => item.body === mcpPrincipleBody)) {
  await tool('save_principle', {
    schema_version: 1, principle_id: randomUUID(), expected_row_id: null,
    body: mcpPrincipleBody, change_note: 'MCP 데모', end: false,
  })
}
const webPrinciples = await mcpUserRpc('app_list_principles', {
  input_on: null, input_timezone: 'Asia/Seoul', input_include_ended: false,
})
if (!webPrinciples.items?.some((item) => item.body === mcpPrincipleBody)) {
  throw new Error('Web RPC did not read back the MCP-saved principle')
}
const mcpGuide = await tool('get_workflow_guide', { topic: 'daily_review' })
if (!mcpGuide?.steps?.length) throw new Error('MCP daily review workflow guide is unavailable')
const searchArgs = {
  query: '데모', from: null, to: null, record_state: 'all', has_conclusion: null,
  instrument_id: null, account_id: null, tag_ids: [], tag_match: 'all',
  limit: 30, cursor: null, timezone: 'Asia/Seoul',
}
const found = await tool('search_activities', searchArgs)
if (!Array.isArray(found?.items)) throw new Error('MCP activity search returned an invalid shape')
const mcpTitle = '데모 · MCP로 저장한 기록'
async function mcpUserActivities() {
  return json(await fetch(`${baseUrl}/rest/v1/activity_events?select=id,title,user_id&user_id=eq.${mcpSession.user.id}`, {
    headers: mcpHeaders,
  }), 'Read MCP demo activity through web REST')
}
if (!(await mcpUserActivities()).some((item) => item.title === mcpTitle)) {
  const mcpSaved = await tool('record_manual_activity', {
    schema_version: 1, idempotency_key: randomUUID(), title: mcpTitle,
    note: '데모 데이터입니다. 실제 투자 조언이 아닙니다.',
    result: 'MCP 도구 호출로 기록을 저장하고 웹 API로 다시 읽었습니다.',
    conclusion: '웹과 MCP가 같은 활동 데이터를 사용합니다.',
    occurred_at: new Date().toISOString(), timezone: 'Asia/Seoul',
    instrument_id: null, account_id: null, category: 'general', context: null,
    tag_ids: [],
  })
  if (!mcpSaved?.id) throw new Error('MCP activity write returned no ID')
}
const webReadback = await mcpUserActivities()
if (!webReadback.some((item) => item.title === mcpTitle)) throw new Error('Web REST did not read back the MCP-saved activity')
const mcpReadback = await tool('search_activities', { ...searchArgs, query: null })
if (!mcpReadback.items?.some((item) => item.title === mcpTitle)) {
  throw new Error('MCP search did not read back the MCP-saved activity')
}
console.log(`MCP initialize, discovery (${names.size} tools), guide, portfolio/principle/search reads and activity write→web readback passed.`)

const { chromium } = await import('@playwright/test')
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
      key: 'sb-127-auth-token',
      value: { access_token: token, token_type: 'bearer', expires_in: 3600,
        expires_at: now + 3600, refresh_token: 'local-demo-no-refresh', user: verified },
    })
    await page.goto('http://127.0.0.1:4173/#overview')
    await page.getByRole('region', { name: '보유 종목' }).waitFor({ timeout: 15000 })
    await page.getByText('삼성전자').first().waitFor({ timeout: 15000 })
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) {
      throw new Error(`Assets page overflows horizontally at ${width}px`)
    }
    await page.goto('http://127.0.0.1:4173/#tasks')
    await page.getByRole('heading', { name: '할 일', exact: true }).waitFor({ timeout: 15000 })
    await page.getByText('데모 · 오늘 보유 수량 확인').first().waitFor({ timeout: 15000 })
    await page.goto('http://127.0.0.1:4173/#strategy')
    await page.getByText('데모 원칙 · 투자 전에는 내 비중과 현금 여력을 먼저 확인한다.').first().waitFor({ timeout: 15000 })
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) {
      throw new Error(`Principles page overflows horizontally at ${width}px`)
    }
    await page.close()
  }
  console.log('Browser UI readback passed at 390px and 1440px for assets, activities, and principles.')
} finally {
  await browser.close()
}
