import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const supabaseArgs = ['--workdir', '.e2e']
const applicationMigrationDir = resolve('supabase/migrations')
const e2eMigrationDir = resolve('.e2e/supabase/migrations')
const e2eBaselineBoundary = '202609210001_daily_review_foundation.sql'
const copiedMigrations = []
const temporaryFunctionsDir = resolve('.e2e/supabase/functions')
let copiedFunctions = false
let supabaseStarted = false

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'inherit', ...options })
  if (result.status !== 0) {
    const error = new Error(`${command} exited with status ${result.status ?? 1}`)
    error.exitCode = result.status ?? 1
    throw error
  }
  return result
}

function syncApplicationMigrations() {
  const migrations = readdirSync(applicationMigrationDir)
    .filter((name) => name.endsWith('.sql') && name > e2eBaselineBoundary)
    .sort()

  for (const name of migrations) {
    const destination = resolve(e2eMigrationDir, basename(name))
    const existed = existsSync(destination)
    copyFileSync(resolve(applicationMigrationDir, name), destination)
    if (!existed) copiedMigrations.push(destination)
  }

  const newestApplicationMigration = readdirSync(applicationMigrationDir).filter((name) => name.endsWith('.sql')).sort().at(-1)
  if (newestApplicationMigration && !existsSync(resolve(e2eMigrationDir, newestApplicationMigration))) {
    throw new Error(`E2E migration sync missed ${newestApplicationMigration}`)
  }
}

function readSupabaseEnv() {
  const result = spawnSync('supabase', ['status', '-o', 'env', ...supabaseArgs], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || 'Could not read the isolated Supabase environment')

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

let exitCode = 0
try {
  syncApplicationMigrations()
  copiedFunctions = !existsSync(temporaryFunctionsDir)
  cpSync(resolve('supabase/functions'), temporaryFunctionsDir, { recursive: true, force: true })
  const networkResult = spawnSync('docker', ['network', 'inspect', 'supabase_network_e2e'], { stdio: 'ignore' })
  if (networkResult.status !== 0) run('docker', ['network', 'create', 'supabase_network_e2e'])

  run('supabase', ['start', ...supabaseArgs])
  supabaseStarted = true
  run('supabase', ['db', 'reset', ...supabaseArgs])
  run('supabase', ['test', 'db', '--local', resolve('supabase/tests/database'), ...supabaseArgs])

  const localEnv = readSupabaseEnv()
  await waitForAuth(localEnv.API_URL)
  run(process.execPath, ['scripts/test-mcp-contract.mjs'], {
    env: {
      ...process.env,
      SUPABASE_ANON_KEY: localEnv.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: localEnv.SERVICE_ROLE_KEY,
      SUPABASE_URL: localEnv.API_URL,
    },
  })
  run(process.execPath, ['scripts/check-deployment-readiness.mjs'], {
    env: {
      ...process.env,
      SUPABASE_ANON_KEY: localEnv.ANON_KEY,
      SUPABASE_URL: localEnv.API_URL,
      SUPABASE_SMOKE_EMAIL: 'e2e-owner@example.com',
      SUPABASE_SMOKE_PASSWORD: 'e2e-password',
    },
  })
  run(process.execPath, ['node_modules/playwright/cli.js', 'test', ...process.argv.slice(2)], {
    env: {
      ...process.env,
      E2E_PORT: process.env.E2E_PORT ?? '4174',
      VITE_SUPABASE_ANON_KEY: localEnv.ANON_KEY,
      VITE_SUPABASE_URL: localEnv.API_URL,
    },
  })
} catch (error) {
  console.error(error.message)
  exitCode = error.exitCode ?? 1
} finally {
  if (supabaseStarted) {
    const stopResult = spawnSync('supabase', ['stop', ...supabaseArgs], { encoding: 'utf8', stdio: 'inherit' })
    if (stopResult.status !== 0 && exitCode === 0) exitCode = stopResult.status ?? 1
  }
  for (const migration of copiedMigrations) {
    if (existsSync(migration)) unlinkSync(migration)
  }
  if (copiedFunctions && existsSync(temporaryFunctionsDir)) rmSync(temporaryFunctionsDir, { recursive: true, force: true })
}

process.exit(exitCode)
