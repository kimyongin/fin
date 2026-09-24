import { expect, test } from '@playwright/test'
import { callRpc, openMenuTab, signInAs } from './helpers'

test('uses one simple title validation when switching between task and record', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#tasks')
  await page.getByRole('button', { name: '활동 추가', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '활동 추가' })
  await editor.getByLabel('이미 했음').check()
  await expect(editor.getByLabel('활동 종류')).toHaveCount(0)
  await expect(editor.getByRole('button', { name: '저장', exact: true })).toBeDisabled()
  await editor.getByRole('textbox', { name: '기록 제목' }).fill(`E2E 기록 전환 ${Date.now()}`)
  await expect(editor.getByRole('button', { name: '저장', exact: true })).toBeEnabled()
  await editor.getByLabel('이미 했음').uncheck()
  await expect(editor.getByRole('button', { name: '저장', exact: true })).toBeEnabled()
  await editor.getByLabel('이미 했음').check()
  await expect(editor.getByRole('button', { name: '저장', exact: true })).toBeEnabled()
})

test('keeps a detail draft and resets discarded edits', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#tasks')
  const title = `E2E 초안 보존 ${Date.now()}`
  const created = await callRpc(page, 'app_create_activity', { input_idempotency_key: crypto.randomUUID(), input_payload: { title, authored_via: 'app' } })
  expect(created.status).toBe(200)
  await page.reload()
  await page.getByRole('button', { name: title, exact: true }).click()
  const detail = page.getByRole('dialog', { name: '기록 상세' })
  await detail.getByRole('textbox', { name: '기록 제목' }).fill(`${title} 초안`)
  await expect(detail.getByRole('textbox', { name: '기록 제목' })).toHaveValue(`${title} 초안`)
  await detail.getByRole('button', { name: '닫기' }).first().click()
  await detail.getByRole('button', { name: '변경 버리기' }).click()
  await page.getByRole('button', { name: title, exact: true }).click()
  await expect(detail.getByRole('textbox', { name: '기록 제목' })).toHaveValue(title)
  await detail.getByRole('textbox', { name: '기록 제목' }).fill(`${title} 새 초안`)
  await detail.getByRole('button', { name: '닫기' }).first().click()
  await expect(detail.getByText('저장하지 않은 변경이 있습니다. 변경을 버리고 닫을까요?')).toBeVisible()
  await detail.getByRole('button', { name: '계속 편집' }).click()
  await expect(detail.getByRole('textbox', { name: '기록 제목' })).toHaveValue(`${title} 새 초안`)
})

