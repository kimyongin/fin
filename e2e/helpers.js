const authStorageKey = 'sb-127-auth-token'

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
