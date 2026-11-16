import { FLIGHT_REGISTRY_GLOBAL } from '@next-federation/protocol'
import {
  registerFlightScope,
  type FlightScope,
} from '../src/bootstrap/flight-scope.ts'

const scope = (id: string): FlightScope => ({
  require: async () => id,
  chunkLoad: async () => {},
})

test('two keys hold independent scopes', async () => {
  const a = scope('a')
  const b = scope('b')
  registerFlightScope('https://one.test/base/', a)
  registerFlightScope('https://one.test/base-v2/', b)
  const registry = (globalThis as Record<string, unknown>)[
    FLIGHT_REGISTRY_GLOBAL
  ] as Record<string, FlightScope>
  expect(registry['https://one.test/base/']).toBe(a)
  expect(registry['https://one.test/base-v2/']).toBe(b)
  await expect(registry['https://one.test/base/']!.require('x')).resolves.toBe(
    'a'
  )
})

test('registering does not touch any other global', () => {
  const before = new Set(Reflect.ownKeys(globalThis))
  registerFlightScope('https://two.test/', scope('c'))
  const added = Reflect.ownKeys(globalThis).filter((k) => !before.has(k))
  // __nf_rsc__ may already exist from an earlier test in this file.
  expect(added.filter((k) => k !== FLIGHT_REGISTRY_GLOBAL)).toEqual([])
  expect(FLIGHT_REGISTRY_GLOBAL in globalThis).toBe(true)
  expect(
    Reflect.ownKeys(globalThis).some((k) => String(k).startsWith('__vite'))
  ).toBe(false)
})
