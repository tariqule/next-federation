import { expect, test } from '@rstest/core'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import type { PreloadResult } from '../src/components/index.tsx'
import { createBindings } from '../src/components/render.tsx'
import type { BindingsRuntime } from '../src/components/render.tsx'

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

test('preload overloads return void without options, PreloadResult with', () => {
  const bindings = createBindings({
    runtime: {} as BindingsRuntime,
    isServer: true,
  })
  const preload = bindings.preloadRemoteComponent
  const Remote = bindings.createRemoteComponent({ expose: './Counter' })
  const d = null as RemoteComponentDescriptor | null
  const maybe = undefined as { timeoutMs: number } | undefined
  // Type-only: never called.
  const check = () => {
    expectTypeOf(preload(d, './Counter')).toEqualTypeOf<Promise<void>>()
    expectTypeOf(preload(d, './Counter', { timeoutMs: 1 })).toEqualTypeOf<
      Promise<PreloadResult>
    >()
    expectTypeOf(preload(d, './Counter', maybe)).toEqualTypeOf<
      Promise<void | PreloadResult>
    >()
    expectTypeOf(Remote.preload(d)).toEqualTypeOf<Promise<void>>()
    expectTypeOf(Remote.preload(d, { timeoutMs: 1 })).toEqualTypeOf<
      Promise<PreloadResult>
    >()
    expectTypeOf(Remote.preload(d, maybe)).toEqualTypeOf<
      Promise<void | PreloadResult>
    >()
  }
  expect(typeof check).toBe('function')
})
