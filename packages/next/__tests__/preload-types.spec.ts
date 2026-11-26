import { expect, test } from '@rstest/core'
import type { PreloadResult } from '@next-federation/react/components'

// rstest has no expectTypeOf: an exact type-equality check, checked by tsc.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false
function expectTypeOf<A>(value: A) {
  void value
  return {
    toEqualTypeOf<B>(...mismatch: Equal<A, B> extends true ? [] : [never]) {
      void mismatch
    },
  }
}

type Descriptor = Parameters<
  typeof import('../src/pages/server.ts').preloadRemoteComponent
>[0]

// Types only: the entries are never imported or called.
function check(
  entry: 'client' | 'pages' | 'server',
  preload: typeof import('../src/client/components.tsx').preloadRemoteComponent,
  pagesPreload: typeof import('../src/pages/components.tsx').preloadRemoteComponent,
  serverPreload: typeof import('../src/pages/server.ts').preloadRemoteComponent
) {
  void entry
  const d = null as Descriptor
  const maybe = undefined as { timeoutMs: number } | undefined
  for (const p of [preload, pagesPreload, serverPreload]) {
    expectTypeOf(p(d, './Counter')).toEqualTypeOf<Promise<void>>()
    expectTypeOf(p(d, './Counter', { timeoutMs: 1 })).toEqualTypeOf<
      Promise<PreloadResult>
    >()
    expectTypeOf(p(d, './Counter', maybe)).toEqualTypeOf<
      Promise<void | PreloadResult>
    >()
  }
}

test('every Next entry keeps the three preload overloads', () => {
  expect(typeof check).toBe('function')
})
