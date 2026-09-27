import { describe, expect, it } from 'vitest'

import { getSearchWorkerKey } from './search-worker-auth.ts'

describe('search worker authentication', () => {
  it('uses the explicitly configured worker key first', () => {
    expect(getSearchWorkerKey((name) => ({
      ACTIVITY_SEARCH_WORKER_KEY: 'deployment-key',
      SUPABASE_SECRET_KEYS: '{"default":"sb_secret_example"}',
    })[name])).toBe('deployment-key')
  })

  it('uses the hosted named secret key before the legacy key', () => {
    expect(getSearchWorkerKey((name) => ({
      SUPABASE_SECRET_KEYS: '{"default":"sb_secret_example"}',
      SUPABASE_SERVICE_ROLE_KEY: 'legacy',
    })[name])).toBe('sb_secret_example')
  })

  it('uses the local legacy key when named secret keys are unavailable', () => {
    expect(getSearchWorkerKey((name) => ({ SUPABASE_SERVICE_ROLE_KEY: 'local-key' })[name])).toBe('local-key')
  })

  it('rejects an incomplete named secret configuration', () => {
    expect(() => getSearchWorkerKey((name) => ({
      SUPABASE_SECRET_KEYS: '{}', SUPABASE_SERVICE_ROLE_KEY: 'legacy',
    })[name])).toThrow('Search worker key is not configured')
  })
})
