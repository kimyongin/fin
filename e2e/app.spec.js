import { expect, test } from '@playwright/test'
import { callRpc, signInAs } from './helpers'

async function openMenuTab(page, label) {
  const primaryLabel = ['판단', '할 일', '활동'].includes(label) ? '활동' : label
  const primary = page.locator('nav[aria-label="주요 메뉴"]:visible').getByRole('button', { name: primaryLabel, exact: true })
  if (await primary.count()) {
    await primary.click()
    return
  }
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.locator('nav[aria-label="보조 메뉴"]').getByRole('button', { name: label, exact: true }).click()
}

test('loads the owner portfolio with a virtual Supabase user session', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')

  const stateRequest = page.waitForResponse((response) =>
    response.url().includes('/rest/v1/rpc/app_get_portfolio_state') && response.status() === 200,
  )
  await page.goto('/')
  const state = await (await stateRequest).json()

  expect(state.accounts).toContainEqual(expect.objectContaining({ name: 'E2E Account' }))
  expect(state.instruments).toContainEqual(expect.objectContaining({ display_name: 'E2E Apple' }))
})

test('submits product feedback and lets an allowlisted operator return a result', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#today')
  await openMenuTab(page, '피드백')

  const body = `E2E 피드백 ${Date.now()} 모바일에서 필터를 더 쉽게 찾고 싶습니다.`
  await page.getByRole('textbox', { name: '피드백', exact: true }).fill(body)
  await page.getByRole('button', { name: '피드백 등록', exact: true }).click()
  await expect(page.getByText('피드백을 접수했습니다.')).toBeVisible()
  await expect(page.getByText(body, { exact: true })).toBeVisible()

  await page.getByRole('tab', { name: '전체 접수', exact: true }).click()
  const card = page.locator('article').filter({ hasText: body })
  await expect(card).toBeVisible()
  await card.getByLabel('상태').selectOption('resolved')
  await card.getByLabel('사용자에게 보일 답변').fill('다음 배포에서 모바일 탐색을 개선했습니다.')
  await card.getByLabel('GitHub 이슈 주소 (선택)').fill('https://github.com/kimyongin/fin/issues/68')
  await card.getByRole('button', { name: '처리 결과 저장', exact: true }).click()
  await page.getByRole('tab', { name: '내 피드백', exact: true }).click()
  await expect(page.getByText('처리 완료')).toBeVisible()
  await expect(page.getByText('다음 배포에서 모바일 탐색을 개선했습니다.')).toBeVisible()
  await expect(page.getByRole('link', { name: '연결된 개발 이슈 보기' })).toHaveAttribute('href', 'https://github.com/kimyongin/fin/issues/68')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('shows the latest saved daily review first on a mobile-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  const context = await callRpc(page, 'app_create_daily_context', {
    input_subject_tickers: null,
    input_timezone: 'Asia/Seoul',
  })
  expect(context.status, JSON.stringify(context.body)).toBe(200)

  const now = new Date()
  const headline = `E2E 오늘의 결론 ${Date.now()}`
  const saved = await callRpc(page, 'app_save_daily_briefing', {
    input_context_id: context.body.context_id,
    input_idempotency_key: crypto.randomUUID(),
    input_payload: {
      status: 'attention',
      headline,
      changes: [{ summary: '확인이 필요한 변화입니다.' }],
      uncertainties: [{ summary: '외부 조사는 테스트에서 생략했습니다.' }],
      evidence: [],
      scopes: [{
        scope_key: 'portfolio-review',
        subject_kind: 'portfolio',
        window_from: new Date(now.getTime() - 86400000).toISOString(),
        window_to: now.toISOString(),
        coverage: 'unverified',
        reason: 'E2E 화면 검증은 외부 조사를 수행하지 않습니다.',
        checked_at: now.toISOString(),
        evidence_keys: [],
        checked_sources: [],
      }],
    },
  })
  expect(saved.status, JSON.stringify(saved.body)).toBe(200)

  const relatedTaskTitle = `E2E 브리핑 후속 확인 ${Date.now()}`
  const relatedDecision = await callRpc(page, 'app_record_investment_decision', {
    input_idempotency_key: crypto.randomUUID(),
    input_payload: {
      status: 'proposed',
      subject: { kind: 'portfolio' },
      question: '이 브리핑의 변화를 다음 점검에서 어떻게 확인할까?',
      options: ['다음 점검에서 확인'],
      source_briefing_id: saved.body.id,
      timezone: 'Asia/Seoul',
      authored_via: 'app',
      follow_up_tasks: [{ title: relatedTaskTitle, subject: { kind: 'portfolio' }, trigger_text: '다음 점검' }],
    },
  })
  expect(relatedDecision.status, JSON.stringify(relatedDecision.body)).toBe(200)

  await page.reload()
  await expect(page).toHaveURL(/#today$/)
  await expect(page.getByText('오늘 저장한 점검')).toBeVisible()
  await expect(page.getByText(headline).first()).toBeVisible()
  await expect(page.getByText('자료 부족').first()).toBeVisible()
  await page.getByRole('button', { name: relatedTaskTitle }).click()
  await expect(page.getByRole('heading', { name: '할 일 상세' })).toBeVisible()
  await page.getByRole('button', { name: '판단 1 보기' }).click()
  await expect(page.getByRole('heading', { name: '판단 상세' })).toBeVisible()
  await page.getByRole('button', { name: '닫기' }).click()
  await openMenuTab(page, '오늘')
  await page.getByRole('button', { name: '전체 브리핑 보기' }).click()
  await expect(page.getByRole('heading', { name: '저장된 점검 상세' })).toBeVisible()
  await expect(page.getByText('확인이 필요한 변화입니다.').last()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('labels an old partial no-action review as a saved conclusion', async ({ page }) => {
  const oldReview = {
    id: '10000000-0000-0000-0000-000000000001',
    status: 'no_action',
    coverage_status: 'partial',
    headline: `당시 기준으로 유지하되 다음 확인 조건을 기다립니다 ${'긴 제목 '.repeat(18)}`,
    analyzed_at: '2020-01-02T03:00:00Z',
    timezone: 'Asia/Seoul',
    changes: [1, 2, 3, 4].map((number) => ({ summary: `중요 변화 ${number}` })),
    uncertainties: [],
    scopes: [],
    evidence: [],
  }
  await signInAs(page, 'e2e-owner@example.com')
  await page.route('**/rest/v1/rpc/app_list_daily_briefing_page', (route) => route.fulfill({
    contentType: 'application/json',
    status: 200,
    body: JSON.stringify({ items: [oldReview], next_cursor: null }),
  }))
  await page.route('**/rest/v1/rpc/app_get_daily_briefing', (route) => route.fulfill({
    contentType: 'application/json', status: 200, body: JSON.stringify(oldReview),
  }))
  await page.goto('/#today')

  await expect(page.getByText('마지막 저장 점검')).toBeVisible()
  await expect(page.getByText('추가 조치 없음').first()).toBeVisible()
  await expect(page.getByText('일부 조사').first()).toBeVisible()
  await expect(page.getByText('오늘 분석이 아니라 마지막으로 저장된 당시 결론입니다.')).toBeVisible()
  await expect(page.getByText('중요 변화 3')).toBeVisible()
  await expect(page.getByText('중요 변화 4')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('shows an adopted decision and its research follow-up without implying a trade', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  const suffix = Date.now()
  const question = `E2E 보유 판단 ${suffix}`
  const taskTitle = `E2E 다음 실적 확인 ${suffix} ${'긴이름'.repeat(30)}`
  const recorded = await callRpc(page, 'app_record_investment_decision', {
    input_idempotency_key: crypto.randomUUID(),
    input_payload: {
      status: 'proposed',
      subject: { kind: 'instrument', instrument_id: 'E2EAPL', label: 'E2E Apple' },
      question,
      options: ['유지', '축소 검토'],
      review_condition: '다음 분기 실적 발표',
      timezone: 'Asia/Seoul',
      authored_via: 'app',
      follow_up_tasks: [{
        title: taskTitle,
        subject: { kind: 'instrument', instrument_id: 'E2EAPL', label: 'E2E Apple' },
        trigger_text: '다음 분기 실적 발표',
      }],
    },
  })
  expect(recorded.status, JSON.stringify(recorded.body)).toBe(200)
  expect(recorded.body.tasks).toHaveLength(1)

  const adopted = await callRpc(page, 'app_transition_investment_decision', {
    input_decision_id: recorded.body.id,
    input_expected_version: 1,
    input_idempotency_key: crypto.randomUUID(),
    input_payload: {
      action: 'adopt',
      selected_option: '유지',
      reason: '다음 실적에서 핵심 가설을 다시 확인합니다.',
      authored_via: 'app',
    },
  })
  expect(adopted.status, JSON.stringify(adopted.body)).toBe(200)

  const resolvedAnswer = '공식 실적에서 확인할 지표가 기준을 충족했습니다.'
  const resolved = await callRpc(page, 'app_transition_portfolio_task', {
    input_task_id: recorded.body.tasks[0].id,
    input_expected_version: 1,
    input_idempotency_key: crypto.randomUUID(),
    input_payload: {
      action: 'resolve',
      answer: resolvedAnswer,
      reason: '공식 실적 발표 확인',
      authored_via: 'app',
      evidence: [{
        title: 'E2E official earnings release',
        source_url: 'https://example.com/e2e-earnings',
        summary: 'E2E 상태 전이 검증용 공식 자료입니다.',
        checked_at: new Date().toISOString(),
      }],
    },
  })
  expect(resolved.status, JSON.stringify(resolved.body)).toBe(200)

  await openMenuTab(page, '활동')
  await page.getByLabel('활동 목록 필터').getByRole('button', { name: '한 일', exact: true }).click()
  await expect(page.getByRole('button', { name: question, exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: question, exact: true }).first().click()
  await page.getByRole('button', { name: '판단 상세 보기' }).click()
  await expect(page.getByText('내가 채택함').first()).toBeVisible()
  await expect(page.getByText(taskTitle)).toBeVisible()
  await page.getByText(taskTitle).click()
  await expect(page.getByRole('heading', { name: '할 일 상세' })).toBeVisible()
  await expect(page.getByText(resolvedAnswer)).toBeVisible()
  await page.getByRole('button', { name: '이전 기록으로' }).click()
  await expect(page.getByRole('heading', { name: '판단 상세' })).toBeVisible()
  await expect(page.getByRole('heading', { name: question, exact: true }).last()).toBeVisible()
  await page.getByRole('button', { name: '닫기' }).click()
  await expect(page).toHaveURL(/#tasks$/)
  await expect(page.getByText('조사 과제 상태 변경', { exact: true }).first()).toBeVisible()
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('heading', { level: 1, name: '활동' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})

test('retries the combined work queue after a read error', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  let calls = 0
  await page.route('**/rest/v1/rpc/app_list_action_timeline', async (route) => {
    calls += 1
    if (calls <= 2) {
      await route.fulfill({ contentType: 'application/json', status: 500, body: JSON.stringify({ message: 'E2E lifecycle failure' }) })
      return
    }
    await route.continue()
  })
  await page.goto('/#tasks')
  await expect(page.getByText('E2E lifecycle failure')).toBeVisible()
  await page.getByRole('button', { name: '다시 시도' }).click()
  await expect.poll(() => calls).toBeGreaterThanOrEqual(3)
  await expect(page.getByRole('heading', { level: 1, name: '활동' })).toBeVisible()
})

test('saves private principles and reads the current revision on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '원칙')

  await page.getByRole('button', { name: '원칙 추가' }).click()
  const editor = page.getByRole('dialog', { name: '원칙 추가' })
  await editor.getByLabel('내용').fill('장기 투자하고 자주 매매하지 않는다.')
  await editor.getByRole('button', { name: '저장' }).click()

  await expect(page.getByText('장기 투자하고 자주 매매하지 않는다.')).toBeVisible()
  const principles = await callRpc(page, 'app_list_principles', {
    input_on: null, input_timezone: 'Asia/Seoul', input_include_ended: false,
  })
  expect(principles.status, JSON.stringify(principles.body)).toBe(200)
  expect(principles.body.items).toEqual(expect.arrayContaining([expect.objectContaining({
    kind: 'investment', body: '장기 투자하고 자주 매매하지 않는다.',
  })]))
  const context = await callRpc(page, 'app_create_daily_context', {
    input_subject_tickers: null, input_timezone: 'Asia/Seoul',
  })
  expect(context.status, JSON.stringify(context.body)).toBe(200)
  expect(context.body.snapshot.principles.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'investment', body: '장기 투자하고 자주 매매하지 않는다.' }),
  ]))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('revises and ends one operating principle without a second history table', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '원칙')

  await page.getByRole('button', { name: '원칙 추가' }).click()
  let editor = page.getByRole('dialog', { name: '원칙 추가' })
  await editor.getByLabel('분류').selectOption('operation')
  await editor.getByLabel('적용 범위 (선택)').fill('미래에셋 XLS 잔고')
  await editor.getByLabel('내용').fill('평균가는 매입금액을 수량으로 나눈다.')
  await editor.getByRole('button', { name: '저장' }).click()

  const ruleCard = page.locator('article').filter({ hasText: '미래에셋 XLS 잔고' }).first()
  await expect(ruleCard.getByText('평균가는 매입금액을 수량으로 나눈다.')).toBeVisible()
  await ruleCard.getByRole('button', { name: '수정' }).click()
  editor = page.getByRole('dialog', { name: '원칙 수정' })
  await editor.getByLabel('내용').fill('매입금액과 평가금액을 구분하고 수량 0은 계산하지 않는다.')
  await editor.getByRole('button', { name: '저장' }).click()
  await expect(ruleCard.getByText('매입금액과 평가금액을 구분하고 수량 0은 계산하지 않는다.')).toBeVisible()

  const beforeEnd = await callRpc(page, 'app_list_principles', {
    input_on: null, input_timezone: 'Asia/Seoul', input_include_ended: false,
  })
  const saved = beforeEnd.body.items.find((item) => item.scope === '미래에셋 XLS 잔고')
  expect(saved?.kind).toBe('operation')
  await ruleCard.getByRole('button', { name: '수정' }).click()
  await page.getByRole('dialog', { name: '원칙 수정' }).getByRole('button', { name: '적용 종료' }).click()
  await expect(page.getByText('미래에셋 XLS 잔고')).toHaveCount(0)
  const afterEnd = await callRpc(page, 'app_list_principles', {
    input_on: null, input_timezone: 'Asia/Seoul', input_include_ended: true,
  })
  expect(afterEnd.body.items.find((item) => item.principle_id === saved.principle_id)?.ended).toBe(true)
})

test('shows one unified action surface without legacy bundle controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '할 일')

  await expect(page.getByRole('heading', { level: 1, name: '활동' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: '활동과 판단 보기 전환' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '활동 추가', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '할 일 추가', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '한 일 기록', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '묶음 추가' })).toHaveCount(0)
  await expect(page.getByLabel('활동 목록 필터').getByRole('button', { name: '전체' })).toBeVisible()
})

test('creates and completes a general task while keeping manual work as activity', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '할 일')

  const taskTitle = `E2E 일반 할 일 ${Date.now()}`
  await page.getByRole('button', { name: '활동 추가', exact: true }).click()
  const taskDialog = page.getByRole('dialog', { name: '활동 추가' })
  await expect(taskDialog.getByLabel('이미 했음')).not.toBeChecked()
  await taskDialog.getByRole('textbox', { name: '할 일', exact: true }).fill(taskTitle)
  await taskDialog.getByLabel('확인할 때').fill('퇴근 전에 확인')
  await taskDialog.getByLabel('매일 반복').check()
  await expect(taskDialog.getByLabel('예정일')).toHaveCount(0)
  await expect(taskDialog.getByLabel('반복 시작일')).toBeVisible()
  await expect(taskDialog.locator('input[type="date"]')).toHaveCount(1)
  await taskDialog.getByRole('button', { name: '저장', exact: true }).click()
  const taskRow = page.getByText(taskTitle, { exact: true }).locator('..').locator('..')
  await expect(taskRow).toBeVisible()
  await expect(taskRow.getByText('매일 반복')).toBeVisible()
  await taskRow.getByRole('button', { name: '완료', exact: true }).click()
  const pendingSection = page.locator('section').filter({ has: page.getByRole('heading', { name: '지금 할 일' }) }).first()
  await expect(pendingSection.getByText(taskTitle, { exact: true })).toHaveCount(0)
  await expect(page.getByText(taskTitle, { exact: true })).toBeVisible()

  const activityTitle = `E2E 앱 밖 행동 ${Date.now()}`
  await page.getByRole('button', { name: '활동 추가', exact: true }).click()
  const activityDialog = page.getByRole('dialog', { name: '활동 추가' })
  await activityDialog.getByLabel('이미 했음').check()
  await expect(activityDialog.getByLabel('매일 반복')).toBeDisabled()
  await expect(activityDialog.getByLabel('수행일')).toBeVisible()
  await activityDialog.getByRole('textbox', { name: '한 일', exact: true }).fill(activityTitle)
  await activityDialog.getByLabel('결과 또는 메모').fill('증권사 기준을 확인함')
  await activityDialog.getByLabel('활동 종류 (선택)').selectOption('research')
  await activityDialog.getByRole('button', { name: '저장', exact: true }).click()
  await expect(activityDialog).toBeHidden()
  const events = await callRpc(page, 'app_list_recent_activity', { limit_count: 100, input_owner_user_id: null })
  expect(events.status, JSON.stringify(events.body)).toBe(200)
  expect(events.body).toContainEqual(expect.objectContaining({ action_type: 'complete_general_task' }))
  expect(events.body).toContainEqual(expect.objectContaining({ action_type: 'record_manual_activity' }))
  const manualEvent = events.body.find((event) => event.action_type === 'record_manual_activity' && event.after_data?.title === activityTitle)
  const detail = await callRpc(page, 'app_get_activity', { input_activity_id: manualEvent.id, input_owner_user_id: null })
  expect(detail.status, JSON.stringify(detail.body)).toBe(200)
  expect(detail.body.record_kind).toBe('research')

  const repeatingTitle = `E2E 종료할 반복 ${Date.now()}`
  await page.getByRole('button', { name: '활동 추가', exact: true }).click()
  const repeatDialog = page.getByRole('dialog', { name: '활동 추가' })
  await repeatDialog.getByRole('textbox', { name: '할 일', exact: true }).fill(repeatingTitle)
  await repeatDialog.getByLabel('매일 반복').check()
  await repeatDialog.getByRole('button', { name: '저장', exact: true }).click()
  await page.getByText(repeatingTitle, { exact: true }).click()
  const detailDialog = page.getByRole('dialog', { name: '할 일 상세' })
  await detailDialog.getByRole('button', { name: '반복 종료', exact: true }).click()
  await detailDialog.getByRole('button', { name: '반복 종료 확인' }).click()
  await expect(detailDialog).toBeHidden()
  await expect(pendingSection.getByText(repeatingTitle, { exact: true })).toHaveCount(0)
})

