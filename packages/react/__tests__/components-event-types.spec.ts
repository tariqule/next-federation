import { expect, test } from '@rstest/core'
import type { ComponentEvent } from '../src/components/runtime.ts'

// Checked by tsc (pnpm typecheck): handlers written before component:fallback.
test('a handler written against the old union with a default branch still compiles', () => {
  function onComponent(e: ComponentEvent): string {
    switch (e.type) {
      case 'component:load':
        return `${e.remote} ${e.buildId} ${e.expose} ${e.ms} ${e.env}`
      case 'component:error':
        return `${e.remote} ${e.code} ${String(e.error)} ${e.env}`
      default:
        return 'other'
    }
  }
  const fallback: ComponentEvent = {
    type: 'component:fallback',
    remote: 'r',
    buildId: 'b',
    expose: './X',
    env: 'server',
    phase: 'render',
    reason: 'refused',
    code: 'NF-027',
  }
  expect(onComponent(fallback)).toBe('other')
  expect(
    onComponent({
      type: 'component:load',
      remote: 'r',
      buildId: 'b',
      expose: './X',
      ms: 1,
      env: 'client',
    })
  ).toBe('r b ./X 1 client')
})

// Checked by tsc: fakes built before component:error carried ms still compile.
test('a React component:error without ms compiles; with ms too', () => {
  const without: ComponentEvent = {
    type: 'component:error',
    remote: 'r',
    buildId: 'b',
    expose: './X',
    code: 'NF-029',
    error: new Error('x'),
    env: 'client',
  }
  const withMs: ComponentEvent = { ...without, ms: 3 }
  expect(without.type).toBe('component:error')
  expect(withMs.type === 'component:error' && withMs.ms).toBe(3)
})
