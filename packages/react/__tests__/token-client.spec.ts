import { createTokenClient, clearIslandTokens } from '../src/token-client.ts'

type Reply = { status: number; body?: unknown } | 'network'

function fakeFetch(replies: Reply[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const fn = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const reply = replies.shift() ?? { status: 500 }
    if (reply === 'network') throw new TypeError('network down')
    return new Response(
      reply.body === undefined ? null : JSON.stringify(reply.body),
      { status: reply.status }
    )
  }) as typeof fetch
  return { fn, calls }
}

const ok = (token: string, expiresAt: number, identityKey = 'u1'): Reply => ({
  status: 200,
  body: { token, expiresAt, identityKey },
})
const EP = '/api/nf/token?aud=shop'

describe('createTokenClient', () => {
  let clock = 1000
  const now = () => clock
  beforeEach(() => {
    clock = 1000
    clearIslandTokens()
  })

  test('fetches lazily, once, with POST and same-origin credentials', async () => {
    const { fn, calls } = fakeFetch([ok('t1', 2000)])
    const client = createTokenClient({
      endpoint: EP,
      identityKey: 'u1',
      fetch: fn,
      now,
    })
    expect(calls).toHaveLength(0)
    expect(await client.getToken()).toBe('t1')
    expect(await client.getToken()).toBe('t1')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(EP)
    expect(calls[0]!.init?.method).toBe('POST')
    expect(calls[0]!.init?.credentials).toBe('same-origin')
  })

  test('reuses the token until 30 s before expiry, then refreshes', async () => {
    const { fn, calls } = fakeFetch([ok('t1', 1100), ok('t2', 1400)])
    const client = createTokenClient({
      endpoint: EP,
      identityKey: 'u1',
      fetch: fn,
      now,
    })
    expect(await client.getToken()).toBe('t1')
    clock = 1069
    expect(await client.getToken()).toBe('t1')
    clock = 1070
    expect(await client.getToken()).toBe('t2')
    expect(calls).toHaveLength(2)
  })

  test('concurrent calls share one request', async () => {
    const { fn, calls } = fakeFetch([ok('t1', 2000)])
    const client = createTokenClient({
      endpoint: EP,
      identityKey: 'u1',
      fetch: fn,
      now,
    })
    const other = createTokenClient({
      endpoint: EP,
      identityKey: 'u1',
      fetch: fn,
      now,
    })
    const all = await Promise.all([
      client.getToken(),
      client.getToken(),
      other.getToken(),
    ])
    expect(all).toEqual(['t1', 't1', 't1'])
    expect(calls).toHaveLength(1)
  })

  test('a different identityKey drops the cached token and refetches', async () => {
    const { fn, calls } = fakeFetch([
      ok('t1', 2000, 'u1'),
      ok('t2', 2000, 'u2'),
    ])
    const a = createTokenClient({
      endpoint: EP,
      identityKey: 'u1',
      fetch: fn,
      now,
    })
    expect(await a.getToken()).toBe('t1')
    const b = createTokenClient({
      endpoint: EP,
      identityKey: 'u2',
      fetch: fn,
      now,
    })
    expect(await b.getToken()).toBe('t2')
    expect(calls).toHaveLength(2)
    // the first user's token is gone, not restored
    expect(await a.getToken()).toBeNull()
  })

  test('identityKey null never reuses a cached token', async () => {
    const { fn, calls } = fakeFetch([ok('t1', 2000), ok('t2', 2000)])
    const client = createTokenClient({
      endpoint: EP,
      identityKey: null,
      fetch: fn,
      now,
    })
    expect(await client.getToken()).toBe('t1')
    expect(await client.getToken()).toBe('t2')
    expect(calls).toHaveLength(2)
  })

  test('a 401 clears the cache and returns null; the next call refetches', async () => {
    const { fn, calls } = fakeFetch([
      ok('t1', 1100),
      { status: 401 },
      ok('t3', 2000),
    ])
    const client = createTokenClient({
      endpoint: EP,
      identityKey: 'u1',
      fetch: fn,
      now,
    })
    expect(await client.getToken()).toBe('t1')
    clock = 1080
    expect(await client.getToken()).toBeNull()
    expect(await client.getToken()).toBe('t3')
    expect(calls).toHaveLength(3)
  })

  test('a network failure or malformed reply returns null and clears the entry', async () => {
    const { fn } = fakeFetch([
      ok('t1', 1100),
      'network',
      { status: 200, body: { nope: 1 } },
      ok('t4', 2000),
    ])
    const client = createTokenClient({
      endpoint: EP,
      identityKey: 'u1',
      fetch: fn,
      now,
    })
    expect(await client.getToken()).toBe('t1')
    clock = 1080
    expect(await client.getToken()).toBeNull()
    expect(await client.getToken()).toBeNull()
    expect(await client.getToken()).toBe('t4')
  })

  test('a token for another identity than requested is not cached or returned', async () => {
    const { fn } = fakeFetch([ok('t1', 2000, 'someone-else')])
    const client = createTokenClient({
      endpoint: EP,
      identityKey: 'u1',
      fetch: fn,
      now,
    })
    expect(await client.getToken()).toBeNull()
  })

  test("invalidating one endpoint does not discard another endpoint's in-flight response", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const fn = (async () => {
      await gate
      return new Response(
        JSON.stringify({ token: 'tb', expiresAt: 2000, identityKey: 'u1' }),
        { status: 200 }
      )
    }) as typeof fetch
    const a = createTokenClient({
      endpoint: '/t?aud=a',
      identityKey: 'u1',
      fetch: fn,
      now,
    })
    const b = createTokenClient({
      endpoint: '/t?aud=b',
      identityKey: 'u1',
      fetch: fn,
      now,
    })
    const pending = b.getToken()
    a.invalidate()
    release()
    expect(await pending).toBe('tb')
  })

  test('a non-finite expiresAt is rejected', async () => {
    const { fn } = fakeFetch([
      { status: 200, body: { token: 't', expiresAt: null, identityKey: 'u1' } },
    ])
    const client = createTokenClient({
      endpoint: EP,
      identityKey: 'u1',
      fetch: fn,
      now,
    })
    expect(await client.getToken()).toBeNull()
  })

  test('invalidate() forces a refetch', async () => {
    const { fn, calls } = fakeFetch([ok('t1', 2000), ok('t2', 2000)])
    const client = createTokenClient({
      endpoint: EP,
      identityKey: 'u1',
      fetch: fn,
      now,
    })
    await client.getToken()
    client.invalidate()
    expect(await client.getToken()).toBe('t2')
    expect(calls).toHaveLength(2)
  })

  test('clearIslandTokens() empties every endpoint', async () => {
    const { fn, calls } = fakeFetch([
      ok('a1', 2000),
      ok('b1', 2000),
      ok('a2', 2000),
      ok('b2', 2000),
    ])
    const a = createTokenClient({
      endpoint: '/t?aud=a',
      identityKey: 'u1',
      fetch: fn,
      now,
    })
    const b = createTokenClient({
      endpoint: '/t?aud=b',
      identityKey: 'u1',
      fetch: fn,
      now,
    })
    await a.getToken()
    await b.getToken()
    clearIslandTokens()
    expect(await a.getToken()).toBe('a2')
    expect(await b.getToken()).toBe('b2')
    expect(calls).toHaveLength(4)
  })

  test('an in-flight request that finishes after clearIslandTokens() is not cached', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let n = 0
    const fn = (async () => {
      const mine = ++n
      await gate
      return new Response(
        JSON.stringify({
          token: `t${mine}`,
          expiresAt: 2000,
          identityKey: 'u1',
        }),
        { status: 200 }
      )
    }) as typeof fetch
    const client = createTokenClient({
      endpoint: EP,
      identityKey: 'u1',
      fetch: fn,
      now,
    })
    const first = client.getToken()
    clearIslandTokens()
    release()
    expect(await first).toBeNull()
    expect(await client.getToken()).toBe('t2')
  })

  test('the token is never written to localStorage, sessionStorage or document.cookie', async () => {
    const writes: string[] = []
    const spy = (obj: object, name: string) => {
      const proto = Object.getPrototypeOf(obj) as object
      const orig = (obj as Record<string, unknown>)[name]
      if (typeof orig !== 'function') return
      void proto
      ;(obj as Record<string, unknown>)[name] = (...a: unknown[]) => {
        writes.push(a.join('='))
        return (orig as (...x: unknown[]) => unknown).apply(obj, a)
      }
    }
    if (typeof localStorage !== 'undefined') spy(localStorage, 'setItem')
    if (typeof sessionStorage !== 'undefined') spy(sessionStorage, 'setItem')
    const { fn } = fakeFetch([ok('SECRET-TOKEN', 2000)])
    const client = createTokenClient({
      endpoint: EP,
      identityKey: 'u1',
      fetch: fn,
      now,
    })
    expect(await client.getToken()).toBe('SECRET-TOKEN')
    expect(writes.join('|')).not.toContain('SECRET-TOKEN')
    if (typeof document !== 'undefined')
      expect(document.cookie).not.toContain('SECRET-TOKEN')
    if (typeof localStorage !== 'undefined')
      expect(JSON.stringify({ ...localStorage })).not.toContain('SECRET-TOKEN')
  })
})