test('deletes a manual activity without offering deletion for automatic events', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#tasks')
  const title = `E2E 삭제할 조사 ${Date.now()}`
  const created = await callRpc(page, 'app_create_activity', {
    input_idempotency_key: crypto.randomUUID(),
    input_payload: { title, category: 'research', authored_via: 'app', timezone: 'Asia/Seoul' },
  })
  expect(created.status, JSON.stringify(created.body)).toBe(200)
  await page.reload()
  await page.getByRole('button', { name: title, exact: true }).click()
  const detail = page.getByRole('dialog', { name: '활동 상세' })
  await detail.getByRole('button', { name: '활동 삭제' }).click()
  await expect(detail.getByText('후속 할 일은 유지됩니다.')).toBeVisible()
  await detail.getByRole('button', { name: '삭제 확인' }).click()
  await expect(detail).toBeHidden()
  await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0)
  const deleted = await callRpc(page, 'app_get_activity', { input_activity_id: created.body.id, input_owner_user_id: null })
  expect(deleted.status).toBe(200)
  expect(deleted.body).toBeNull()
})

test('saves a private holding reason without exposing it in the shared portfolio DTO', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  const state = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(state.status, JSON.stringify(state.body)).toBe(200)
  const instrument = state.body.instruments.find((item) => item.ticker === 'E2EAPL')
  expect(instrument).toBeTruthy()

  await openMenuTab(page, '자산')
  await page.getByRole('tab').nth(2).click()
  const card = page.locator('article').filter({ hasText: 'E2E Apple' }).first()
  await card.getByRole('button', { name: '보유 메모 추가' }).click()
  const editor = page.getByRole('dialog', { name: 'E2E Apple 보유 메모' })
  await editor.getByLabel('보유 이유·다음 확인 조건').fill('장기 서비스 성장성을 보고 보유한다.')
  await editor.getByRole('button', { name: '메모 저장' }).click()

  await expect(card.getByText('장기 서비스 성장성을 보고 보유한다.')).toBeVisible()
  const notes = await callRpc(page, 'app_list_private_holding_notes')
  expect(notes.status, JSON.stringify(notes.body)).toBe(200)
  expect(notes.body.items).toContainEqual(expect.objectContaining({
    instrument_id: instrument.id, account_id: null, note: '장기 서비스 성장성을 보고 보유한다.',
  }))
  const publicState = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(JSON.stringify(publicState.body)).not.toContain('장기 서비스 성장성을 보고 보유한다.')

  const context = await callRpc(page, 'app_create_daily_context', {
    input_subject_tickers: null,
    input_timezone: 'Asia/Seoul',
  })
  expect(context.status, JSON.stringify(context.body)).toBe(200)
  expect(context.body.snapshot.private_holding_notes).toContainEqual(expect.objectContaining({
    instrument_id: instrument.id,
    note: '장기 서비스 성장성을 보고 보유한다.',
  }))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('previews and records a completed trade on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '자산')
  await page.getByRole('tab').nth(2).click()
  const card = page.locator('article').filter({ hasText: 'E2E Apple' }).first()
  const tradeButton = card.getByRole('button', { name: '매매 기록' })
  await tradeButton.click()
  const tradeDialog = page.getByRole('dialog', { name: 'E2E Apple 매매 기록' })
  await expect(tradeDialog).toBeVisible()
  await expect.poll(() => tradeDialog.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true)
  await expect.poll(() => page.locator('[inert]').count()).toBeGreaterThan(0)
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect.poll(() => tradeDialog.evaluate((dialog) => {
      const bounds = dialog.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= window.innerWidth
    })).toBe(true)
  }
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => tradeDialog.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(tradeDialog).toBeHidden()
  await expect(tradeButton).toBeFocused()
  await tradeButton.click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('체결 수량').fill('1')
  await page.getByLabel(/체결 단가/).fill('200')
  await page.getByRole('button', { name: '변경 미리보기' }).click()
  await expect(page.getByText('2 → 3')).toBeVisible()
  let dropFirstConfirmationResponse = true
  await page.route('**/rest/v1/rpc/app_log_completed_trade', async (route) => {
    if (!dropFirstConfirmationResponse) return route.continue()
    dropFirstConfirmationResponse = false
    await route.fetch()
    await route.abort('connectionreset')
  })
  await page.getByRole('button', { name: '체결 기록 확정' }).click()
  await expect(page.getByText(/같은 요청으로 다시 시도/)).toBeVisible()
  await page.getByRole('button', { name: '체결 기록 확정' }).click()
  await expect(page.getByRole('heading', { name: 'E2E Apple 매매 기록' })).toBeHidden()
  await page.unroute('**/rest/v1/rpc/app_log_completed_trade')

  const transactions = await callRpc(page, 'app_list_transactions', { input_limit: 10, input_before: null })
  expect(transactions.status, JSON.stringify(transactions.body)).toBe(200)
  expect(transactions.body.filter((item) => item.ticker === 'E2EAPL' && item.side === 'buy' && item.quantity === '1.0000000000000000')).toHaveLength(1)
  const state = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(state.body.holdings.find((item) => item.ticker === 'E2EAPL')).toMatchObject({ quantity: 3 })

  await card.getByRole('button', { name: '매매 기록' }).click()
  await expect(page.getByRole('button', { name: '기록 취소' })).toHaveCount(0)
  await expect(page.getByText(/증권사에서 확인한 현재 수량·평균가로 보정/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('reconciles and verifies one holding without broadening the checked fields', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '자산')
  await page.getByRole('tab').nth(2).click()
  const card=page.locator('article').filter({hasText:'E2E Apple'}).first()
  await card.getByRole('button',{name:'잔고 맞추기'}).click()
  await page.getByRole('textbox',{name:'수량'}).fill('4')
  await page.getByRole('textbox',{name:'평균가'}).fill('125')
  await page.getByRole('checkbox',{name:'수량'}).check()
  await page.getByLabel('보정 이유').fill('증권사 수량과 평균가로 현재값을 맞춥니다.')
  await page.getByRole('button',{name:'보정 미리보기'}).click()
  await expect(page.getByText(/3\.0000000000000000 → 4/)).toBeVisible()
  await page.getByRole('button',{name:'보정 확정'}).click()
  await expect(page.getByRole('heading',{name:'E2E Apple 잔고 맞추기'})).toBeHidden()
  const state=await callRpc(page,'app_get_portfolio_state',{input_owner_user_id:null})
  const holding=state.body.holdings.find((item)=>item.ticker==='E2EAPL')
  expect(holding).toMatchObject({quantity:4,avg_price:125})
  const integrity=await callRpc(page,'app_get_holding_integrity',{input_holding_id:holding.id})
  expect(integrity.body.last_verification.verified_fields).toEqual(['quantity'])
  expect(integrity.body.last_verification.changed_since).toBe(false)
})

test('starts the Google OAuth authorization redirect without using a Google account', async ({ page }) => {
  let authorizeUrl = ''
  await page.route('**/auth/v1/authorize**', async (route) => {
    authorizeUrl = route.request().url()
    await route.fulfill({ contentType: 'text/html', status: 200, body: '<title>E2E OAuth redirect</title>' })
  })
  await page.goto('/')
  await page.getByRole('button', { name: /Google/ }).click()
  await expect.poll(() => authorizeUrl).toContain('provider=google')
  expect(authorizeUrl).toContain('redirect_to=')
})

test('creates portfolio entities and records the owner activity', async ({ page }) => {
  const suffix = Date.now().toString()
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  const account = await callRpc(page, 'app_save_account', {
    input_account_id: null,
    input_broker: 'E2E Broker',
    input_name: `E2E CRUD Account ${suffix}`,
    input_note: 'Created by Playwright',
    input_request: 'E2E account create',
    input_source: 'user',
  })
  expect(account.status).toBe(200)
  const accountId = account.body[0].account_id

  const tag = await callRpc(page, 'app_save_tag', {
    input_name: `E2E CRUD Tag ${suffix}`,
    input_request: 'E2E tag create',
    input_sort_order: 10,
    input_source: 'user',
    input_tag_id: null,
  })
  expect(tag.status).toBe(200)
  const tagId = tag.body[0].tag_id

  const instrument = await callRpc(page, 'app_save_instrument', {
    input_currency: 'USD',
    input_display_name: `E2E CRUD Instrument ${suffix}`,
    input_instrument_id: null,
    input_instrument_type: 'market',
    input_note: 'Created by Playwright',
    input_price: 200,
    input_price_date: '2026-07-19',
    input_price_source: 'manual',
    input_request: 'E2E instrument create',
    input_source: 'user',
    input_tag_id: tagId,
    input_ticker: `E2E${suffix.slice(-8)}`,
  })
  expect(instrument.status).toBe(200)

  const holding = await callRpc(page, 'app_save_holding', {
    input_account_id: accountId,
    input_avg_price: 150,
    input_holding_id: null,
    input_note: 'Created by Playwright',
    input_quantity: 3,
    input_request: 'E2E holding create',
    input_source: 'user',
    input_ticker: `E2E${suffix.slice(-8)}`,
  })
  expect(holding.status).toBe(200)

  const activity = await callRpc(page, 'activity_list_recent_events', { limit_count: 10 })
  expect(activity.body.map((event) => event.action_type)).toEqual(expect.arrayContaining([
    'create_account',
    'create_holding',
    'create_instrument',
    'create_tag',
  ]))
})

test('edits and deletes portfolio entities while enforcing holding dependencies', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  const account = await callRpc(page, 'app_save_account', {
    input_account_id: null, input_broker: null, input_name: 'E2E Lifecycle Account', input_note: null, input_request: null, input_source: 'user',
  })
  const accountId = account.body[0].account_id
  const tag = await callRpc(page, 'app_save_tag', {
    input_name: 'E2E Lifecycle Tag', input_request: null, input_sort_order: 20, input_source: 'user', input_tag_id: null,
  })
  const tagId = tag.body[0].tag_id
  const instrument = await callRpc(page, 'app_save_instrument', {
    input_currency: 'USD', input_display_name: 'E2E Lifecycle Instrument', input_instrument_id: null, input_instrument_type: 'market', input_note: null,
    input_price: 100, input_price_date: '2026-07-19', input_price_source: 'manual', input_request: null, input_source: 'user', input_tag_id: tagId, input_ticker: 'E2ELIFE',
  })
  const instrumentId = instrument.body[0].instrument_id
  const holding = await callRpc(page, 'app_save_holding', {
    input_account_id: accountId, input_avg_price: 100, input_holding_id: null, input_note: null, input_quantity: 1, input_request: null, input_source: 'user', input_ticker: 'E2ELIFE',
  })
  const holdingId = holding.body[0].holding_id

  const updatedAccount = await callRpc(page, 'app_save_account', {
    input_account_id: accountId, input_broker: 'Updated broker', input_name: 'E2E Lifecycle Account Updated', input_note: 'Updated note', input_request: null, input_source: 'user',
  })
  expect(updatedAccount.body[0]).toMatchObject({ account_id: accountId, name: 'E2E Lifecycle Account Updated' })
  const updatedTag = await callRpc(page, 'app_save_tag', {
    input_name: 'E2E Lifecycle Tag Updated', input_request: null, input_sort_order: 21, input_source: 'user', input_tag_id: tagId,
  })
  expect(updatedTag.body[0]).toMatchObject({ tag_id: tagId, name: 'E2E Lifecycle Tag Updated' })
  const updatedInstrument = await callRpc(page, 'app_save_instrument', {
    input_currency: 'USD', input_display_name: 'E2E Lifecycle Instrument Updated', input_instrument_id: instrumentId, input_instrument_type: 'market', input_note: 'Updated note',
    input_price: 110, input_price_date: '2026-07-19', input_price_source: 'manual', input_request: null, input_source: 'user', input_tag_id: tagId, input_ticker: 'E2ELIFE',
  })
  expect(updatedInstrument.body[0]).toMatchObject({ instrument_id: instrumentId, display_name: 'E2E Lifecycle Instrument Updated' })
  const updatedHolding = await callRpc(page, 'app_save_holding', {
    input_account_id: accountId, input_avg_price: 105, input_holding_id: holdingId, input_note: 'Updated holding', input_quantity: 2, input_request: null, input_source: 'user', input_ticker: 'E2ELIFE',
  })
  expect(updatedHolding.body[0]).toMatchObject({ holding_id: holdingId, quantity: 2 })

  expect((await callRpc(page, 'app_delete_account', { input_account_id: accountId, input_request: null, input_source: 'user' })).status).toBe(400)
  expect((await callRpc(page, 'app_delete_instrument', { input_instrument_id: instrumentId, input_request: null, input_source: 'user' })).status).toBe(400)

  expect((await callRpc(page, 'app_delete_holding', { input_holding_id: holdingId, input_request: null, input_source: 'user' })).status).toBe(200)
  expect((await callRpc(page, 'app_delete_instrument', { input_instrument_id: instrumentId, input_request: null, input_source: 'user' })).status).toBe(200)
  expect((await callRpc(page, 'app_delete_tag', { input_request: null, input_source: 'user', input_tag_id: tagId })).status).toBe(200)
  expect((await callRpc(page, 'app_delete_account', { input_account_id: accountId, input_request: null, input_source: 'user' })).status).toBe(200)
  const lifecycleEvents = await callRpc(page, 'app_list_recent_activity', { input_owner_user_id: null, limit_count: 30 })
  expect(lifecycleEvents.body.map((event) => event.action_type)).toEqual(expect.arrayContaining([
    'update_account', 'update_holding', 'update_instrument', 'update_tag', 'delete_account', 'delete_holding', 'delete_instrument', 'delete_tag',
  ]))
})

