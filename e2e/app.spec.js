import { expect, test } from '@playwright/test'
import { callRpc, clickPageAction, openMenuTab, openPageActionMenu, signInAs } from './helpers'
import { assertMutationRpcSignatures } from '../scripts/deployment-rpc-contract.mjs'

test('protects an unsaved principle when cancelling its editor', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#strategy')
  await clickPageAction(page, '현재 원칙', '원칙 작성')
  const editor = page.getByRole('dialog', { name: '원칙 작성' })
  await editor.getByLabel('내용').fill('저장 전 원칙')
  await editor.getByRole('button', { name: '닫기' }).last().click()
  const discard = page.getByRole('dialog', { name: '변경 버리기' })
  await expect(discard.getByText('저장하지 않은 변경이 있습니다. 변경을 버리고 닫을까요?')).toBeVisible()
  expect(await editor.evaluate((element) => Boolean(element.closest('[inert]')))).toBe(true)
  await expect(discard.getByRole('button', { name: '계속 편집' })).toBeFocused()
  await discard.getByRole('button', { name: '계속 편집' }).click()
  await expect(editor.getByLabel('내용')).toHaveValue('저장 전 원칙')
  await expect(editor.getByRole('button', { name: '닫기' }).last()).toBeFocused()
  await editor.getByRole('button', { name: '닫기' }).last().click()
  await page.keyboard.press('Escape')
  await expect(discard).toHaveCount(0)
  await expect(editor.getByLabel('내용')).toHaveValue('저장 전 원칙')
  await editor.getByRole('button', { name: '닫기' }).last().click()
  await discard.getByRole('button', { name: '변경 버리기' }).click()
  await expect(editor).toBeHidden()
})

test('pages principle changes and opens the exact historical Markdown row', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#strategy')
  await page.route('**/rest/v1/rpc/app_list_principle_changes', async (route) => {
    const cursor = JSON.parse(route.request().postData() ?? '{}').input_cursor
    const items = cursor
      ? [{ id: 2, principle_id: 'same-principle', body: '## 첫 내용', change_note: null, change_type: 'added', effective_at: '2026-09-23T09:00:00Z' }]
      : [{ id: 4, principle_id: 'same-principle', body: '## 변경 내용', change_note: '투자 기간 수정', change_type: 'updated', effective_at: '2026-09-23T12:00:00Z' }]
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items, next_cursor: cursor ? null : { effective_at: '2026-09-23T12:00:00Z', id: 4 } }) })
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: '변경 이력' })).toBeVisible()
  await expect(page.getByText('투자 기간 수정')).toBeVisible()
  await page.getByRole('button', { name: '당시 원칙 보기' }).first().click()
  const latestTitle = await page.evaluate(() => new Date('2026-09-23T12:00:00Z').toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }))
  const latestDialog = page.getByRole('dialog', { name: latestTitle })
  await expect(latestDialog.getByRole('heading', { name: '변경 내용' })).toBeVisible()
  await expect(latestDialog.locator('time')).toHaveCount(0)
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(latestDialog).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await latestDialog.getByRole('button', { name: '닫기' }).last().click()
  await page.getByRole('button', { name: '이전 변경 더 보기' }).click()
  await expect(page.getByRole('region', { name: '원칙 변경 이력' }).getByText('원칙 추가')).toBeVisible()
  const dayToggle = page.getByRole('region', { name: '원칙 변경 이력' }).getByRole('button', { name: /2026년 9월 23일/ })
  await expect(dayToggle).toHaveCount(1)
  await dayToggle.click()
  await expect(dayToggle).toHaveAttribute('aria-expanded', 'false')
  await dayToggle.click()
  await expect(dayToggle).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: '당시 원칙 보기' }).last().click()
  const earlierTitle = await page.evaluate(() => new Date('2026-09-23T09:00:00Z').toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }))
  await expect(page.getByRole('dialog', { name: earlierTitle }).getByRole('heading', { name: '첫 내용' })).toBeVisible()
})