test('shows one unified action surface without legacy bundle controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  let legacyPageCalls = 0
  await page.route('**/rest/v1/rpc/app_list_portfolio_task_page', (route) => { legacyPageCalls += 1; return route.abort() })
  await page.goto('/')
  await openMenuTab(page, '할 일')

  await expect(page.getByRole('heading', { level: 1, name: '활동' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: '활동과 판단 보기 전환' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '활동 추가', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '할 일 추가', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '한 일 기록', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '묶음 추가' })).toHaveCount(0)
  await expect(page.getByRole('group', { name: '활동 목록 필터' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '할 일' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '기록' })).toBeVisible()
  expect(legacyPageCalls).toBe(0)
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
  await taskDialog.getByRole('textbox', { name: '할 일 제목' }).fill(taskTitle)
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
  const pendingSection = page.locator('section').filter({ has: page.getByRole('heading', { name: '할 일' }) }).first()
  await expect(pendingSection.getByText(taskTitle, { exact: true })).toHaveCount(0)
  await expect(page.getByText(taskTitle, { exact: true }).first()).toBeVisible()

  const activityTitle = `E2E 앱 밖 행동 ${Date.now()}`
  await page.getByRole('button', { name: '활동 추가', exact: true }).click()
  const activityDialog = page.getByRole('dialog', { name: '활동 추가' })
  await activityDialog.getByLabel('이미 했음').check()
  await expect(activityDialog.getByLabel('매일 반복')).toBeDisabled()
  await expect(activityDialog.getByLabel('수행일')).toBeVisible()
  await activityDialog.getByRole('textbox', { name: '기록 제목' }).fill(activityTitle)
  await activityDialog.getByLabel('기록 내용').fill('증권사 기준을 확인함. 공식 공시: https://example.com/disclosure')
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(activityDialog).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await activityDialog.getByRole('button', { name: '저장', exact: true }).click()
  await expect(activityDialog).toBeHidden()
  const events = await callRpc(page, 'app_list_recent_activity', { limit_count: 100, input_owner_user_id: null })
  expect(events.status, JSON.stringify(events.body)).toBe(200)
  expect(events.body).toContainEqual(expect.objectContaining({ action_type: 'complete_general_task' }))
  expect(events.body).toContainEqual(expect.objectContaining({ action_type: 'record_manual_activity' }))
  const manualEvent = events.body.find((event) => event.action_type === 'record_manual_activity' && event.after_data?.title === activityTitle)
  const detail = await callRpc(page, 'app_get_activity', { input_activity_id: manualEvent.id, input_owner_user_id: null })
  expect(detail.status, JSON.stringify(detail.body)).toBe(200)
  expect(detail.body.body).toContain('https://example.com/disclosure')
  await page.getByRole('button', { name: activityTitle, exact: true }).click()
  await expect(page.getByRole('dialog', { name: '기록 상세' }).getByText(/공식 공시: https:\/\/example.com\/disclosure/)).toBeVisible()
  await page.getByRole('dialog', { name: '기록 상세' }).getByRole('button', { name: '닫기' }).first().click()

  const repeatingTitle = `E2E 종료할 반복 ${Date.now()}`
  await page.getByRole('button', { name: '활동 추가', exact: true }).click()
  const repeatDialog = page.getByRole('dialog', { name: '활동 추가' })
  await repeatDialog.getByRole('textbox', { name: '할 일 제목' }).fill(repeatingTitle)
  await repeatDialog.getByLabel('매일 반복').check()
  await repeatDialog.getByRole('button', { name: '저장', exact: true }).click()
  await page.getByText(repeatingTitle, { exact: true }).click()
  const detailDialog = page.getByRole('dialog', { name: '할 일 상세' })
  await detailDialog.getByRole('button', { name: '반복 종료', exact: true }).click()
  await detailDialog.getByRole('button', { name: '반복 종료 확인' }).click()
  await expect(detailDialog).toBeHidden()
  await expect(pendingSection.getByText(repeatingTitle, { exact: true })).toHaveCount(0)
})

test('edits a task title, schedule, and tags in one detail save', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#tasks')
  const title = `E2E 상세 편집 ${Date.now()}`
  const tagName = `상세태그${Date.now()}`
  await page.getByRole('button', { name: '활동 추가', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '활동 추가' })
  await editor.getByRole('textbox', { name: '할 일 제목' }).fill(title)
  await editor.getByRole('button', { name: '저장', exact: true }).click()
  const detailResponse = page.waitForResponse((response) => response.url().includes('/rpc/app_get_general_task'))
  await page.getByText(title, { exact: true }).click()
  const detail = page.getByRole('dialog', { name: '할 일 상세' })
  const taskId = (await (await detailResponse).json()).id
  await detail.getByRole('textbox', { name: '할 일 제목' }).fill(`${title} 수정`)
  await detail.getByLabel('예정일').fill('2026-10-02')
  await detail.getByRole('button', { name: /태그/ }).click()
  await detail.getByPlaceholder('새 태그').fill(tagName)
  await detail.getByPlaceholder('새 태그').locator('..').getByRole('button', { name: '추가', exact: true }).click()
  await expect(detail.getByRole('button', { name: '저장', exact: true })).toBeEnabled()
  await detail.getByRole('button', { name: '저장', exact: true }).click()
  await expect(detail.getByRole('textbox', { name: '할 일 제목' })).toHaveValue(`${title} 수정`)
  await expect(detail.getByRole('button', { name: '저장', exact: true })).toBeDisabled()
  const saved = await callRpc(page, 'app_get_general_task', { input_task_id: taskId })
  expect(saved.status, JSON.stringify(saved.body)).toBe(200)
  expect(saved.body).toMatchObject({ title: `${title} 수정`, due_date: '2026-10-02' })
  expect(saved.body.tags).toContainEqual(expect.objectContaining({ name: tagName }))
  const rejected = await callRpc(page, 'app_save_general_task_detail', {
    input_task_id: taskId, input_expected_version: saved.body.version,
    input_idempotency_key: crypto.randomUUID(), input_tag_ids: [crypto.randomUUID()],
    input_payload: { title: `${title} 저장되면 안 됨`, subject: saved.body.subject, due_date: saved.body.due_date,
      timezone: saved.body.timezone, trigger_text: saved.body.trigger_text,
      recurrence_kind: saved.body.recurrence_kind, recurrence_start_on: saved.body.recurrence_start_on, authored_via: 'app' },
  })
  expect(rejected.status).toBeGreaterThanOrEqual(400)
  const unchanged = await callRpc(page, 'app_get_general_task', { input_task_id: taskId })
  expect(unchanged.body).toMatchObject({ title: `${title} 수정`, version: saved.body.version })
})