test('deleting a tag unlinks it from its instrument without deleting the instrument', async ({ page }) => {
  const suffix = Date.now().toString().slice(-8)
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  const tag = await callRpc(page, 'app_save_tag', {
    input_name: `E2E Unlink ${suffix}`, input_request: null, input_sort_order: 99, input_source: 'user', input_tag_id: null,
  })
  const tagId = tag.body[0].tag_id
  const ticker = `E2EU${suffix}`
  const instrument = await callRpc(page, 'app_save_instrument', {
    input_currency: 'USD', input_display_name: 'E2E Unlinked Instrument', input_instrument_id: null, input_instrument_type: 'market', input_note: null,
    input_price: 1, input_price_date: '2026-07-19', input_price_source: 'manual', input_request: null, input_source: 'user', input_tag_id: tagId, input_ticker: ticker,
  })
  expect(instrument.status).toBe(200)
  expect((await callRpc(page, 'app_delete_tag', { input_request: null, input_source: 'user', input_tag_id: tagId })).status).toBe(200)
  const state = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(state.body.instruments).toContainEqual(expect.objectContaining({ ticker }))
  expect(state.body.instrumentTags).not.toContainEqual(expect.objectContaining({ ticker }))
})

test('adds a friend and grants only that user shared portfolio access', async ({ browser }) => {
  const ownerPage = await browser.newPage()
  await signInAs(ownerPage, 'e2e-owner@example.com')
  await ownerPage.goto('/')
  const initialPolicy = await callRpc(ownerPage, 'app_get_sharing_policy')
  const enabledPolicy = await callRpc(ownerPage, 'app_update_sharing_policy', {
    input_expected_version: initialPolicy.body.version,
    input_grants: { briefings: true, decisions: true, tasks: true },
  })
  expect(enabledPolicy.status).toBe(200)

  const friendPage = await browser.newPage()
  await signInAs(friendPage, 'e2e-friend@example.com')
  await friendPage.goto('/')

  const addFriend = await callRpc(friendPage, 'add_friend', {
    input_public_name: 'e2e-owner',
    input_viewer_password: 'e2e-password',
  })
  expect(addFriend.status).toBe(200)

  const sharedState = await callRpc(friendPage, 'app_get_portfolio_state', {
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
  })
  expect(sharedState.body.accounts).toContainEqual(expect.objectContaining({ name: 'E2E Account' }))

  await friendPage.reload()
  await friendPage.getByLabel('포트폴리오 전환').selectOption('00000000-0000-0000-0000-00000000e201')
  const sharedPrimary = friendPage.locator('nav[aria-label="주요 메뉴"]:visible')
  await expect(sharedPrimary.getByRole('button', { name: '오늘', exact: true })).toBeVisible()
  await expect(sharedPrimary.getByRole('button', { name: '자산', exact: true })).toBeVisible()
  await expect(sharedPrimary.getByRole('button', { name: '활동', exact: true })).toBeVisible()
  await expect(sharedPrimary.getByRole('button', { name: '원칙', exact: true })).toBeVisible()
  await friendPage.getByRole('button', { name: 'Open menu' }).click()
  const sharedMenu = friendPage.locator('nav[aria-label="보조 메뉴"]')
  await expect(sharedMenu.getByRole('button', { name: '오늘', exact: true })).toHaveCount(0)
  await expect(sharedMenu.getByRole('button', { name: '활동', exact: true })).toHaveCount(0)
  await expect(sharedMenu.getByRole('button', { name: '설정', exact: true })).toHaveCount(0)

  await friendPage.getByLabel('포트폴리오 전환').selectOption('owner')
  await expect(friendPage.getByText('E2E Apple')).toHaveCount(0)
  let releaseSharedRequest
  let markSharedRequest
  const sharedRequestSeen = new Promise((resolve) => { markSharedRequest = resolve })
  const releaseSharedResponse = new Promise((resolve) => { releaseSharedRequest = resolve })
  await friendPage.route('**/rest/v1/rpc/app_get_portfolio_state', async (route) => {
    if (route.request().postDataJSON()?.input_owner_user_id === '00000000-0000-0000-0000-00000000e201') {
      markSharedRequest()
      await releaseSharedResponse
    }
    await route.continue()
  })
  await friendPage.getByLabel('포트폴리오 전환').selectOption('00000000-0000-0000-0000-00000000e201')
  await sharedRequestSeen
  await friendPage.getByLabel('포트폴리오 전환').selectOption('owner')
  await expect(friendPage.getByLabel('포트폴리오 전환')).toHaveValue('owner')
  releaseSharedRequest()
  await expect(friendPage.getByText('E2E Apple')).toHaveCount(0)
  await friendPage.unroute('**/rest/v1/rpc/app_get_portfolio_state')

  await friendPage.getByLabel('포트폴리오 전환').selectOption('00000000-0000-0000-0000-00000000e201')
  expect((await callRpc(friendPage, 'app_list_portfolio_task_page', {
    input_cursor: null, input_filter: 'active', input_limit: 20,
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
  })).body.items).toBeInstanceOf(Array)

  expect((await callRpc(ownerPage, 'app_update_sharing_policy', {
    input_expected_version: enabledPolicy.body.version,
    input_grants: { briefings: false, decisions: false, tasks: false },
  })).status).toBe(200)
  expect((await callRpc(friendPage, 'app_list_portfolio_task_page', {
    input_cursor: null, input_filter: 'active', input_limit: 20,
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
  })).body.items).toEqual([])
  expect((await callRpc(friendPage, 'app_list_investment_decision_page', {
    input_cursor: null, input_filter: 'current', input_limit: 20,
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
  })).body.items).toEqual([])

  const outsiderPage = await browser.newPage()
  await signInAs(outsiderPage, 'e2e-outsider@example.com')
  await outsiderPage.goto('/')
  const blockedState = await callRpc(outsiderPage, 'app_get_portfolio_state', {
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
  })
  expect(blockedState.body.accounts).toEqual([])
})