test('corrects and deletes one principles revision without losing the previous document', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#strategy')
  const first = `E2E 이전 원칙 ${Date.now()}`
  const mistaken = `E2E 잘못 저장한 원칙 ${Date.now()}`
  await clickPageAction(page, '현재 원칙', /^(원칙 작성|수정)$/)
  let editor = page.getByRole('dialog', { name: /원칙 (작성|수정)/ })
  await editor.getByLabel('내용 (마크다운)').fill(first)
  await editor.getByRole('button', { name: '저장' }).click()
  await expect(page.getByRole('region', { name: '현재 원칙' }).getByText(first)).toBeVisible()
  await clickPageAction(page, '현재 원칙', '수정')
  editor = page.getByRole('dialog', { name: '원칙 수정' })
  await editor.getByLabel('내용 (마크다운)').fill(mistaken)
  await editor.getByRole('button', { name: '저장' }).click()
  await expect(page.getByRole('region', { name: '현재 원칙' }).getByText(mistaken)).toBeVisible()
  await page.getByRole('button', { name: '당시 원칙 보기' }).first().click()
  await page.getByRole('button', { name: '잘못된 내용 정정' }).click()
  const correction = page.getByRole('dialog', { name: '원칙 이력 정정' })
  await correction.getByLabel('내용 (마크다운)').fill(`${mistaken} 정정`)
  await correction.getByRole('button', { name: '정정 저장' }).click()
  await expect(page.getByRole('region', { name: '현재 원칙' }).getByText(`${mistaken} 정정`)).toBeVisible()
  await page.getByRole('button', { name: '당시 원칙 보기' }).first().click()
  await page.getByRole('button', { name: '이력 삭제' }).click()
  const confirmation = page.getByRole('dialog', { name: '원칙 이력 삭제' })
  await expect(confirmation).toContainText('이전 원칙이 다시 현재 원칙이 됩니다')
  await confirmation.getByRole('button', { name: '취소' }).click()
  await expect(page.getByRole('region', { name: '현재 원칙' }).getByText(`${mistaken} 정정`)).toBeVisible()
  await page.getByRole('button', { name: '이력 삭제' }).click()
  await confirmation.getByRole('button', { name: '이력 삭제' }).click()
  await expect(page.getByRole('region', { name: '현재 원칙' }).getByText(first)).toBeVisible()
  const current = await callRpc(page, 'app_list_principles', {
    input_on: null, input_timezone: 'Asia/Seoul', input_include_ended: false,
  })
  expect(current.body.items[0].body).toBe(first)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('read-only deployment check sees every required mutation RPC signature', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#tasks')
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('sb-127-auth-token')).access_token)
  const response = await page.request.get(`${process.env.VITE_SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, Accept: 'application/openapi+json' },
  })
  expect(response.status()).toBe(200)
  expect(assertMutationRpcSignatures(await response.json())).toBeGreaterThan(0)
})

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
  await page.goto('/#overview')
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

test('finds a saved review by activity text on a mobile-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  const headline = `E2E 오늘의 결론 ${Date.now()}`
  const saved = await callRpc(page, 'app_create_activity', {
    input_idempotency_key: crypto.randomUUID(),
    input_payload: {
      title: headline, authored_via: 'app',
      body: '확인이 필요한 변화입니다. 외부 조사는 테스트에서 생략했습니다. 공식 자료: https://example.com/review',
    },
  })
  expect(saved.status, JSON.stringify(saved.body)).toBe(200)

  await page.reload()
  await expect(page).toHaveURL(/#overview$/)
  await openMenuTab(page, '활동')
  await page.route('**/functions/v1/activity-search', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"semantic unavailable in this test"}' }))
  await page.getByRole('textbox', { name: '활동 검색' }).fill(headline)
  await expect(page.getByText(headline).first()).toBeVisible()
  await page.getByRole('button', { name: headline }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByText(/확인이 필요한 변화입니다/)).toBeVisible()
  await expect(page.getByRole('dialog').getByText(/https:\/\/example.com\/review/)).toBeVisible()
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})

test('finds an old review through activity search', async ({ page }) => {
  const oldReview = {
    id: 100,
    title: `당시 기준으로 유지하되 다음 확인 조건을 기다립니다 ${'긴 제목 '.repeat(18)}`,
    occurred_at: '2020-01-02T03:00:00Z',
    body: '중요 변화 3. 다음 조건을 기다립니다.',
  }
  await signInAs(page, 'e2e-owner@example.com')
  await page.route('**/functions/v1/activity-search', (route) => route.fulfill({
    contentType: 'application/json',
    status: 200,
    body: JSON.stringify({ items: [{ ...oldReview, record_type: 'activity', record_state: 'done', record_id: '100', activity_id: 100 }], next_cursor: null }),
  }))
  await page.goto('/#today')
  await expect(page).toHaveURL(/#tasks$/)
  await page.getByRole('button', { name: '전체 기간' }).click()
  await page.getByRole('textbox', { name: '활동 검색' }).fill('당시 기준')
  await expect(page.getByText(oldReview.title)).toBeVisible()
  await expect(page.getByText(oldReview.body)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('shows a saved decision activity as a choice rather than a trade', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#tasks')
  const title = `E2E 판단 활동 ${Date.now()}`
  const saved = await callRpc(page, 'app_create_activity', {
    input_idempotency_key: crypto.randomUUID(),
    input_payload: {
      title, authored_via: 'app',
      body: '공시에서 확인한 사실. 내가 채택한 선택: 현재는 유지. 다음 실적에서 재검토. 실적 자료: https://example.com/earnings',
    },
  })
  expect(saved.status, JSON.stringify(saved.body)).toBe(200)
  await page.goto('/#tasks')
  await page.reload()
  await expect(page.getByText(title)).toBeVisible()
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(page.getByRole('dialog', { name: '기록 상세' }).getByText(/내가 채택한 선택: 현재는 유지/)).toBeVisible()
  await expect(page.getByRole('dialog', { name: '기록 상세' }).getByText(/다음 실적에서 재검토/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('keeps a decision and an independent future task without implying a trade', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  const suffix = Date.now()
  const question = `E2E 보유 판단 ${suffix}`
  const taskTitle = `E2E 다음 실적 확인 ${suffix} ${'긴이름'.repeat(30)}`
  const recorded = await callRpc(page, 'app_create_activity', {
    input_idempotency_key: crypto.randomUUID(),
    input_payload: {
      title: question, body: '공식 실적에서 확인할 지표를 정했다. 현재는 유지. 다음 실적에서 핵심 가설을 다시 확인합니다.',
      authored_via: 'app',
    },
  })
  expect(recorded.status, JSON.stringify(recorded.body)).toBe(200)
  const followUp = await callRpc(page, 'app_create_general_task_with_tags', {
    input_idempotency_key: crypto.randomUUID(),
    input_tag_ids: [],
    input_payload: {
      title: taskTitle,
      subject: { kind: 'portfolio' },
      trigger_text: '다음 분기 실적 발표',
      authored_via: 'app',
    },
  })
  expect(followUp.status, JSON.stringify(followUp.body)).toBe(200)

  const resolvedAnswer = '공식 실적에서 확인할 지표가 기준을 충족했습니다.'
  const resolved = await callRpc(page, 'app_transition_general_task', {
    input_task_id: followUp.body.id,
    input_expected_version: followUp.body.version,
    input_action: 'complete',
    input_result: resolvedAnswer,
    input_reason: null,
    input_occurrence_on: null,
    input_idempotency_key: crypto.randomUUID(),
    input_authored_via: 'app',
  })
  expect(resolved.status, JSON.stringify(resolved.body)).toBe(200)

  await openMenuTab(page, '활동')
  await expect(page.getByRole('button', { name: question, exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: question, exact: true }).first().click()
  await expect(page.getByRole('heading', { name: '기록 상세' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: '기록 상세' }).getByText('현재는 유지')).toBeVisible()
  await expect(page.getByRole('dialog', { name: '기록 상세' }).getByRole('button', { name: '후속 할 일 추가' })).toHaveCount(0)
  await page.getByRole('dialog', { name: '기록 상세' }).getByRole('button', { name: '닫기' }).first().click()
  await expect(page).toHaveURL(/#tasks$/)
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('heading', { level: 1, name: '활동' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})

test('deletes a task from its detail without deleting past records', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#tasks')
  const title = `E2E 삭제할 할 일 ${Date.now()}`
  const created = await callRpc(page, 'app_create_general_task_with_tags', {
    input_idempotency_key: crypto.randomUUID(), input_tag_ids: [],
    input_payload: { title, subject: { kind: 'portfolio' }, timezone: 'Asia/Seoul', authored_via: 'app' },
  })
  expect(created.status, JSON.stringify(created.body)).toBe(200)
  await page.reload()
  await page.getByRole('button', { name: new RegExp(title) }).first().click()
  const detail = page.getByRole('dialog', { name: '할 일 상세' })
  await expect(detail).toBeVisible()
  await detail.getByRole('button', { name: '할 일 삭제' }).click()
  await expect(page.getByRole('dialog', { name: '할 일 삭제' })).toBeVisible()
  await page.getByRole('dialog', { name: '할 일 삭제' }).getByRole('button', { name: '할 일 삭제' }).click()
  await expect(detail).toHaveCount(0)
  await expect(page.getByRole('button', { name: new RegExp(title) })).toHaveCount(0)
  const missing = await callRpc(page, 'app_get_general_task', { input_task_id: created.body.id })
  expect(missing.body).toBeNull()
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

  await openPageActionMenu(page, '현재 원칙')
  await page.getByRole('region', { name: '현재 원칙' }).getByRole('button', { name: /^(원칙 작성|수정)$/ }).click()
  const editor = page.getByRole('dialog', { name: /원칙 (작성|수정)/ })
  await editor.getByLabel('내용 (마크다운)').fill('장기 투자하고 자주 매매하지 않는다.')
  await editor.getByRole('button', { name: '저장' }).click()

  await expect(page.getByText('장기 투자하고 자주 매매하지 않는다.')).toBeVisible()
  const principles = await callRpc(page, 'app_list_principles', {
    input_on: null, input_timezone: 'Asia/Seoul', input_include_ended: false,
  })
  expect(principles.status, JSON.stringify(principles.body)).toBe(200)
  expect(principles.body.items).toEqual(expect.arrayContaining([expect.objectContaining({
    body: '장기 투자하고 자주 매매하지 않는다.',
  })]))
  const context = await callRpc(page, 'app_get_daily_context', {
    input_subject_tickers: null, input_timezone: 'Asia/Seoul',
  })
  expect(context.status, JSON.stringify(context.body)).toBe(200)
  expect(context.body.principles).toEqual(expect.arrayContaining([
    expect.objectContaining({ body: '장기 투자하고 자주 매매하지 않는다.' }),
  ]))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('revises one operating principle without a second history table', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '원칙')

  await openPageActionMenu(page, '현재 원칙')
  await page.getByRole('region', { name: '현재 원칙' }).getByRole('button', { name: /^(원칙 작성|수정)$/ }).click()
  let editor = page.getByRole('dialog', { name: /원칙 (작성|수정)/ })
  await editor.getByLabel('내용 (마크다운)').fill('## 미래에셋 XLS 잔고\n평균가는 매입금액을 수량으로 나눈다.')
  await editor.getByLabel('변경 메모 (선택)').fill('운영 원칙 추가')
  await editor.getByRole('button', { name: '저장' }).click()

  const ruleCard = page.locator('article').filter({ hasText: '미래에셋 XLS 잔고' }).first()
  await expect(ruleCard.getByText('평균가는 매입금액을 수량으로 나눈다.')).toBeVisible()
  await expect(page.getByRole('button', { name: '원칙 수정' })).toHaveCount(0)
  await expect(ruleCard.getByText('원칙', { exact: true })).toHaveCount(0)
  await clickPageAction(page, '현재 원칙', '수정')
  editor = page.getByRole('dialog', { name: '원칙 수정' })
  await editor.getByLabel('내용 (마크다운)').fill('## 미래에셋 XLS 잔고\n매입금액과 평가금액을 구분하고 수량 0은 계산하지 않는다.')
  await editor.getByLabel('변경 메모 (선택)').fill('평가금액 구분')
  await editor.getByRole('button', { name: '저장' }).click()
  await expect(ruleCard.getByText('매입금액과 평가금액을 구분하고 수량 0은 계산하지 않는다.')).toBeVisible()

  const beforeFinalEdit = await callRpc(page, 'app_list_principles', {
    input_on: null, input_timezone: 'Asia/Seoul', input_include_ended: false,
  })
  const saved = beforeFinalEdit.body.items.find((item) => item.body.includes('미래에셋 XLS 잔고'))
  expect(saved?.body).toContain('평가금액을 구분')
  await clickPageAction(page, '현재 원칙', '수정')
  await editor.getByLabel('내용 (마크다운)').fill('## 미래에셋 XLS 잔고\n최종 운영 기준')
  await editor.getByLabel('변경 메모 (선택)').fill('운영 기준 재정리')
  await editor.getByRole('button', { name: '저장' }).click()
  await expect(page.getByRole('region', { name: '현재 원칙' }).getByText('최종 운영 기준')).toBeVisible()
  await expect(page.getByRole('region', { name: '원칙 변경 이력' }).getByText('운영 기준 재정리')).toBeVisible()
  const afterFinalEdit = await callRpc(page, 'app_list_principles', {
    input_on: null, input_timezone: 'Asia/Seoul', input_include_ended: true,
  })
  expect(afterFinalEdit.body.items).toHaveLength(1)
  expect(afterFinalEdit.body.items[0].principle_id).toBe(saved.principle_id)
})

test('retries a principle after a lost save response without creating a second row', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#strategy')
  await openPageActionMenu(page, '현재 원칙')
  await page.getByRole('region', { name: '현재 원칙' }).getByRole('button', { name: /^(원칙 작성|수정)$/ }).click()
  const editor = page.getByRole('dialog', { name: /원칙 (작성|수정)/ })
  const body = `E2E 재시도 원칙 ${Date.now()}`
  await editor.getByLabel('내용 (마크다운)').fill(body)
  let loseResponse = true
  await page.route('**/rest/v1/rpc/app_save_principle_checked', async (route) => {
    if (!loseResponse) return route.continue()
    loseResponse = false
    await route.fetch()
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '응답 유실' }) })
  })
  await editor.getByRole('button', { name: '저장' }).click()
  await expect(page.getByRole('alert').getByText('응답 유실')).toBeVisible()
  await editor.getByRole('button', { name: '저장' }).click()
  await expect(editor).toBeHidden()
  const current = await callRpc(page, 'app_list_principles', { input_on: null, input_timezone: 'Asia/Seoul', input_include_ended: true })
  expect(current.status).toBe(200)
  expect(current.body.items.filter((item) => item.body === body)).toHaveLength(1)
})

test('retries only the principle list after a successful save and failed refresh', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#strategy')
  await openPageActionMenu(page, '현재 원칙')
  await page.getByRole('region', { name: '현재 원칙' }).getByRole('button', { name: /^(원칙 작성|수정)$/ }).click()
  const editor = page.getByRole('dialog', { name: /원칙 (작성|수정)/ })
  const body = `E2E 저장 후 목록 실패 ${Date.now()}`
  await editor.getByLabel('내용 (마크다운)').fill(body)
  let failList = true
  let saveCalls = 0
  await page.route('**/rest/v1/rpc/app_save_principle_checked', async (route) => { saveCalls += 1; await route.continue() })
  await page.route('**/rest/v1/rpc/app_list_principles', async (route) => {
    if (!failList) return route.continue()
    failList = false
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '목록 실패' }) })
  })
  await editor.getByRole('button', { name: '저장' }).click()
  await expect(editor).toBeHidden()
  await expect(page.getByRole('region', { name: '현재 원칙' }).getByRole('alert')).toContainText('목록 실패')
  await page.getByRole('region', { name: '현재 원칙' }).getByRole('button', { name: '다시 시도' }).click()
  await expect(page.getByText(body)).toBeVisible()
  expect(saveCalls).toBe(1)
})
