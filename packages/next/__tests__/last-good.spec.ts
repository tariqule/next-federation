import type { IslandResult, IslandTarget } from '@next-federation/core'
import {
  clearLastGood,
  keepSeconds,
  lastGood,
  lastGoodKey,
  rememberGood,
} from '../src/server/last-good.ts'

type Good = Extract<IslandResult, { ok: true }>
const target: IslandTarget = {
  remote: 'a',
  origin: 'https://a.example.com',
  allowedOrigins: ['https://a.example.com'],
  timeoutMs: 3000,
  retries: 0,
}
const good = (buildId: string, bytes = 100): Good => ({
  ok: true,
  envelope: { buildId } as never,
  meta: { ms: 1, bytes, attempts: 1 },
})
const key = (n: number) => lastGoodKey(target, 'Banner', `{"n":${n}}`, '{}')

beforeEach(() => clearLastGood())

test('the key covers remote origin, remote, island, props and host context', () => {
  const base = lastGoodKey(target, 'Banner', '{}', '{}')
  expect(
    lastGoodKey(
      { ...target, origin: 'https://b.example.com' },
      'Banner',
      '{}',
      '{}'
    )
  ).not.toBe(base)
  expect(lastGoodKey(target, 'Other', '{}', '{}')).not.toBe(base)
  expect(lastGoodKey(target, 'Banner', '{"x":1}', '{}')).not.toBe(base)
  expect(lastGoodKey(target, 'Banner', '{}', '{"locale":"fr"}')).not.toBe(base)
})

test('keepSeconds is the island cache entry expire: an hour, or twice revalidate', () => {
  expect(keepSeconds(60)).toBe(3600)
  expect(keepSeconds(5000)).toBe(10000)
})

test('an older result never replaces a newer one', () => {
  rememberGood(key(1), good('new'), 2000)
  rememberGood(key(1), good('old'), 1000)
  expect(lastGood(key(1), 3000, 60)?.result.envelope.buildId).toBe('new')
})

test('the age is measured from the good fetch to the failure', () => {
  rememberGood(key(1), good('b1'), 1000)
  expect(lastGood(key(1), 61_000, 60)).toMatchObject({ ageSeconds: 60 })
  expect(lastGood(key(1), 62_000, 60)).toBeNull()
})

test('bounded to 500 entries: the oldest goes first, a refresh keeps an entry', () => {
  for (let n = 0; n < 500; n++) rememberGood(key(n), good(`b${n}`), 1000 + n)
  rememberGood(key(0), good('b0'), 5000)
  rememberGood(key(500), good('b500'), 6000)
  expect(lastGood(key(0), 7000, 60)).not.toBeNull()
  expect(lastGood(key(1), 7000, 60)).toBeNull()
  expect(lastGood(key(500), 7000, 60)).not.toBeNull()
})

test('bounded to 50 MiB of envelopes in all', () => {
  const big = 20 * 1024 * 1024
  rememberGood(key(1), good('b1', big), 1000)
  rememberGood(key(2), good('b2', big), 1001)
  rememberGood(key(3), good('b3', big), 1002)
  expect(lastGood(key(1), 2000, 60)).toBeNull()
  expect(lastGood(key(2), 2000, 60)).not.toBeNull()
  expect(lastGood(key(3), 2000, 60)).not.toBeNull()
})

test('the keys count against the 50 MiB too: large props cannot grow memory past it', () => {
  // 10 Mi characters of props per key, small envelopes: the keys are what
  // takes the memory (a JavaScript string can take 2 bytes per character).
  const props = (n: number) =>
    JSON.stringify({ n, blob: 'x'.repeat(10 * 1024 * 1024) })
  const bigKey = (n: number) => lastGoodKey(target, 'Banner', props(n), '{}')
  rememberGood(bigKey(1), good('b1'), 1000)
  rememberGood(bigKey(2), good('b2'), 1001)
  rememberGood(bigKey(3), good('b3'), 1002)
  expect(lastGood(bigKey(1), 2000, 60)).toBeNull()
  expect(lastGood(bigKey(2), 2000, 60)).not.toBeNull()
  expect(lastGood(bigKey(3), 2000, 60)).not.toBeNull()
})