test('saves a strategy, manages an agent token, and revokes friend access', async ({ browser }) => {
  const ownerPage = await browser.newPage()
  await signInAs(ownerPage, 'e2e-owner@example.com')
  await ownerPage.goto('/')

  const strategy = await callRpc(ownerPage, 'app_save_strategy', {
    input_buckets: [{ name: 'E2E Bucket', sort_order: 0, tag_ids: [1], target_percentage: 100 }],
    input_drift_threshold: 5,
    input_monthly_contribution: 100000,
    input_name: 'E2E Strategy',
    input_review_day: 1,
  })
  expect(strategy.status).toBe(200)
  expect(strategy.body.strategy).toMatchObject({ name: 'E2E Strategy' })
  const strategyState = await callRpc(ownerPage, 'app_get_strategy_state', { input_owner_user_id: null })
  expect(strategyState.body.strategy).toMatchObject({ name: 'E2E Strategy', review_day: 1 })

  const tokenHash = Date.now().toString(16).padStart(64, '0')
  const token = await callRpc(ownerPage, 'agent_create_token', {
    input_name: 'E2E Agent', input_token_hash: tokenHash, input_token_prefix: 'e2e_',
  })
  expect(token.status).toBe(200)
  expect((await callRpc(ownerPage, 'mcp_get_portfolio_state', { input_token_hash: tokenHash })).status).toBe(200)
  expect((await callRpc(ownerPage, 'agent_revoke_token', { input_token_id: token.body[0].id })).body[0].revoked_at).toBeTruthy()
  expect((await callRpc(ownerPage, 'mcp_get_portfolio_state', { input_token_hash: tokenHash })).status).toBe(400)

  const friendPage = await browser.newPage()
  await signInAs(friendPage, 'e2e-friend@example.com')
  await friendPage.goto('/')
  expect((await callRpc(friendPage, 'remove_friend', {
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
  })).status).toBe(200)
  const revokedState = await callRpc(friendPage, 'app_get_portfolio_state', {
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
  })
  expect(revokedState.body.accounts).toEqual([])
})

