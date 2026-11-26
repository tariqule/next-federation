import { expect, test } from '@rstest/core'
import type { FederationEvent } from '../src/events.ts'

// Checked by tsc (pnpm typecheck): a handler written before component:fallback.
test('a FederationEvent handler written against the old union with a default branch still compiles', () => {
  function onEvent(e: FederationEvent): string {
    switch (e.type) {
      case 'component:error':
        return `${e.remote} ${e.code} ${e.ms}`
      case 'component:descriptor':
        return `${e.remote} ${e.ssr}`
      default:
        return 'other'
    }
  }
  expect(
    onEvent({
      type: 'component:fallback',
      remote: 'r',
      buildId: 'b',
      expose: './X',
      env: 'server',
      phase: 'render',
      reason: 'failed',
      code: 'NF-029',
    })
  ).toBe('other')
  expect(
    onEvent({ type: 'component:error', remote: 'r', code: 'NF-029', ms: 3 })
  ).toBe('r NF-029 3')
})
