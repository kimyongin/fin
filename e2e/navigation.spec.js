import { expect, test } from '@playwright/test'
import { callRpc, clickPageAction, openMenuTab, openPageActionMenu, signInAs } from './helpers'

test('navigates the authenticated browser through strategy, activity, and settings pages', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: '자산' })).toBeVisible()

  async function openTab(label, title) {
    await openMenuTab(page, label)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  }

  await openTab('원칙', '원칙')
  await openTab('활동', '활동')
  await openTab('설정', '설정')
  await expect(page.getByRole('button', { name: '에이전트 연결하기' })).toHaveCount(0)
  await expect(page.getByText('연결 토큰', { exact: true })).toHaveCount(0)
  const masterSharing = page.getByRole('switch', { name: '공유' })
  await expect(masterSharing).toBeEnabled()
  const originallyEnabled = await masterSharing.getAttribute('aria-checked') === 'true'
  const saveSharing = page.getByRole('button', { name: '저장하기', exact: true })
  let sharingWrites = 0
  page.on('request', (request) => { if (request.url().includes('/rpc/set_viewer_profile')) sharingWrites += 1 })
  await expect(saveSharing).toBeDisabled()
  await masterSharing.click()
  await expect(saveSharing).toBeEnabled()
  expect(sharingWrites).toBe(0)
  await openTab('가이드', '가이드')
  await openTab('설정', '설정')
  await expect(masterSharing).toHaveAttribute('aria-checked', originallyEnabled ? 'false' : 'true')
  await expect(saveSharing).toBeEnabled()
  await expect(page.getByRole('switch')).toHaveCount(1)
  await saveSharing.click()
  await expect(saveSharing).toBeDisabled()
  expect(sharingWrites).toBe(1)
  await page.reload()
  await expect(masterSharing).toHaveAttribute('aria-checked', originallyEnabled ? 'false' : 'true')
  await masterSharing.click()
  await saveSharing.click()
  await expect(saveSharing).toBeDisabled()
  await expect(page.getByText(/^버전 \d{8}T\d{6}Z$/)).toBeVisible()
  await openTab('가이드', '가이드')
  await expect(page.getByText('현재 자산을 입력하고, ChatGPT에서 첫 점검을 저장하세요')).toBeVisible()
})

test('routes old news links to the research activity flow', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#news')
  await expect(page.getByRole('heading', { level: 1, name: '활동' })).toBeVisible()
  await expect(page).toHaveURL(/#tasks$/)
  const title = `E2E 조사 활동 ${Date.now()}`
  const created = await callRpc(page, 'app_create_activity', {
    input_idempotency_key: crypto.randomUUID(),
    input_payload: { title, body: '공식 자료 확인', authored_via: 'app', timezone: 'Asia/Seoul' },
  })
  expect(created.status, JSON.stringify(created.body)).toBe(200)
  await page.reload()
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
  const detail = await callRpc(page, 'app_get_activity', { input_activity_id: created.body.id, input_owner_user_id: null })
  expect(detail.body.body).toBe('공식 자료 확인')
})

test('saves an icon on selection and restores it after a failed save', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#settings')
  const publicName = page.getByRole('textbox', { name: '공개 이름' }).first()
  await expect(publicName).toHaveValue('e2e-owner')
  const before = await publicName.inputValue()
  const picker = page.getByRole('group', { name: '프로필 아이콘 선택' })
  await expect(picker.locator('[aria-pressed]')).toHaveCount(20)
  const pickerIconSize = await picker.getByRole('button', { name: '키위' }).locator('span').evaluate((element) => getComputedStyle(element).fontSize)
  const footerIconSize = await page.getByRole('button', { name: '내 프로필' }).locator('span[style*="font-size"]').evaluate((element) => getComputedStyle(element).fontSize)
  expect(pickerIconSize).toBe(footerIconSize)
  const target = await picker.getByRole('button', { name: '키위' }).getAttribute('aria-pressed') === 'true'
    ? { name: '사과', symbol: '🍎' }
    : { name: '키위', symbol: '🥝' }
  await picker.getByRole('button', { name: target.name }).click()
  await expect(picker).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('button', { name: '내 프로필' })).toContainText(target.symbol)
  await page.reload()
  await expect(page.getByRole('button', { name: '내 프로필' })).toContainText(target.symbol)
  await expect(page.getByRole('textbox', { name: '공개 이름' }).first()).toHaveValue(before)
  await expect(picker.getByRole('button', { name: target.name })).toHaveAttribute('aria-pressed', 'true')
  const failedTarget = target.name === '키위' ? '사과' : '키위'
  await page.route('**/rest/v1/rpc/app_set_profile_avatar', (route) => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ message: '저장 실패' }),
  }))
  await picker.getByRole('button', { name: failedTarget }).click()
  await expect(picker).toHaveAttribute('aria-busy', 'false')
  await expect(picker.getByRole('button', { name: target.name })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '내 프로필' })).toContainText(target.symbol)
  await expect(page.getByRole('alert')).toContainText('저장 실패')
  await page.unroute('**/rest/v1/rpc/app_set_profile_avatar')
})