test('saves valuation and cash holdings, then bulk imports market rows', async ({ page }) => {
  const suffix = Date.now().toString().slice(-8)
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  const account = await callRpc(page, 'app_save_account', {
    input_account_id: null, input_broker: 'E2E', input_name: `E2E Nonmarket ${suffix}`, input_note: null, input_request: null, input_source: 'user',
  })
  const accountId = account.body[0].account_id
  const valuationTicker = `VALUATION:E2E${suffix}`
  const cashTicker = `CASH:E2E${suffix}`
  for (const instrument of [
    { ticker: valuationTicker, displayName: 'E2E Valuation', type: 'valuation' },
    { ticker: cashTicker, displayName: 'E2E Cash', type: 'cash' },
  ]) {
    const saved = await callRpc(page, 'app_save_instrument', {
      input_currency: 'KRW', input_display_name: instrument.displayName, input_instrument_id: null, input_instrument_type: instrument.type,
      input_note: null, input_price: null, input_price_date: null, input_price_source: 'manual', input_request: null, input_source: 'user', input_tag_id: null, input_ticker: instrument.ticker,
    })
    expect(saved.status).toBe(200)
  }

  const valuation = await callRpc(page, 'app_save_valuation_holding', {
    input_account_id: accountId, input_holding_id: null, input_note: 'E2E valuation', input_purchase_amount: 100000, input_request: null, input_source: 'user', input_ticker: valuationTicker, input_valuation_amount: 125000,
  })
  expect(valuation.status, JSON.stringify(valuation.body)).toBe(200)
  expect(valuation.body[0]).toMatchObject({ purchase_amount: 100000, valuation_amount: 125000 })
  const cash = await callRpc(page, 'app_save_cash_holding', {
    input_account_id: accountId, input_balance: 50000, input_holding_id: null, input_note: 'E2E cash', input_request: null, input_source: 'user', input_ticker: cashTicker,
  })
  expect(cash.body[0]).toMatchObject({ valuation_amount: 50000 })

  const bulk = await callRpc(page, 'app_bulk_save_portfolio_rows', {
    input_rows: [{
      account_name: `E2E Bulk ${suffix}`, avg_price: 10, broker: 'E2E', currency: 'USD', display_name: 'E2E Bulk Market', instrument_type: 'market', note: 'Bulk imported', quantity: 2, ticker: `E2EB${suffix}`,
    }],
  })
  expect(bulk.status).toBe(200)
  expect(bulk.body[0]).toMatchObject({ account_count: 1, holding_count: 1, instrument_count: 1 })
  const activities = await callRpc(page, 'app_list_recent_activity', { limit_count: 20, input_owner_user_id: null })
  expect(activities.body).toContainEqual(expect.objectContaining({ action_type: 'bulk_edit_portfolio', status: 'succeeded' }))
})