test('deletes a record without changing its related work', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#tasks')
  const title = `E2E 삭제할 조사 ${Date.now()}`
  const created = await callRpc(page, 'app_create_activity', {
    input_idempotency_key: crypto.randomUUID(),
    input_payload: { title, body: '조사 결과', authored_via: 'app', timezone: 'Asia/Seoul' },
  })
  expect(created.status, JSON.stringify(created.body)).toBe(200)
  await page.reload()
  await page.getByRole('button', { name: title, exact: true }).click()
  const detail = page.getByRole('dialog', { name: '기록 상세' })
  await detail.getByRole('button', { name: '기록 삭제' }).click()
  await expect(detail.getByText('기록을 삭제해도 관련 할 일이나 실제 잔고는 바뀌지 않습니다.')).toBeVisible()
  await detail.getByRole('button', { name: '삭제 확인' }).click()
  await expect(detail).toBeHidden()
  await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0)
  const deleted = await callRpc(page, 'app_get_activity', { input_activity_id: created.body.id, input_owner_user_id: null })
  expect(deleted.status).toBe(200)
  expect(deleted.body).toBeNull()
})

test('links a record to an owned task and instrument', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#tasks')
  const taskTitle = `E2E 연결 할 일 ${Date.now()}`
  await page.getByRole('button', { name: '활동 추가', exact: true }).click()
  let editor = page.getByRole('dialog', { name: '활동 추가' })
  await editor.getByRole('textbox', { name: '할 일 제목' }).fill(taskTitle)
  await editor.getByRole('button', { name: '저장', exact: true }).click()
  const instruments = await callRpc(page, 'app_search_activity_references', { input_kind: 'instrument', input_query: 'E2EAPL', input_offset: 0, input_limit: 20 })
  expect(instruments.status).toBe(200)
  const instrumentId = instruments.body.items[0].id
  const title = `E2E 연결 기록 ${Date.now()}`
  await page.getByRole('button', { name: '활동 추가', exact: true }).click()
  editor = page.getByRole('dialog', { name: '활동 추가' })
  await editor.getByLabel('이미 했음').check()
  await editor.getByRole('textbox', { name: '기록 제목' }).fill(title)
  await editor.getByRole('combobox', { name: '관련 할 일' }).fill(taskTitle)
  await editor.getByRole('option', { name: taskTitle }).click()
  await editor.getByRole('combobox', { name: '관련 종목' }).fill('E2EAPL')
  await editor.getByRole('option', { name: /E2EAPL/ }).click()
  const creationResponse = page.waitForResponse((response) => response.url().includes('/rpc/app_create_activity_with_tags'))
  await editor.getByRole('button', { name: '저장', exact: true }).click()
  const createdRecord = await (await creationResponse).json()
  await page.getByRole('button', { name: title, exact: true }).click()
  const detail = page.getByRole('dialog', { name: '기록 상세' })
  await expect(detail.getByText(taskTitle)).toBeVisible()
  await expect(detail.getByLabel('관련 종목 연결 해제')).toBeVisible()
  const saved = await callRpc(page, 'app_get_activity', { input_activity_id: createdRecord.id, input_owner_user_id: null })
  expect(saved.body.instrument_id).toBe(instrumentId)
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(detail).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await detail.getByLabel('관련 종목 연결 해제').click()
  await detail.getByRole('button', { name: '저장', exact: true }).click()
  await expect(detail.getByLabel('관련 종목 연결 해제')).toHaveCount(0)
})

