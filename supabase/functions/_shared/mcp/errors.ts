export type PortfolioErrorInfo = {
  code: string
  message: string
  retryable: boolean
  action: string
  database_code?: string
}

export class PortfolioRpcError extends Error {
  dbCode?: string
  details?: string
  hint?: string

  constructor(error: { message?: unknown; code?: unknown; details?: unknown; hint?: unknown }) {
    super(typeof error.message === 'string' ? error.message : 'Portfolio database operation failed')
    this.name = 'PortfolioRpcError'
    this.dbCode = typeof error.code === 'string' ? error.code : undefined
    this.details = typeof error.details === 'string' ? error.details : undefined
    this.hint = typeof error.hint === 'string' ? error.hint : undefined
  }
}

export function classifyPortfolioError(error: unknown): PortfolioErrorInfo {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  const dbCode = error instanceof PortfolioRpcError ? error.dbCode : undefined
  const result = (code: string, safeMessage: string, retryable: boolean, action: string): PortfolioErrorInfo => ({
    code, message: safeMessage, retryable, action, ...(dbCode ? { database_code: dbCode } : {}),
  })

  if (message.includes('context has expired')) return result('context_expired', 'The review context expired.', true, 'Create a new daily context and repeat the analysis before saving.')
  if (message.includes('preview expired')) return result('preview_expired', 'The preview expired.', true, 'Create a new preview, show it to the user, and confirm again.')
  if (message.includes('preview is stale')) return result('preview_stale', 'The stored values changed after the preview.', true, 'Re-read the current state and create a new preview.')
  if (message.includes('preview was already consumed')) return result('preview_consumed', 'The preview was already used.', false, 'Re-read the result; retry only with the original idempotency key.')
  if (message.includes('idempotency key')) return result('idempotency_conflict', 'The idempotency key belongs to a different request.', false, 'Use the original payload or start a new user-approved attempt with a new key.')
  if (message.includes('version conflict')) return result('version_conflict', 'The record changed after it was read.', true, 'Re-read the record and retry with its current version.')
  if (message.includes('not found') || message.includes('not accessible') || dbCode === '42501') return result('not_found_or_forbidden', 'The record was not found or is not accessible.', false, 'Check the selected account and sharing permission without revealing private existence.')
  if (message.includes('already closed') || message.includes('already reversed') || message.includes('only a') || message.includes('cannot be')) return result('invalid_state', 'The operation is not valid for the current state.', false, 'Re-read the current state and choose an available action.')
  if (message.includes('not supported')) return result('unsupported_operation', 'This operation is not supported.', false, 'Use one of the advertised tool operations.')
  if (message.includes('exceeds the 2 mib')) return result('payload_too_large', 'The request payload is too large.', false, 'Reduce the requested scope and try again.')
  return result('operation_failed', 'Portfolio operation failed.', true, 'Retry once with the same idempotency key when applicable, then report the request ID.')
}