test('navigates the authenticated browser through strategy, activity, and settings pages', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  const policy = await callRpc(page, 'app_get_sharing_policy')
  await callRpc(page, 'app_update_sharing_policy', {
    input_expected_version: policy.body.version,
    input_grants: { briefings: false, decisions: false, tasks: false },
  })

  async function openTab(label, title) {
    await openMenuTab(page, label)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  }

  await openTab('원칙', '원칙')
  await openTab('활동', '활동')
  await openTab('설정', '설정')
  const reviewSharing = page.getByRole('button', { name: '투자 점검 기록도 공유' })
  await expect(reviewSharing).toHaveAttribute('aria-pressed', 'false')
  await reviewSharing.click()
  await expect(reviewSharing).toHaveAttribute('aria-pressed', 'true')
  const sharingPolicy = await callRpc(page, 'app_get_sharing_policy')
  expect(sharingPolicy.body.grants).toMatchObject({ briefings: true, decisions: true, tasks: true })
  await reviewSharing.click()
  await expect(reviewSharing).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText(/^버전 \d{8}T\d{6}Z$/)).toBeVisible()
  await openTab('가이드', '가이드')
  await expect(page.getByText('현재 자산을 입력하고, ChatGPT에서 첫 점검을 저장하세요')).toBeVisible()
})