test('guards activity drafts and detail edits on close, Escape, and browser back', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#tasks')
  await page.getByRole('button', { name: '활동 추가', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '활동 추가' })
  await editor.getByRole('textbox', { name: '할 일 제목' }).fill('버리면 안 되는 초안')
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(editor).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await editor.getByRole('button', { name: '닫기' }).last().click()
  await expect(editor.getByText('저장하지 않은 변경이 있습니다. 변경을 버리고 닫을까요?')).toBeVisible()
  await editor.getByRole('button', { name: '계속 편집' }).click()
  await page.keyboard.press('Escape')
  await expect(editor.getByText('저장하지 않은 변경이 있습니다. 변경을 버리고 닫을까요?')).toBeVisible()
  await editor.getByRole('button', { name: '변경 버리기' }).click()
  await expect(editor).toBeHidden()

  const title = `E2E 미저장 상세 ${Date.now()}`
  const created = await callRpc(page, 'app_create_activity', { input_idempotency_key: crypto.randomUUID(), input_payload: { title, authored_via: 'app' } })
  expect(created.status).toBe(200)
  await page.reload()
  await page.getByRole('button', { name: title, exact: true }).click()
  const detail = page.getByRole('dialog', { name: '기록 상세' })
  await detail.getByRole('textbox', { name: '기록 제목' }).fill(`${title} 수정`)
  await detail.getByRole('button', { name: '닫기' }).last().click()
  await expect(detail.getByText('저장하지 않은 변경이 있습니다. 변경을 버리고 닫을까요?')).toBeVisible()
  await detail.getByRole('button', { name: '계속 편집' }).click()
  await page.goBack()
  await expect(detail.getByText('저장하지 않은 변경이 있습니다. 변경을 버리고 닫을까요?')).toBeVisible()
  await expect(detail).toBeVisible()
  await detail.getByRole('button', { name: '변경 버리기' }).click()
  await expect(detail).toBeHidden()
})

