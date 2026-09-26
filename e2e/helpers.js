const authStorageKey = 'sb-127-auth-token'

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
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: authStorageKey,
    value: session,
  })
}

export async function callRpc(page, name, args = {}) {
  return page.evaluate(async ({ anonKey, args, name, url }) => {
    const session = JSON.parse(localStorage.getItem('sb-127-auth-token') ?? '{}')
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      body: JSON.stringify(args),
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
    return { body: await response.json(), status: response.status }
  }, { anonKey: process.env.VITE_SUPABASE_ANON_KEY, args, name, url: process.env.VITE_SUPABASE_URL })
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
