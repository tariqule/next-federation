import { canonicalJson } from '../src/index.ts'

test('key order does not change the output', () =>
  expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(
    '{"a":[{"c":2,"d":1}],"b":1}'
  ))

test('drops undefined-valued object properties', () =>
  expect(canonicalJson({ a: undefined, b: null, c: 'é' })).toBe(
    '{"b":null,"c":"é"}'
  ))

test.each([
  [() => 1],
  [1n],
  [new Date(0)],
  [new Map()],
  [new Set()],
  [NaN],
  [Infinity],
  [Symbol('x')],
  [new (class Foo {})()],
  [[1, undefined]],
])('rejects %p with NF-009', (value) =>
  expect(() => canonicalJson(value)).toThrow(/NF-009/)
)

test('rejects cycles with NF-009', () => {
  const a: Record<string, unknown> = {}
  a.self = a
  expect(() => canonicalJson(a)).toThrow(/NF-009/)
})

test('a shared (non-cyclic) reference is fine', () => {
  const shared = { x: 1 }
  expect(canonicalJson({ a: shared, b: shared })).toBe(
    '{"a":{"x":1},"b":{"x":1}}'
  )
})
