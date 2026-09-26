const authStorageKey = 'sb-127-auth-token'
const sessionsByPage = new WeakMap()

export async function openPageActionMenu(page, title) {
  await page.getByRole('button', { name: `${title} 작업 메뉴` }).click()
}

export async function clickPageAction(page, title, label) {
  await openPageActionMenu(page, title)
  await page.getByRole('group', { name: `${title} 작업` }).getByRole('button', { name: label, exact: true }).click()
}

export async function signInAs(page, email) {
  const response = await page.request.post(`${process.env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    data: { email, password: 'e2e-password' },
    headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY },
  })
  if (!response.ok()) throw new Error(`Could not create an E2E session for ${email}`)

  const session = await response.json()
  sessionsByPage.set(page, session)
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: authStorageKey,
    value: session,
  })
}

export async function callRpc(page, name, args = {}) {
  const session = sessionsByPage.get(page)
  if (!session?.access_token) throw new Error('Sign in before calling an isolated E2E RPC')
  const response = await page.request.post(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/${name}`, {
    data: args,
    headers: {
      apikey: process.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
  })
  return { body: await response.json(), status: response.status() }
}

export async function seedProviderPrice(page, ticker, close, date) {
  if (!process.env.E2E_SUPABASE_SERVICE_ROLE_KEY) throw new Error('Isolated E2E service-role key is required for provider-price fixtures')
  const ownerUserId = sessionsByPage.get(page)?.user?.id
  if (!ownerUserId) throw new Error('Sign in before seeding an isolated provider price')
  const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  const response = await page.request.post(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/app_sync_upsert_price_rows`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    data: { input_owner_user_id: ownerUserId, input_ticker: ticker, input_source_symbol: ticker, input_prices: [{ date, close: String(close) }] },
  })
  if (!response.ok()) throw new Error(`Isolated provider-price fixture failed (${response.status()}): ${(await response.text()).slice(0, 200)}`)
}

export async function openMenuTab(page, label) {
  const primaryLabel = ['판단', '할 일', '활동'].includes(label) ? '활동' : label
  const primary = page.locator('nav[aria-label="주요 메뉴"]:visible').getByRole('button', { name: primaryLabel, exact: true })
  if (await primary.count()) {
    await primary.click()
    return
  }
  await page.getByRole('button', { name: '메뉴 열기' }).click()
  await page.getByRole('group', { name: '보조 메뉴' }).getByRole('button', { name: label, exact: true }).click()
}