test('keeps legacy news records accessible while new research belongs in activity', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#news')

  const suffix = Date.now()
  const originalFact = `E2E 뉴스 팩트 ${suffix}`
  const editedFact = `${originalFact} 수정`
  const opinion = `E2E 의견 ${suffix}`
  const created = await callRpc(page, 'app_save_news_fact', {
    input_fact_date: new Date().toISOString().slice(0, 10), input_country_code: 'US',
    input_axis: 'general', input_title: originalFact, input_source_name: '',
    input_source_url: '', input_body: originalFact,
  })
  expect(created.status).toBe(200)
  const factId = Array.isArray(created.body) ? created.body[0].id : created.body.id
  expect((await callRpc(page, 'app_save_news_fact_annotation', { input_fact_id: factId, input_signal: 'observe', input_body: opinion })).status).toBe(200)
  await page.reload()
  await expect(page.getByText('새 조사는 활동에서 기록하세요.')).toBeVisible()
  await expect(page.getByRole('button', { name: '뉴스 추가' })).toHaveCount(0)
  await expect(page.getByText(originalFact, { exact: true })).toBeVisible()
  await expect(page.getByText(opinion, { exact: true })).toBeVisible()

  const record = page.getByText(originalFact, { exact: true }).locator('xpath=ancestor::li')
  await record.getByRole('button', { name: '뉴스 기록 편집' }).click()
  const editDialog = page.getByRole('dialog', { name: '뉴스 기록 편집' })
  await editDialog.getByLabel('팩트').fill(editedFact)
  await editDialog.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByText(editedFact, { exact: true })).toBeVisible()

  await page.getByText(editedFact, { exact: true }).locator('xpath=ancestor::li').getByRole('button', { name: '뉴스 기록 편집' }).click()
  const deleteButton = page.getByRole('dialog', { name: '뉴스 기록 편집' }).getByRole('button', { name: '기록 삭제' })
  await deleteButton.click()
  await expect(page.getByText('삭제 확인')).toBeVisible()
  await deleteButton.click()
  await expect(page.getByText(editedFact, { exact: true })).toHaveCount(0)
})

test('guides a new user from empty assets through OAuth setup and first review', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-outsider@example.com')
  await page.goto('/#today')

  await expect(page.getByText('아직 저장된 점검이 없습니다.')).toBeVisible()
  await page.getByRole('button', { name: '연결 가이드 보기' }).click()
  await expect(page).toHaveURL(/#guide$/)
  await expect(page.getByText('/functions/v1/portfolio-mcp-oauth')).toBeVisible()
  await page.getByRole('button', { name: 'OAuth MCP 주소 복사' }).click()
  await expect(page.getByRole('button', { name: '복사했어요' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('portfolio-mcp-oauth')
  await page.getByRole('button', { name: '첫 점검 문구 복사' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('오늘 내 포트폴리오 점검하고 저장해줘')
  await expect(page.getByText('분석만 요청하면 저장하지 않습니다.')).toBeVisible()
  await expect(page.getByText('앱은 주문하지 않습니다.')).toBeVisible()
  await page.getByText('로그인 또는 승인을 취소함').click()
  await expect(page.getByText('Portfolio 데이터는 바뀌지 않습니다.')).toBeVisible()
  await page.getByRole('button', { name: '자산 입력하기' }).click()
  await expect(page).toHaveURL(/#overview$/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('keeps the saved strategy visible when valuation is incomplete', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await callRpc(page, 'app_save_strategy', {
    input_buckets: [{ name: 'E2E Allocation Bucket', sort_order: 0, tag_ids: [1], target_percentage: 100 }],
    input_drift_threshold: 1, input_monthly_contribution: 100000, input_name: 'E2E Display Strategy', input_review_day: 1,
  })
  await openMenuTab(page, '원칙')
  await expect(page.getByText('E2E Display Strategy')).toBeVisible()
  await expect(page.getByText('비중 계산을 잠시 멈췄습니다.')).toHaveCount(0)
  await openMenuTab(page, '자산')
  await page.getByRole('button', { name: '목표와 비교' }).click()
  await expect(page.getByText('비중 계산을 잠시 멈췄습니다.')).toBeVisible()
  await expect(page).toHaveURL(/#allocation$/)
  await page.getByRole('button', { name: '자산으로 돌아가기' }).click()
  await expect(page).toHaveURL(/#overview$/)
})

test('shows incomplete valuation explicitly and suppresses allocation amounts', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  const initialState = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  const missingTicker = `E2EMISS${Date.now().toString().slice(-8)}`
  expect((await callRpc(page, 'app_save_instrument', {
    input_currency: 'KRW', input_display_name: 'E2E Missing Price', input_instrument_id: null,
    input_instrument_type: 'market', input_note: null, input_price: null, input_price_date: null,
    input_price_source: 'manual', input_request: null, input_source: 'user', input_tag_id: null,
    input_ticker: missingTicker,
  })).status).toBe(200)
  expect((await callRpc(page, 'app_save_holding', {
    input_account_id: initialState.body.accounts[0].id, input_avg_price: 100, input_holding_id: null,
    input_note: null, input_quantity: 1, input_request: null, input_source: 'user',
    input_ticker: missingTicker,
  })).status).toBe(200)
  expect((await callRpc(page, 'app_save_strategy', {
    input_buckets: [{ name: 'E2E Quality Bucket', sort_order: 0, tag_ids: [initialState.body.tags[0].id], target_percentage: 100 }],
    input_drift_threshold: 1, input_monthly_contribution: 100000, input_name: 'E2E Quality Strategy', input_review_day: 1,
  })).status).toBe(200)

  const state = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(state.status, JSON.stringify(state.body)).toBe(200)
  expect(state.body.valuation_quality.unknown_position_count).toBeGreaterThan(0)
  expect(state.body.valuation_quality.is_complete).toBe(false)

  await page.reload()
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/#overview')
    await expect(page.getByText(/평가 불가 \d+개 제외/)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }

  await page.getByRole('button', { name: '목표와 비교' }).click()
  await expect(page.getByText('비중 계산을 잠시 멈췄습니다.')).toBeVisible()
  await expect(page.getByRole('heading', { name: '이번 달 적립금 배분' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '리밸런싱 제안' })).toHaveCount(0)
})

test('keeps four primary destinations usable without horizontal overflow', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const primary = page.locator('nav[aria-label="주요 메뉴"]:visible')
    await expect(primary.getByRole('button')).toHaveCount(4)
    await expect(primary.getByRole('button', { name: '오늘', exact: true })).toBeVisible()
    await expect(primary.getByRole('button', { name: '자산', exact: true })).toBeVisible()
    await expect(primary.getByRole('button', { name: '활동', exact: true })).toBeVisible()
    await expect(primary.getByRole('button', { name: '원칙', exact: true })).toBeVisible()
    await expect.poll(() => primary.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return {
        bottom: Math.round(box.bottom),
        left: Math.round(box.left),
        position: getComputedStyle(element).position,
        width: Math.round(box.width),
      }
    })).toEqual({ bottom: 900, left: 0, position: 'fixed', width })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }

  const assets = page.locator('nav[aria-label="주요 메뉴"]:visible').getByRole('button', { name: '자산', exact: true })
  await assets.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#overview$/)
  await page.getByRole('button', { name: 'Open menu' }).click()
  const secondary = page.locator('nav[aria-label="보조 메뉴"]')
  for (const label of ['피드백', '설정', '가이드']) await expect(secondary.getByRole('button', { name: label, exact: true })).toBeVisible()
  await expect(secondary.getByRole('button', { name: '자료', exact: true })).toHaveCount(0)
  await expect(secondary.getByRole('button', { name: '활동 내역', exact: true })).toHaveCount(0)
})

test('keeps shared page controls and editing surfaces consistent', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#overview')

  const accountTab = page.getByRole('tab', { name: '계좌 기준', exact: true })
  await accountTab.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: '종목 기준', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('End')
  await expect(page.getByRole('tab', { name: '표 편집', exact: true })).toHaveAttribute('aria-selected', 'true')

  await page.getByRole('button', { name: '전체 화면으로 표 편집' }).click()
  const spreadsheet = page.getByRole('dialog', { name: '표 편집' })
  await expect(spreadsheet).toBeVisible()
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(spreadsheet).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  const accountName = spreadsheet.getByLabel('계좌명').first()
  const initialAccountName = await accountName.inputValue()
  await accountName.fill(`${initialAccountName} 임시`)
  await spreadsheet.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(page.getByLabel('계좌명').first()).toHaveValue(`${initialAccountName} 임시`)

  await page.getByRole('tab', { name: '계좌 기준', exact: true }).click()
  await page.getByRole('button', { name: '계좌 추가' }).click()
  const accountEditor = page.getByRole('dialog', { name: '계좌 추가' })
  await accountEditor.getByLabel('계좌명').fill('저장 전 계좌')
  await accountEditor.getByRole('button', { name: '닫기', exact: true }).last().click()
  await expect(accountEditor.getByText('저장하지 않은 변경이 있습니다.')).toBeVisible()
  await accountEditor.getByRole('button', { name: '계속 편집' }).click()
  await expect(accountEditor.getByLabel('계좌명')).toHaveValue('저장 전 계좌')
  await accountEditor.getByRole('button', { name: '닫기', exact: true }).first().click()
  await accountEditor.getByRole('button', { name: '변경 버리기' }).click()
  await expect(accountEditor).toHaveCount(0)

  const destinations = [
    ['today', '오늘'],
    ['overview', '자산'],
    ['decisions', '활동'],
    ['tasks', '활동'],
    ['strategy', '원칙'],
    ['news', '자료'],
    ['activity', '활동'],
    ['feedback', '피드백'],
    ['settings', '설정'],
    ['guide', '가이드'],
  ]
  for (const [route, heading] of destinations) {
    await page.goto(`/#${route}`)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
  }
})

