const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SMOKE_EMAIL', 'SUPABASE_SMOKE_PASSWORD']
const missing = required.filter((name) => !process.env[name])
if (missing.length) throw new Error(`Missing deployment-readiness secrets: ${missing.join(', ')}`)

const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, '')
const commonHeaders = { apikey: process.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }
const authResponse = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: commonHeaders,
  body: JSON.stringify({ email: process.env.SUPABASE_SMOKE_EMAIL, password: process.env.SUPABASE_SMOKE_PASSWORD }),
})
if (!authResponse.ok) throw new Error(`Authenticated readiness login failed (${authResponse.status})`)
const session = await authResponse.json()
if (!session.access_token) throw new Error('Authenticated readiness login returned no access token')

const rpcChecks = [
  ['app_list_daily_briefing_page', { input_cursor: null, input_limit: 1, input_owner_user_id: null }],
  ['app_list_investment_decision_page', { input_cursor: null, input_filter: 'current', input_limit: 1, input_owner_user_id: null }],
  ['app_list_portfolio_task_page', { input_cursor: null, input_filter: 'active', input_limit: 1, input_owner_user_id: null }],
]

for (const [name, body] of rpcChecks) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { ...commonHeaders, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`${name} readiness check failed (${response.status}): ${detail.slice(0, 300)}`)
  }
}

console.log(`Authenticated readiness passed for ${rpcChecks.length} RPCs.`)
