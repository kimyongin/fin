declare const Deno: { env: { get(name: string): string | undefined } }

// Hosted projects expose named secret API keys; local stacks may still expose
// only the legacy service-role key. The worker receives either on `apikey`.
export function getSearchWorkerKey(readEnv = (name: string) => Deno.env.get(name)): string {
  // An explicit deployment secret keeps the query caller and worker in sync
  // even when a hosted project's default key environment differs.
  const configuredKey = readEnv('ACTIVITY_SEARCH_WORKER_KEY')
  if (configuredKey) return configuredKey
  const secretKeys = readEnv('SUPABASE_SECRET_KEYS')
  if (secretKeys) {
    const key = JSON.parse(secretKeys)?.default
    if (typeof key !== 'string' || !key) throw new Error('Search worker key is not configured')
    return key
  }
  const legacyKey = readEnv('SUPABASE_SERVICE_ROLE_KEY')
  if (!legacyKey) throw new Error('Search worker key is not configured')
  return legacyKey
}
