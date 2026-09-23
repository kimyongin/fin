import { describe, expect, it } from 'vitest'

import { assertMutationRpcSignatures } from './deployment-rpc-contract.mjs'

const contract = { app_create_activity_with_tags: ['input_idempotency_key', 'input_payload', 'input_tag_ids'] }
const operation = (properties) => ({ post: { parameters: [{ in: 'body', name: 'args', schema: { properties } }] } })

describe('read-only deployment RPC contract', () => {
  it('accepts the deployed signature', () => {
    expect(assertMutationRpcSignatures({ paths: { '/rpc/app_create_activity_with_tags': operation({ input_payload: {}, input_tag_ids: {}, input_idempotency_key: {} }) } }, contract)).toBe(1)
  })

  it('rejects a missing RPC', () => {
    expect(() => assertMutationRpcSignatures({ paths: {} }, contract)).toThrow(/RPC is missing/)
  })

  it('rejects a changed RPC signature', () => {
    expect(() => assertMutationRpcSignatures({ paths: { '/rpc/app_create_activity_with_tags': operation({ input_payload: {} }) } }, contract)).toThrow(/input signature mismatch/)
  })
})