test('handles mocked price-sync Edge Function success and failure in the settings UI', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '설정')

  let calls = 0
  await page.route('**/functions/v1/sync-prices', async (route) => {
    calls += 1
    await route.fulfill(calls === 1
      ? {
          contentType: 'application/json',
          status: 200,
          body: JSON.stringify({ total_count: 1, synced: [{ ticker: 'AAPL', rows: 1 }], failed: [] }),
        }
      : { contentType: 'application/json', status: 500, body: JSON.stringify({ message: 'E2E sync failure' }) })
  })
  const button = page.getByRole('button', { name: '가격 동기화' })
  await button.click()
  await expect.poll(() => calls).toBe(1)
  await expect(page.getByText('1/1개 종목 확인, 새 가격 1건 저장.')).toBeVisible()
  await button.click()
  await expect.poll(() => calls).toBe(2)
})

test('handles mocked ticker-lookup Edge Function success and failure in the holding editor', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '자산')
  await page.getByRole('tab').nth(2).click()
  await page.getByRole('button', { name: '보유 추가' }).first().click()
  const tickerInput = page.locator('input[placeholder*="AAPL"]')
  let calls = 0
  await page.route('**/functions/v1/lookup-ticker', async (route) => {
    calls += 1
    await route.fulfill(calls === 1
      ? { contentType: 'application/json', status: 200, body: JSON.stringify({ ticker: 'E2ELOOKUP', display_name: 'E2E Lookup', currency: 'USD', instrument_type: 'market' }) }
      : { contentType: 'application/json', status: 500, body: JSON.stringify({ message: 'E2E lookup failure' }) })
  })
  await tickerInput.fill('E2ELOOKUP')
  const lookup = page.getByRole('button', { name: '조회' })
  await lookup.click()
  await expect.poll(() => calls).toBe(1)
  await tickerInput.fill('E2EFAIL')
  await lookup.click()
  await expect.poll(() => calls).toBe(2)
})

test('copies the visible portfolio as CSV from the browser header', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '자산')
  await page.getByRole('button', { name: 'CSV 복사' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('티커')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('E2EAPL')
})

test('renders saved data in every asset view', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '자산')
  const tabs = page.getByRole('tab')
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  await tabs.nth(1).click()
  await expect(page.getByText('E2E Account')).toBeVisible()
  await tabs.nth(2).click()
  await expect(page.getByText('E2E Apple')).toBeVisible()
  await tabs.nth(3).click()
  await expect(page.locator('input[value="E2E Apple"]')).toBeVisible()
})

test('unlocks a seeded shared portfolio through Supabase', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: '공유 보기' }).click()
  await page.locator('input').nth(0).fill('e2e-owner')
  await page.locator('input[type="password"]').fill('e2e-password')
  const stateRequest = page.waitForResponse((response) =>
    response.url().includes('/rest/v1/rpc/app_get_portfolio_state') && response.status() === 200,
  )
  await page.getByRole('button', { name: '공유 포트폴리오 보기' }).click()
  const state = await (await stateRequest).json()

  expect(state.accounts).toContainEqual(expect.objectContaining({ name: 'E2E Account' }))
  expect(state.instruments).toContainEqual(expect.objectContaining({ display_name: 'E2E Apple' }))
  await expect(page.getByText('e2e-owner', { exact: false })).toBeVisible()
})

test('rejects an invalid password for the shared portfolio', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '공유 보기' }).click()
  await page.locator('input').nth(0).fill('e2e-owner')
  await page.locator('input[type="password"]').fill('wrong-password')
  const rejected = page.waitForResponse((response) =>
    response.url().includes('/rest/v1/rpc/unlock_viewer_access') && response.status() === 400,
  )
  await page.getByRole('button', { name: '공유 포트폴리오 보기' }).click()
  await rejected
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})
