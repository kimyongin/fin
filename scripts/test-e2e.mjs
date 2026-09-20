import { spawnSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const supabaseArgs = ['--workdir', '.e2e']
const sharedSliceMigrations = [
  'supabase/migrations/202609210002_decision_research_task_slice.sql',
  'supabase/migrations/202609210003_daily_context_lifecycle.sql',
]

for (const migration of sharedSliceMigrations) {
  copyFileSync(resolve(migration), resolve('.e2e/supabase/migrations', basename(migration)))
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'inherit', ...options })
  if (result.status !== 0) process.exit(result.status ?? 1)
  return result
}

function readSupabaseEnv() {
  const result = spawnSync('supabase', ['status', '-o', 'env', ...supabaseArgs], { encoding: 'utf8' })
  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }

  return Object.fromEntries(result.stdout.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (!match) return []
    return [[match[1], match[2].replace(/^"|"$/g, '')]]
  }))
}

async function waitForAuth(apiUrl) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}/auth/v1/health`)
      if (response.ok) return
    } catch {
      // Supabase services are still restarting after the database reset.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('Local Supabase Auth did not become ready')
}

const networkResult = spawnSync('docker', ['network', 'inspect', 'supabase_network_e2e'], { stdio: 'ignore' })
if (networkResult.status !== 0) run('docker', ['network', 'create', 'supabase_network_e2e'])

run('supabase', ['start', ...supabaseArgs])
run('supabase', ['db', 'reset', ...supabaseArgs])

const localEnv = readSupabaseEnv()
await waitForAuth(localEnv.API_URL)

const result = spawnSync(process.execPath, ['node_modules/playwright/cli.js', 'test', ...process.argv.slice(2)], {
  env: {
    ...process.env,
    VITE_SUPABASE_ANON_KEY: localEnv.ANON_KEY,
    VITE_SUPABASE_URL: localEnv.API_URL,
  },
  stdio: 'inherit',
})

run('supabase', ['stop', ...supabaseArgs])
process.exit(result.status ?? 1)
