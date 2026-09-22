import { describe, expect, it } from 'vitest'
import { classifyPortfolioError, PortfolioRpcError } from './errors.ts'

describe('portfolio MCP errors', () => {
  it.each([
    ['Trade preview expired', 'preview_expired', true],
    ['Trade preview is stale; create a new preview', 'preview_stale', true],
    ['Trade preview was already consumed', 'preview_consumed', false],
    ['Holding version conflict', 'version_conflict', true],
    ['Entity note conflict', 'version_conflict', true],
    ['Idempotency key was already used with a different request', 'idempotency_conflict', false],
  ])('classifies %s', (message, code, retryable) => {
    expect(classifyPortfolioError(new PortfolioRpcError({ message, code: 'P0001' }))).toMatchObject({ code, retryable, database_code: 'P0001' })
  })

  it('does not expose an unexpected database message', () => {
    const classified = classifyPortfolioError(new PortfolioRpcError({ message: 'secret table detail', code: 'XX000', details: 'private snapshot' }))
    expect(classified).toMatchObject({ code: 'operation_failed', message: 'Portfolio operation failed.' })
    expect(JSON.stringify(classified)).not.toContain('private snapshot')
    expect(JSON.stringify(classified)).not.toContain('secret table detail')
  })

  it.each([
    ['Market reconciliation requires quantity and avg_price', 'P0001'],
    ['invalid input syntax for type numeric', '22P02'],
    ['Trade cannot sell more than the current holding', 'P0001'],
  ])('classifies invalid input as non-retryable without exposing details', (message, databaseCode) => {
    expect(classifyPortfolioError(new PortfolioRpcError({ message, code: databaseCode }))).toMatchObject({
      code: 'validation_error', retryable: false, database_code: databaseCode,
    })
  })

  it('does not tell the caller to blindly retry an unknown failure', () => {
    const classified = classifyPortfolioError(new Error('socket closed unexpectedly'))
    expect(classified).toMatchObject({ code: 'operation_failed', retryable: false })
    expect(classified.action).toContain('same idempotency key')
  })
})
