import { expect, test } from '@playwright/test'
import { callRpc, clickPageAction, signInAs } from './helpers'

test('saves activity context from principle, allocation and asset confirmation', async ({ page }) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(10_000)
  const base = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  if (!base || !anonKey || !serviceKey) throw new Error('A local isolated Supabase URL, anon key and service key are required')
  if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Never run this test against a remote database')
  const email = `save-context-${crypto.randomUUID()}@example.com`
  const adminHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  const created = await page.request.post(`${base}/auth/v1/admin/users`, {
    headers: adminHeaders, data: { email, password: 'e2e-password', email_confirm: true },
  })
  expect(created.ok()).toBe(true)
  const user = await created.json()
  try {
    await signInAs(page, email)
    const tag = await callRpc(page, 'app_save_activity_tag', {
      input_tag_id: null, input_expected_version: null,
      input_idempotency_key: crypto.randomUUID(), input_name: 'UI context',
    })
    expect(tag.status).toBe(200)
    const tagId = tag.body.id

    await page.goto('/#strategy')
    await clickPageAction(page, '현재 원칙', '원칙 작성')
    const principleEditor = page.getByRole('dialog', { name: '원칙 작성' })
    await principleEditor.getByLabel('내용 (마크다운)').fill('## UI context principle')
    await principleEditor.getByRole('button', { name: '저장' }).click()
    const principleConfirm = page.getByRole('dialog', { name: '변경 내용 저장' })
    await principleConfirm.getByLabel('변경 메모 (선택)').fill('UI context note')
    await principleConfirm.getByRole('button', { name: 'UI context' }).click()
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(principleConfirm).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    await principleConfirm.getByRole('button', { name: '취소' }).click()
    await principleEditor.getByRole('button', { name: '저장' }).click()
    await expect(principleConfirm.getByLabel('변경 메모 (선택)')).toHaveValue('UI context note')
    await expect(principleConfirm.getByRole('button', { name: 'UI context' })).toHaveAttribute('aria-pressed', 'true')
    const principleResponse = page.waitForResponse((response) => response.url().includes('/rpc/app_save_principle_with_activity') && response.status() === 200)
    await principleConfirm.getByRole('button', { name: '저장' }).click()
    const principleSaved = await (await principleResponse).json()
    expect(principleSaved.activity_id).toBeTruthy()

    const assetTag = await callRpc(page, 'app_save_tag', { input_tag_id: null, input_name: 'UI allocation', input_sort_order: 0, input_source: 'user', input_request: null })
    expect(assetTag.status).toBe(200)
    expect(assetTag.body[0]?.tag_id).toBeTruthy()
    await page.goto('/#allocation')
    await page.reload()
    await page.getByRole('textbox', { name: 'UI allocation 목표 비중' }).fill('100', { timeout: 10000 })
    await page.getByRole('button', { name: '저장', exact: true }).click()
    const allocationConfirm = page.getByRole('dialog', { name: '변경 내용 저장' })
    await allocationConfirm.getByLabel('변경 메모 (선택)').fill('UI allocation note')
    await allocationConfirm.getByRole('button', { name: 'UI context' }).click()
    const allocationResponse = page.waitForResponse((response) => response.url().includes('/rpc/app_save_allocation_targets_with_activity') && response.status() === 200)
    await allocationConfirm.getByRole('button', { name: '저장' }).click()
    const allocationSaved = await (await allocationResponse).json()
    expect(allocationSaved.activity_id).toBeTruthy()

    const instrument = await callRpc(page, 'app_create_instrument', {
      input_ticker: 'UICONTEXT', input_display_name: 'UI context asset', input_currency: 'KRW',
      input_instrument_type: 'market', input_tag_id: null, input_note: null,
    })
    expect(instrument.status).toBe(200)
    await page.goto('/#overview')
    await page.reload()
    await page.getByRole('button', { name: /UI context asset/ }).click({ timeout: 10000 })
    const assetEditor = page.getByRole('dialog', { name: 'UI context asset' })
    await assetEditor.getByLabel('메모', { exact: true }).fill('UI context asset note')
    await assetEditor.getByRole('button', { name: '저장', exact: true }).click()
    const assetConfirm = page.getByRole('dialog', { name: '변경 내용 저장' })
    await assetConfirm.getByRole('button', { name: 'UI context' }).click()
    const assetResponse = page.waitForResponse((response) => response.url().includes('/rpc/app_save_asset_detail_with_activity') && response.status() === 200)
    await assetConfirm.getByRole('button', { name: '저장' }).click()
    const assetSaved = await (await assetResponse).json()
    expect(assetSaved.activity_id).toBeTruthy()

    for (const activityId of [principleSaved.activity_id, allocationSaved.activity_id, assetSaved.activity_id]) {
      const detail = await callRpc(page, 'app_get_activity', { input_activity_id: activityId, input_owner_user_id: null })
      expect(detail.status).toBe(200)
      expect(detail.body.tags).toEqual(expect.arrayContaining([expect.objectContaining({ id: tagId })]))
    }
  } finally {
    await page.request.delete(`${base}/auth/v1/admin/users/${user.id}`, { headers: adminHeaders, timeout: 10_000 })
  }
})