test('keeps whole-sharing cards usable across screen widths', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#settings')
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const profileButton = page.getByRole('button', { name: '내 프로필' })
    const badge = profileButton.getByTestId('self-profile-badge')
    await expect(badge).toHaveText('나')
    const profileBox = await profileButton.boundingBox()
    const badgeBox = await badge.boundingBox()
    expect(badgeBox.x).toBeGreaterThanOrEqual(profileBox.x)
    expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(profileBox.x + profileBox.width)
    expect(badgeBox.y + badgeBox.height).toBeLessThanOrEqual(profileBox.y + profileBox.height)
    const avatarGroup = page.getByRole('group', { name: '프로필 아이콘 선택' })
    await expect(page.getByRole('button', { name: '아이콘 저장' })).toHaveCount(0)
    const avatarLastBox = await avatarGroup.locator('[aria-pressed]').last().boundingBox()
    expect(avatarLastBox.height).toBeGreaterThanOrEqual(44)
    expect(avatarLastBox.x + avatarLastBox.width).toBeLessThanOrEqual(width)
    const giving = page.locator('article').filter({ has: page.getByRole('heading', { name: '공유 하기' }) })
    const receiving = page.locator('article').filter({ has: page.getByRole('heading', { name: '공유 받기' }) })
    await expect(giving).toBeVisible()
    await expect(receiving).toBeVisible()
    await expect(page.getByRole('switch', { name: '공유' })).toBeVisible()
    await expect(page.getByRole('switch')).toHaveCount(1)
    const save = giving.getByRole('button', { name: '저장하기' })
    const connect = receiving.getByRole('button', { name: '연결하기' })
    await expect(save).toBeVisible()
    await expect(connect).toBeVisible()
    const saveBox = await save.boundingBox()
    const connectBox = await connect.boundingBox()
    const givingFields = await giving.locator('input').all()
    const receivingFields = await receiving.locator('input').all()
    const givingPasswordBox = await givingFields[1].boundingBox()
    const receivingPasswordBox = await receivingFields[1].boundingBox()
    expect(saveBox.height).toBeGreaterThanOrEqual(44)
    expect(connectBox.height).toBeGreaterThanOrEqual(44)
    if (width >= 768) {
      expect(saveBox.x).toBeGreaterThan(givingPasswordBox.x + givingPasswordBox.width)
      expect(connectBox.x).toBeGreaterThan(receivingPasswordBox.x + receivingPasswordBox.width)
      expect(Math.abs(saveBox.y - givingPasswordBox.y)).toBeLessThanOrEqual(4)
      expect(Math.abs(connectBox.y - receivingPasswordBox.y)).toBeLessThanOrEqual(4)
    } else {
      expect(saveBox.y).toBeGreaterThan(givingPasswordBox.y + givingPasswordBox.height)
      expect(connectBox.y).toBeGreaterThan(receivingPasswordBox.y + receivingPasswordBox.height)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 390, height: 900 })
  await page.evaluate(() => { document.documentElement.style.fontSize = '32px' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('connects and removes a shared portfolio from the receiving card', async ({ browser }) => {
  const owner = await browser.newPage()
  await signInAs(owner, 'e2e-owner@example.com')
  await owner.goto('/#settings')
  expect((await callRpc(owner, 'set_viewer_profile', {
    input_public_name: 'e2e-owner', input_viewer_password: 'e2e-password',
    input_sharing_enabled: true, input_share_scope: 'portfolio_all',
  })).status).toBe(200)

  const viewer = await browser.newPage()
  await signInAs(viewer, 'e2e-friend@example.com')
  await viewer.goto('/#settings')
  expect((await callRpc(viewer, 'set_viewer_profile', {
    input_public_name: 'e2e-friend', input_viewer_password: '',
    input_sharing_enabled: false, input_share_scope: 'portfolio_all',
  })).status).toBe(200)
  await viewer.getByRole('textbox', { name: '공개 이름' }).last().fill('e2e-owner')
  await viewer.getByRole('textbox', { name: '보기 비밀번호' }).last().fill('e2e-password')
  await viewer.getByRole('button', { name: '연결하기', exact: true }).click()
  await expect(viewer).toHaveURL(/#overview$/)
  await expect.poll(async () => (await callRpc(owner, 'app_list_portfolio_viewers', { input_limit: 50, input_offset: 0 })).body.items?.[0]?.last_viewed_at).toBeTruthy()
  await owner.reload()
  await expect(owner.getByText('e2e-friend', { exact: true })).toBeVisible()
  await expect(owner.getByText('아직 열람 없음')).toHaveCount(0)
  await viewer.getByRole('button', { name: /포트폴리오, 전환하기/ }).click()
  await viewer.getByRole('group', { name: '포트폴리오 선택' }).getByRole('button', { name: '나' }).click()
  await openMenuTab(viewer, '설정')
  await expect(viewer.getByText('e2e-owner', { exact: true })).toBeVisible()
  await viewer.getByRole('button', { name: 'e2e-owner 해제' }).click()
  await expect(viewer.getByText('e2e-owner', { exact: true })).toHaveCount(0)
  await owner.reload()
  await expect(owner.getByText('e2e-friend', { exact: true })).toHaveCount(0)
  await owner.close()
  await viewer.close()
})

test('guides a new user from empty assets through OAuth setup and first review', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-outsider@example.com')
  await page.goto('/#today')

  await expect(page).toHaveURL(/#tasks$/)
  await page.getByRole('textbox', { name: '활동 검색' }).fill('존재하지 않는 점검')
  await expect(page.getByText(/조건에 맞는 활동( 기록)?이 없습니다\./)).toBeVisible()
  await openMenuTab(page, '가이드')
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

test('keeps the four primary page controls readable across viewport widths', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const [hash, title] of [
      ['overview', '자산'],
      ['allocation', '배분'],
      ['tasks', '활동'],
      ['strategy', '원칙'],
    ]) {
      await page.goto(`/#${hash}`)
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
      if (hash === 'overview') await expect(page.getByRole('region', { name: '자산 종목' })).toBeVisible()
      if (hash === 'allocation') await expect(page.getByRole('heading', { name: '태그별 배분' })).toBeVisible()
      if (hash === 'tasks') {
        await expect(page.getByRole('textbox', { name: '활동 검색' })).toBeVisible()
        await expect(page.getByRole('heading', { name: '할 일', exact: true })).toBeVisible()
        await expect(page.getByRole('heading', { name: '기록', exact: true })).toBeVisible()
      }
      if (hash === 'strategy') await expect(page.getByRole('heading', { name: '변경 이력' })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
  }
})
test('keeps tag allocation visible and editable in the bottom allocation tab', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  const portfolio = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  const before = await callRpc(page, 'app_get_strategy_state', { input_owner_user_id: null })
  const tag = portfolio.body.tags[0]
  await callRpc(page, 'app_save_allocation_targets', {
    input_targets: [{ tag_id: tag.id, target_percentage: 100 }],
    input_expected_targets: before.body.targets.map(({ tag_id, target_percentage }) => ({ tag_id, target_percentage })),
  })
  await openMenuTab(page, '원칙')
  await expect(page.getByRole('heading', { name: '변경 이력' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: `${tag.name} 목표 비중` })).toHaveCount(0)
  await expect(page.getByText('비중 계산을 잠시 멈췄습니다.')).toHaveCount(0)
  await openMenuTab(page, '배분')
  await expect(page.getByRole('textbox', { name: `${tag.name} 목표 비중` })).toHaveValue('100')
  await expect(page.locator('nav[aria-label="주요 메뉴"]').getByRole('button', { name: '배분', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: '자산으로 돌아가기' })).toHaveCount(0)
  await expect(page.getByText('목표 합계 100.00% / 100%')).toBeVisible()
  await expect(page).toHaveURL(/#allocation$/)
  await expect(page.getByRole('button', { name: '모드 변경' })).toHaveCount(0)
  await openMenuTab(page, '자산')
  await expect(page).toHaveURL(/#overview$/)
  await expect(page.getByRole('button', { name: '전체 배분 보기' })).toHaveCount(0)
})

test('manages instrument tags from the asset toolbar', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#overview')
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('button', { name: '자산 작업 메뉴' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await openMenuTab(page, '배분')
  const portfolio = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  const existingTag = portfolio.body.tags[0]
  await page.getByRole('textbox', { name: `${existingTag.name} 목표 비중` }).fill('99')
  await clickPageAction(page, '태그별 배분', '태그 관리')
  const manager = page.getByRole('dialog', { name: '자산 태그 관리' })
  await expect(manager).toBeVisible()
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(manager.getByRole('textbox', { name: '태그명' })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  const tagName = `E2E 종목 태그 ${Date.now()}`
  await manager.getByRole('button', { name: /새 태그/ }).click()
  await manager.getByRole('textbox', { name: '태그명' }).fill(tagName)
  await manager.getByRole('button', { name: '추가' }).click()
  await expect(manager).toBeVisible()
  await expect(manager.getByRole('button', { name: new RegExp(tagName) })).toBeVisible()
  await manager.getByRole('textbox', { name: '태그명' }).fill(`${tagName} 초안`)
  await manager.getByRole('button', { name: /새 태그/ }).click()
  const discard = page.getByRole('dialog', { name: '변경 버리기' })
  await discard.getByRole('button', { name: '계속 편집' }).click()
  await expect(manager.getByRole('textbox', { name: '태그명' })).toHaveValue(`${tagName} 초안`)
  await manager.getByRole('button', { name: /새 태그/ }).click()
  await discard.getByRole('button', { name: '변경 버리기' }).click()
  await expect(manager.getByRole('textbox', { name: '태그명' })).toHaveValue('')
  await manager.getByRole('button', { name: new RegExp(tagName) }).click()
  await manager.getByRole('button', { name: '태그 삭제' }).click()
  await page.getByRole('dialog', { name: '태그 삭제' }).getByRole('button', { name: '계속 편집' }).click()
  await expect(manager.getByRole('button', { name: new RegExp(tagName) })).toBeVisible()
  await manager.getByRole('button', { name: '닫기' }).first().click()
  await expect(page.getByRole('textbox', { name: `${existingTag.name} 목표 비중` })).toHaveValue('99')
  await expect(page.getByRole('textbox', { name: `${tagName} 목표 비중` })).toHaveValue('0')
  await clickPageAction(page, '태그별 배분', '태그 관리')
  await manager.getByRole('button', { name: new RegExp(tagName) }).click()
  const renamed = `${tagName} 수정`
  await manager.getByRole('textbox', { name: '태그명' }).fill(renamed)
  await manager.getByRole('button', { name: '저장' }).click()
  await manager.getByRole('button', { name: '닫기' }).first().click()
  await expect(page.getByRole('textbox', { name: `${renamed} 목표 비중` })).toHaveValue('0')
  await clickPageAction(page, '태그별 배분', '태그 관리')
  await manager.getByRole('button', { name: new RegExp(renamed) }).click()
  await manager.getByRole('button', { name: '태그 삭제' }).click()
  await page.getByRole('dialog', { name: '태그 삭제' }).getByRole('button', { name: '태그 삭제' }).click()
  await expect(manager.getByRole('button', { name: new RegExp(renamed) })).toHaveCount(0)
  await manager.getByRole('button', { name: '닫기' }).first().click()
  await expect(page.getByRole('textbox', { name: `${renamed} 목표 비중` })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: `${existingTag.name} 목표 비중` })).toHaveValue('99')
})

test('rejects deleting an allocated tag and does not overwrite a concurrent target change', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#allocation')
  const portfolio = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  const tag = portfolio.body.tags[0]
  const before = await callRpc(page, 'app_get_strategy_state', { input_owner_user_id: null })
  expect((await callRpc(page, 'app_save_allocation_targets', {
    input_targets: [{ tag_id: tag.id, target_percentage: 100 }],
    input_expected_targets: before.body.targets.map(({ tag_id, target_percentage }) => ({ tag_id, target_percentage })),
  })).status).toBe(200)
  const extra = await callRpc(page, 'app_save_tag', {
    input_name: `동시수정 보조 ${Date.now()}`, input_request: null, input_sort_order: 99,
    input_source: 'user', input_tag_id: null,
  })
  expect(extra.status).toBe(200)
  const extraTagId = extra.body[0].tag_id
  await page.reload()
  const targetInput = page.getByRole('textbox', { name: `${tag.name} 목표 비중` })
  await expect(targetInput).toHaveValue('100')
  await clickPageAction(page, '태그별 배분', '태그 관리')
  const manager = page.getByRole('dialog', { name: '자산 태그 관리' })
  await manager.getByRole('button', { name: new RegExp(tag.name) }).click()
  await manager.getByRole('button', { name: '태그 삭제' }).click()
  await page.getByRole('dialog', { name: '태그 삭제' }).getByRole('button', { name: '태그 삭제' }).click()
  await expect(page.getByRole('dialog', { name: '태그 삭제' }).getByRole('alert')).toBeVisible()
  await expect(manager.getByRole('button', { name: new RegExp(tag.name) })).toBeVisible()
  await page.getByRole('dialog', { name: '태그 삭제' }).getByRole('button', { name: '계속 편집' }).click()
  await manager.getByRole('button', { name: '닫기' }).first().click()

  // The second write represents another session changing the server while this page stays open.
  const current = await callRpc(page, 'app_get_strategy_state', { input_owner_user_id: null })
  expect((await callRpc(page, 'app_save_allocation_targets', {
    input_targets: [{ tag_id: tag.id, target_percentage: 99 }, { tag_id: extraTagId, target_percentage: 1 }],
    input_expected_targets: current.body.targets.map(({ tag_id, target_percentage }) => ({ tag_id, target_percentage })),
  })).status).toBe(200)
  await clickPageAction(page, '태그별 배분', '태그 관리')
  await manager.getByRole('button', { name: new RegExp(tag.name) }).click()
  await manager.getByRole('textbox', { name: '태그명' }).fill(`${tag.name} 새 이름`)
  await manager.getByRole('button', { name: '저장' }).click()
  await manager.getByRole('button', { name: '닫기' }).first().click()
  const renamedTarget = page.getByRole('textbox', { name: `${tag.name} 새 이름 목표 비중` })
  await expect(renamedTarget).toHaveValue('99')
  await expect(page.getByRole('button', { name: '저장', exact: true })).toHaveCount(0)

  await renamedTarget.fill('98')
  const latest = await callRpc(page, 'app_get_strategy_state', { input_owner_user_id: null })
  expect((await callRpc(page, 'app_save_allocation_targets', {
    input_targets: [{ tag_id: tag.id, target_percentage: 98.5 }, { tag_id: extraTagId, target_percentage: 1.5 }],
    input_expected_targets: latest.body.targets.map(({ tag_id, target_percentage }) => ({ tag_id, target_percentage })),
  })).status).toBe(200)
  await clickPageAction(page, '태그별 배분', '태그 관리')
  await manager.getByRole('button', { name: new RegExp(`${tag.name} 새 이름`) }).click()
  await manager.getByRole('textbox', { name: '태그명' }).fill(`${tag.name} 최종 이름`)
  await manager.getByRole('button', { name: '저장' }).click()
  await manager.getByRole('button', { name: '닫기' }).first().click()
  const finalTarget = page.getByRole('textbox', { name: `${tag.name} 최종 이름 목표 비중` })
  await expect(finalTarget).toHaveValue('98')
  await expect(page.getByText('목표 비중이 다른 곳에서 바뀌었습니다.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '최신 목표 불러오기' }).click()
  await expect(finalTarget).toHaveValue('98.5')
})

test('keeps an asset-tag draft after a failed write and retries without duplicate rows', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#allocation')
  await clickPageAction(page, '태그별 배분', '태그 관리')
  const manager = page.getByRole('dialog', { name: '자산 태그 관리' })
  const name = `자산 재시도 ${Date.now()}`
  let writeCalls = 0
  await page.route('**/rest/v1/rpc/app_save_tag', async (route) => {
    writeCalls += 1
    if (writeCalls === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary asset write failure' }) })
    else await route.continue()
  })
  await manager.getByRole('button', { name: /새 태그/ }).click()
  await manager.getByRole('textbox', { name: '태그명' }).fill(name)
  await manager.getByRole('button', { name: '추가' }).click()
  await expect(manager.getByRole('alert').filter({ hasText: 'temporary asset write failure' })).toBeVisible()
  await expect(manager.getByRole('textbox', { name: '태그명' })).toHaveValue(name)
  await manager.getByRole('button', { name: '추가' }).click()
  await expect(manager.getByRole('button', { name: new RegExp(name) })).toBeVisible()
  expect(writeCalls).toBe(2)
  const portfolio = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(portfolio.body.tags.filter((tag) => tag.name === name)).toHaveLength(1)
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
    input_quantity: 1, input_request: null, input_source: 'user',
    input_ticker: missingTicker,
  })).status).toBe(200)
  const beforeTargets = await callRpc(page, 'app_get_strategy_state', { input_owner_user_id: null })
  expect((await callRpc(page, 'app_save_allocation_targets', {
    input_targets: [{ tag_id: initialState.body.tags[0].id, target_percentage: 100 }],
    input_expected_targets: beforeTargets.body.targets.map(({ tag_id, target_percentage }) => ({ tag_id, target_percentage })),
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

  await openMenuTab(page, '배분')
  await expect(page.getByText('시세 또는 환율이 빠져 현재 비중과 차이를 정확히 계산할 수 없습니다.')).toBeVisible()
  await expect(page.getByRole('heading', { name: '이번 달 적립금 배분' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '리밸런싱 제안' })).toHaveCount(0)
})

test('keeps four primary destinations usable without horizontal overflow', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const primary = page.locator('nav[aria-label="주요 메뉴"]:visible')
    await expect(primary.getByRole('button')).toHaveCount(6)
    await expect(primary.getByRole('button', { name: '자산', exact: true })).toBeVisible()
    await expect(primary.getByRole('button', { name: '배분', exact: true })).toBeVisible()
    await expect(primary.getByRole('button', { name: '활동', exact: true })).toBeVisible()
    await expect(primary.getByRole('button', { name: '원칙', exact: true })).toBeVisible()
    const profile = primary.getByRole('button', { name: /포트폴리오, 전환하기/ })
    await expect.poll(() => profile.evaluate((button) => ({
      fontSize: getComputedStyle(button.firstElementChild.firstElementChild).fontSize,
      circular: parseFloat(getComputedStyle(button.firstElementChild).borderTopLeftRadius) >= 16,
      borderWidth: getComputedStyle(button.firstElementChild).borderTopWidth,
      borderSofterThanMenu: getComputedStyle(button.firstElementChild).borderTopColor !== getComputedStyle(button.parentElement.lastElementChild).color,
      circleSize: Math.round(button.firstElementChild.getBoundingClientRect().width),
      height: Math.round(button.getBoundingClientRect().height),
      width: Math.round(button.getBoundingClientRect().width),
    }))).toEqual({ fontSize: '20px', circular: true, borderWidth: '1px', borderSofterThanMenu: true, circleSize: 32, height: 44, width: 44 })
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
  await page.getByRole('button', { name: '메뉴 열기' }).click()
  const secondary = page.getByRole('group', { name: '보조 메뉴' })
  for (const label of ['피드백', '설정', '가이드']) await expect(secondary.getByRole('button', { name: label, exact: true })).toBeVisible()
  await expect(secondary.getByRole('button', { name: '자료', exact: true })).toHaveCount(0)
  await expect(secondary.getByRole('button', { name: '활동 내역', exact: true })).toHaveCount(0)
})

test('keeps shared page controls and editing surfaces consistent', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#overview')

  await clickPageAction(page, '자산', '표 편집')
  await expect(page).toHaveURL(/#overview$/)
  const spreadsheet = page.getByRole('dialog', { name: '표 편집' })
  await expect(spreadsheet).toBeVisible()
  await expect(page.getByRole('region', { name: '자산 종목' })).toBeVisible()
  await expect(page.getByRole('button', { name: '전체 화면으로 표 편집' })).toHaveCount(0)
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(spreadsheet).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  const accountName = spreadsheet.getByLabel('계좌명').first()
  const initialAccountName = await accountName.inputValue()
  await accountName.fill(`${initialAccountName} 임시`)
  await spreadsheet.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '변경 버리기' }).getByText('저장하지 않은 변경이 있습니다.')).toBeVisible()
  await page.getByRole('dialog', { name: '변경 버리기' }).getByRole('button', { name: '계속 편집' }).click()
  await expect(accountName).toHaveValue(`${initialAccountName} 임시`)
  await spreadsheet.getByRole('button', { name: '닫기', exact: true }).click()
  await page.getByRole('dialog', { name: '변경 버리기' }).getByRole('button', { name: '변경 버리기' }).click()
  await expect(spreadsheet).toHaveCount(0)
  await expect(page).toHaveURL(/#overview$/)
  await clickPageAction(page, '자산', '계좌 추가')
  const accountEditor = page.getByRole('dialog', { name: '계좌 추가' })
  await accountEditor.getByLabel('계좌명').fill('저장 전 계좌')
  await accountEditor.getByRole('button', { name: '닫기', exact: true }).last().click()
  await expect(page.getByRole('dialog', { name: '변경 버리기' }).getByText('저장하지 않은 변경이 있습니다.')).toBeVisible()
  await page.getByRole('dialog', { name: '변경 버리기' }).getByRole('button', { name: '계속 편집' }).click()
  await expect(accountEditor.getByLabel('계좌명')).toHaveValue('저장 전 계좌')
  await accountEditor.getByRole('button', { name: '닫기', exact: true }).first().click()
  await page.getByRole('dialog', { name: '변경 버리기' }).getByRole('button', { name: '변경 버리기' }).click()
  await expect(accountEditor).toHaveCount(0)

  const destinations = [
    ['overview', '자산'],
    ['decisions', '활동'],
    ['tasks', '활동'],
    ['strategy', '원칙'],
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
  await page.goto('/#today')
  await expect(page).toHaveURL(/#tasks$/)
  await expect(page.getByRole('heading', { level: 1, name: '활동' })).toBeVisible()
})

test('keeps legacy asset links pointed at their new purpose', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  for (const hash of ['accounts', 'instruments', 'tags']) {
    await page.goto(`/#${hash}`)
    await expect(page.getByRole('region', { name: '자산 종목' })).toBeVisible()
    await expect(page).toHaveURL(/#overview$/)
  }
  await page.goto('/#sheet')
  await expect(page.getByRole('region', { name: '자산 종목' })).toBeVisible()
  await expect(page).toHaveURL(/#overview$/)
  await page.goto('/#allocation')
  await expect(page.getByRole('heading', { name: '태그별 배분' })).toBeVisible()
})

test('keeps holdings, instrument detail, allocation and spreadsheet within supported widths', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#overview')
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('region', { name: '자산 종목' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: /E2E Apple/ }).click()
    await expect(page.getByRole('dialog', { name: 'E2E Apple' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('dialog', { name: 'E2E Apple' }).getByRole('button', { name: '닫기' }).first().click()
    await openMenuTab(page, '배분')
    await expect(page.getByRole('heading', { name: '태그별 배분' })).toBeVisible()
    await expect(page.locator('.page-panel').filter({ hasText: '태그별 배분' }).getByRole('button', { name: '태그별 배분 작업 메뉴' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await openMenuTab(page, '자산')
    await clickPageAction(page, '자산', '표 편집')
    await expect(page.getByRole('dialog', { name: '표 편집' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('dialog', { name: '표 편집' }).getByRole('button', { name: '닫기' }).click()
  }
})