test('keeps the activity editor locked while its save is in flight', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#tasks')
  await page.getByRole('button', { name: '활동 추가', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '활동 추가' })
  await editor.getByRole('textbox', { name: '할 일 제목' }).fill(`E2E 저장 중 ${Date.now()}`)
  let release
  const held = new Promise((resolve) => { release = resolve })
  let requested
  const reached = new Promise((resolve) => { requested = resolve })
  await page.route('**/rest/v1/rpc/app_create_general_task_with_tags', async (route) => {
    requested()
    await held
    await route.continue()
  })
  await editor.getByRole('button', { name: '저장', exact: true }).click()
  await reached
  await expect(editor.getByRole('button', { name: '닫기' }).last()).toBeDisabled()
  await expect(editor.getByRole('textbox', { name: '할 일 제목' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(editor).toBeVisible()
  release()
  await expect(editor).toBeHidden()
})

test('shares newly created and renamed activity tags with search filters immediately', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#tasks')
  const title = `E2E 태그 상태 ${Date.now()}`
  const tagName = `공유태그${Date.now()}`
  const renamed = `${tagName}수정`
  const created = await callRpc(page, 'app_create_activity', { input_idempotency_key: crypto.randomUUID(), input_payload: { title, authored_via: 'app' } })
  expect(created.status).toBe(200)
  await page.reload()
  await page.getByRole('button', { name: title, exact: true }).click()
  const detail = page.getByRole('dialog', { name: '기록 상세' })
  await detail.getByPlaceholder('새 태그').fill(tagName)
  await detail.getByPlaceholder('새 태그').locator('..').getByRole('button', { name: '추가', exact: true }).click()
  await expect(detail.getByRole('button', { name: `${tagName} 태그 해제` })).toBeVisible()
  await detail.getByRole('textbox', { name: '기록 제목' }).fill(`${title} 초안`)
  const saveResponse = page.waitForResponse((response) => response.url().includes('/rpc/app_save_activity_detail'))
  await detail.getByRole('button', { name: '저장', exact: true }).click()
  expect((await saveResponse).status()).toBe(200)
  await expect(detail.getByRole('textbox', { name: '기록 제목' })).toHaveValue(`${title} 초안`)
  await expect(detail.getByRole('button', { name: '저장', exact: true })).toBeDisabled()
  const saved = await callRpc(page, 'app_get_activity', { input_activity_id: created.body.id, input_owner_user_id: null })
  expect(saved.status).toBe(200)
  expect(saved.body.tags).toContainEqual(expect.objectContaining({ name: tagName }))
  const rejected = await callRpc(page, 'app_save_activity_detail', {
    input_activity_id: created.body.id, input_expected_version: saved.body.version,
    input_idempotency_key: crypto.randomUUID(), input_patch: { title: `${title} 롤백` },
    input_tag_ids: [crypto.randomUUID()], input_authored_via: 'app',
  })
  expect(rejected.status).toBeGreaterThanOrEqual(400)
  const unchanged = await callRpc(page, 'app_get_activity', { input_activity_id: created.body.id, input_owner_user_id: null })
  expect(unchanged.body).toMatchObject({ title: `${title} 초안`, version: saved.body.version })
  await detail.getByText('태그 이름·삭제 관리').click()
  const tagRow = detail.getByRole('textbox', { name: `${tagName} 이름 변경` }).locator('..')
  await tagRow.getByRole('textbox').fill(renamed)
  await tagRow.getByRole('button', { name: '변경' }).click()
  await expect(detail.getByRole('button', { name: `${renamed} 태그 해제` })).toBeVisible()
  await detail.getByRole('button', { name: '닫기' }).first().click()
  const filters = page.locator('details').filter({ hasText: '상세 필터' })
  await filters.locator('summary').click()
  await expect(filters.getByRole('button', { name: renamed, exact: true })).toBeVisible()
  await expect(filters.getByRole('button', { name: tagName, exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: `${title} 초안`, exact: true }).click()
  await detail.getByRole('button', { name: /태그/ }).click()
  await detail.getByText('태그 이름·삭제 관리').click()
  await detail.getByRole('textbox', { name: `${renamed} 이름 변경` }).locator('..').getByRole('button', { name: '삭제' }).click()
  await expect(detail.getByLabel(renamed, { exact: true })).toHaveCount(0)
  await detail.getByRole('button', { name: '닫기' }).first().click()
  await expect(filters.getByRole('button', { name: renamed, exact: true })).toHaveCount(0)
})

test('distinguishes a failed activity-tag read from an empty list and retries it', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  let calls = 0
  let failReads = true
  await page.route('**/rest/v1/rpc/app_list_activity_tags', async (route) => {
    calls += 1
    if (failReads) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'tag read failed' }) })
    else await route.continue()
  })
  await page.goto('/#tasks')
  await expect(page.getByRole('alert').filter({ hasText: '태그 목록을 불러오지 못했습니다.' })).toBeVisible()
  failReads = false
  await page.getByRole('alert').getByRole('button', { name: '다시 시도' }).click()
  await expect(page.getByRole('alert').filter({ hasText: '태그 목록을 불러오지 못했습니다.' })).toHaveCount(0)
  expect(calls).toBeGreaterThanOrEqual(2)
})

test('does not reopen a closed activity when its detail response arrives late', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#tasks')
  const title = `E2E 늦은 상세 ${Date.now()}`
  const created = await callRpc(page, 'app_create_activity', {
    input_idempotency_key: crypto.randomUUID(),
    input_payload: { title, authored_via: 'app', timezone: 'Asia/Seoul' },
  })
  expect(created.status).toBe(200)
  await page.reload()

  let release
  const held = new Promise((resolve) => { release = resolve })
  let requested
  const reached = new Promise((resolve) => { requested = resolve })
  await page.route('**/rest/v1/rpc/app_get_activity', async (route) => {
    requested()
    await held
    await route.continue()
  })
  await page.getByRole('button', { name: title, exact: true }).click()
  await reached
  const detail = page.getByRole('dialog', { name: '기록 상세' })
  await expect(detail).toBeVisible()
  await detail.getByRole('button', { name: '닫기' }).click()
  await expect(detail).toBeHidden()
  const response = page.waitForResponse((item) => item.url().includes('/rest/v1/rpc/app_get_activity'))
  release()
  await response
  await expect(detail).toBeHidden()
})

