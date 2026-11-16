import { getIdentity, runWithIdentity } from '../src/identity-context.ts'

test('getIdentity returns the identity inside runWithIdentity and null outside', async () => {
  expect(getIdentity()).toBeNull()
  const seen = await runWithIdentity({ sub: 'u1' }, async () => {
    await Promise.resolve()
    return getIdentity()
  })
  expect(seen).toEqual({ sub: 'u1' })
  expect(getIdentity()).toBeNull()
})

test('runWithIdentity(null) yields null inside', async () => {
  expect(await runWithIdentity(null, async () => getIdentity())).toBeNull()
})

test('concurrent runWithIdentity calls do not leak into each other', async () => {
  const run = (sub: string, delay: number) =>
    runWithIdentity({ sub }, async () => {
      await new Promise((r) => setTimeout(r, delay))
      return getIdentity()?.sub
    })
  const out = await Promise.all([run('a', 20), run('b', 5), run('c', 10)])
  expect(out).toEqual(['a', 'b', 'c'])
})

test('the store lives in a single Symbol.for slot shared by duplicate copies', async () => {
  const slot = (globalThis as Record<symbol, unknown>)[
    Symbol.for('next-federation.identity')
  ]
  expect(slot).toBeDefined()
})