test('keeps the newest search when an older search responds later', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#tasks')
  let releaseOlder
  const olderHeld = new Promise((resolve) => { releaseOlder = resolve })
  let olderRequested
  const olderReached = new Promise((resolve) => { olderRequested = resolve })
  await page.route('**/functions/v1/activity-search', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const query = route.request().postDataJSON()?.query
    if (query === '오래된 검색') {
      olderRequested()
      await olderHeld
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: [{ record_type: 'activity', record_id: query === '오래된 검색' ? 9201 : 9202,
        activity_id: query === '오래된 검색' ? 9201 : 9202, record_state: 'done', title: query }],
      next_cursor: null, semantic_status: 'unavailable',
    }) })
  })
  const search = page.getByRole('textbox', { name: '활동 검색' })
  await search.fill('오래된 검색')
  await page.getByRole('button', { name: '검색', exact: true }).click()
  await olderReached
  await search.fill('최신 검색')
  await page.getByRole('button', { name: '검색', exact: true }).click()
  await expect(page.getByRole('button', { name: /최신 검색/ })).toBeVisible()
  releaseOlder()
  await expect(page.getByRole('button', { name: /오래된 검색/ })).toHaveCount(0)
})

test('shows pending and completed work together without a state filter', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#tasks')
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('heading', { name: '할 일' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '기록' })).toBeVisible()
    await expect(page.getByRole('button', { name: '활동 추가' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: '활동 검색' })).toBeVisible()
    await expect(page.getByRole('group', { name: '활동 목록 필터' })).toHaveCount(0)
    await expect(page.getByText('활동 목록을 불러오는 중입니다.')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})

test('clears a pending search without accepting its late result', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#tasks')
  let release
  const held = new Promise((resolve) => { release = resolve })
  let requested
  const reached = new Promise((resolve) => { requested = resolve })
  await page.route('**/functions/v1/activity-search', async (route) => {
    if (route.request().postDataJSON()?.query !== '해제할 검색') return route.continue()
    requested()
    await held
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: [{ record_type: 'activity', record_id: 9901, activity_id: 9901, record_state: 'done', title: '늦은 결과' }],
      next_cursor: null, semantic_status: 'unavailable',
    }) })
  })
  await page.getByRole('textbox', { name: '활동 검색' }).fill('해제할 검색')
  await page.getByRole('button', { name: '검색', exact: true }).click()
  await reached
  await page.getByRole('button', { name: '해제' }).click()
  await expect(page.getByRole('heading', { name: '할 일' })).toBeVisible()
  release()
  await expect(page.getByText('늦은 결과')).toHaveCount(0)
})

test('discards an older search page after the search is cleared', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#tasks')
  let releasePage
  const heldPage = new Promise((resolve) => { releasePage = resolve })
  let pageRequested
  const pageReached = new Promise((resolve) => { pageRequested = resolve })
  await page.route('**/functions/v1/activity-search', async (route) => {
    const cursor = route.request().postDataJSON()?.cursor
    if (cursor) { pageRequested(); await heldPage }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: [{ record_type: 'activity', record_id: cursor ? 9912 : 9911, activity_id: cursor ? 9912 : 9911,
        record_state: 'done', title: cursor ? '버린 이전 페이지' : '첫 페이지' }],
      next_cursor: cursor ? null : 'next-page', semantic_status: 'unavailable',
    }) })
  })
  await page.getByRole('textbox', { name: '활동 검색' }).fill('페이지 검색')
  await page.getByRole('button', { name: '검색', exact: true }).click()
  await expect(page.getByRole('button', { name: /첫 페이지/ })).toBeVisible()
  await page.getByRole('button', { name: '더 보기', exact: true }).click()
  await pageReached
  await page.getByRole('button', { name: '해제' }).click()
  releasePage()
  await expect(page.getByRole('heading', { name: '할 일' })).toBeVisible()
  await expect(page.getByText('버린 이전 페이지')).toHaveCount(0)
})

test('filters activity tags with OR/AND and keeps responsive record detail', async ({ page }, testInfo) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#tasks')
  const prefix = `E2E 태그 묶음 ${Date.now()}`
  const firstTag = await callRpc(page, 'app_save_activity_tag', { input_tag_id: null, input_expected_version: null, input_idempotency_key: crypto.randomUUID(), input_name: `${prefix} 조사` })
  const secondTag = await callRpc(page, 'app_save_activity_tag', { input_tag_id: null, input_expected_version: null, input_idempotency_key: crypto.randomUUID(), input_name: `${prefix} 점검` })
  expect(firstTag.status).toBe(200)
  expect(secondTag.status).toBe(200)
  for (const [label, tagIds] of [['조사', [firstTag.body.id]], ['점검', [secondTag.body.id]], ['둘 다', [firstTag.body.id, secondTag.body.id]], ['무태그', []]]) {
    const created = await callRpc(page, 'app_create_activity_with_tags', {
      input_idempotency_key: crypto.randomUUID(), input_tag_ids: tagIds,
      input_payload: { title: `${prefix} ${label}`, authored_via: 'app' },
    })
    expect(created.status).toBe(200)
  }
  await page.reload()
  await expect(page.getByRole('button', { name: `${prefix} 둘 다`, exact: true })).toBeVisible()
  await page.getByText('상세 필터', { exact: true }).click()
  const filters = page.locator('details').filter({ hasText: '상세 필터' })
  await filters.getByRole('button', { name: `${prefix} 조사`, exact: true }).click()
  await filters.getByRole('button', { name: `${prefix} 점검`, exact: true }).click()
  await expect(filters.getByRole('button', { name: `${prefix} 조사`, exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(filters.getByRole('button', { name: `${prefix} 점검`, exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '검색', exact: true }).click()
  await expect(page.getByRole('heading', { name: `${prefix} 조사`, exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: `${prefix} 점검`, exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: `${prefix} 둘 다`, exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: `${prefix} 무태그`, exact: true })).toHaveCount(0)
  await page.getByLabel('선택한 태그 모두 포함').check()
  await page.getByRole('button', { name: '검색', exact: true }).click()
  await expect(page.getByRole('heading', { name: `${prefix} 조사`, exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: `${prefix} 점검`, exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: `${prefix} 둘 다`, exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('tag-filters.png') })
  await page.getByRole('heading', { name: `${prefix} 둘 다`, exact: true }).click()
  const detail = page.getByRole('dialog', { name: '기록 상세' })
  await detail.getByRole('textbox', { name: '기록 제목', exact: true }).fill(`${prefix} 초안`)
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const bounds = await detail.boundingBox()
    expect(bounds.width).toBeLessThanOrEqual(width)
    if (width >= 640) {
      expect(bounds.width).toBeLessThan(width)
      expect(bounds.x).toBeGreaterThan(0)
    } else {
      expect(bounds.width).toBe(width)
    }
    await expect(detail.getByRole('textbox', { name: '기록 제목', exact: true })).toHaveValue(`${prefix} 초안`)
    await expect(detail.getByRole('button', { name: '저장', exact: true })).toBeInViewport()
    expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`activity-editor-${width}.png`) })
  }
  await detail.getByRole('button', { name: '닫기', exact: true }).first().click()
  await detail.getByRole('button', { name: '변경 버리기', exact: true }).click()
  await filters.getByRole('button', { name: `${prefix} 점검`, exact: true }).click()
  await expect(filters.getByRole('button', { name: `${prefix} 점검`, exact: true })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: '검색', exact: true }).click()
  await expect(page.getByRole('heading', { name: `${prefix} 점검`, exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '해제', exact: true }).click()
  await expect(page.getByRole('heading', { name: '할 일' })).toBeVisible()
})
