import { defineFederation } from '@next-federation/core'
import type { FederationEvent, IslandResult } from '@next-federation/core'
import { generateSigningKey } from '@next-federation/core/identity'
import { getPublicEnvelope } from '@next-federation/next/island-cache'
import { logger } from '@next-federation/sdk'
import { cookies, headers } from 'next/headers'
import { unstable_rethrow } from 'next/navigation'
import { markFresh } from '../src/server/fresh-mark.ts'
import { createIslandLoader, loadIsland } from '../src/server/load-island.ts'
import type { AppIdentity } from '../src/server/load-island.ts'

rs.mock('next/headers', () => ({ cookies: rs.fn(), headers: rs.fn() }))
// Like Next's: rethrows its own control-flow errors (they carry a `digest`).
rs.mock('next/navigation', () => ({
  unstable_rethrow: rs.fn((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'digest' in error) {
      throw error
    }
  }),
}))
rs.mock('@next-federation/next/island-cache', () => ({
  getPublicEnvelope: rs.fn(),
}))
// Outside a React Server Components render `cache()` does not memoise, so the
// test swaps in a real memoiser keyed by the (single, string) argument. Only
// `cache` is used from react by the modules under test.
rs.mock('react', () => ({
  cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
    const memo = new Map<unknown, R>()
    return (...args: A): R => {
      const key = args[0]
      if (!memo.has(key)) memo.set(key, fn(...args))
      return memo.get(key)!
    }
  },
}))

const envelope = {
  protocolVersion: 1,
  remote: 'a',
  buildId: 'b1',
  mode: 'production',
  html: '<p>hi</p>',
  rscPayload: '0:"x"',
  css: ['https://a.example.com/a.css'],
  bootstrap: 'https://a.example.com/boot.js',
  reactVersion: '19.2.0',
  idPlaceholder: 'nfph0',
}

type Seen = { url: string; headers: Record<string, string>; init: RequestInit }
let seen: Seen
let requests: number
let respond: () => Response
let events: FederationEvent[]
const realFetch = globalThis.fetch
// Next's types make NODE_ENV read-only.
const setNodeEnv = (value: string) => {
  ;(process.env as Record<string, string>).NODE_ENV = value
}
const env = { ...process.env }

let signingKey: string
beforeAll(async () => {
  signingKey = await generateSigningKey('k1')
})

function federation(withIdentity = true) {
  return defineFederation({
    remotes: { a: { origin: 'https://a.example.com', retries: 0 } },
    onEvent: (event) => events.push(event),
    ...(withIdentity
      ? {
          identity: {
            issuer: 'https://host.example.com',
            signingKeys: signingKey,
          },
        }
      : {}),
  })
}

const okResult = (ms = 0): IslandResult => ({
  ok: true,
  envelope: envelope as never,
  meta: { ms, bytes: 321, attempts: 1 },
})

beforeEach(() => {
  process.env.NF_CACHE_MODEL = 'legacy'
  process.env.NF_BASE_PATH = '/base'
  setNodeEnv('test')
  events = []
  requests = 0
  respond = () => new Response(JSON.stringify(envelope))
  globalThis.fetch = ((url: string, init: RequestInit) => {
    requests++
    seen = { url, headers: init.headers as Record<string, string>, init }
    return Promise.resolve(respond())
  }) as typeof fetch
  rs.mocked(getPublicEnvelope).mockReset()
  rs.mocked(getPublicEnvelope).mockImplementation(async () =>
    markFresh(okResult())
  )
  rs.mocked(cookies).mockReset()
  rs.mocked(cookies).mockResolvedValue({ marker: 'cookies' } as never)
  rs.mocked(headers).mockReset()
  rs.mocked(headers).mockResolvedValue(
    new Headers({ cookie: 'session=secret' }) as never
  )
  rs.mocked(unstable_rethrow).mockClear()
})
afterEach(() => {
  globalThis.fetch = realFetch
  process.env = { ...env }
  rs.restoreAllMocks()
})

test('public island goes through getPublicEnvelope with canonical props and the default revalidate 60', async () => {
  const fed = federation()
  const r = await loadIsland(
    fed,
    {},
    { remote: 'a', island: 'Banner', props: { z: 1, a: { y: 2, b: 3 } } }
  )
  expect(r).toEqual({ kind: 'ok', envelope, token: null })
  expect(getPublicEnvelope).toHaveBeenCalledTimes(1)
  expect(rs.mocked(getPublicEnvelope).mock.calls[0]).toEqual([
    fed.target('a'),
    'Banner',
    '{"a":{"b":3,"y":2},"z":1}',
    '{"basePath":"/base","locale":""}',
    60,
  ])
  expect(requests).toBe(0)
})

test('spec.revalidate overrides the default', async () => {
  await loadIsland(
    federation(),
    {},
    { remote: 'a', island: 'Banner', revalidate: 5, locale: 'fr' }
  )
  const call = rs.mocked(getPublicEnvelope).mock.calls[0]!
  expect(call[2]).toBe('{}')
  expect(call[3]).toBe('{"basePath":"/base","locale":"fr"}')
  expect(call[4]).toBe(5)
})

test('props in a different key order hit the same cache() entry', async () => {
  const load = createIslandLoader(federation(), {})
  const first = load({ remote: 'a', island: 'Banner', props: { x: 1, y: 2 } })
  const second = load({ props: { y: 2, x: 1 }, island: 'Banner', remote: 'a' })
  expect(second).toBe(first)
  await Promise.all([first, second])
  expect(getPublicEnvelope).toHaveBeenCalledTimes(1)
  await load({ remote: 'a', island: 'Banner', props: { x: 2 } })
  expect(getPublicEnvelope).toHaveBeenCalledTimes(2)
})

test('dynamic: true bypasses the cache with cache: "no-store"', async () => {
  const r = await loadIsland(
    federation(),
    {},
    { remote: 'a', island: 'Banner', dynamic: true, props: { n: 1 } }
  )
  expect(r).toMatchObject({ kind: 'ok', token: null })
  expect(getPublicEnvelope).not.toHaveBeenCalled()
  expect(requests).toBe(1)
  expect(seen.init.cache).toBe('no-store')
  expect(seen.headers.authorization).toBeUndefined()
  expect(seen.url).toContain('/_nf/island/Banner')
})

test('private island without getIdentity is NF-013', async () => {
  const spec = { remote: 'a', island: 'MyOrders', private: true }
  await expect(loadIsland(federation(), {}, spec)).rejects.toMatchObject({
    code: 'NF-013',
  })
  await expect(
    loadIsland(federation(false), { getIdentity: () => ({ sub: 'u' }) }, spec)
  ).rejects.toMatchObject({ code: 'NF-013' })
  expect(requests).toBe(0)
})

test('private island, anonymous user: no remote request, kind "anonymous"', async () => {
  const getIdentity = rs.fn<AppIdentity>(async () => null)
  const r = await loadIsland(
    federation(),
    { getIdentity },
    { remote: 'a', island: 'MyOrders', private: true }
  )
  expect(r).toEqual({ kind: 'anonymous' })
  expect(requests).toBe(0)
  // The host's lookup receives the awaited cookies() and headers() values.
  const ctx = getIdentity.mock.calls[0]![0] as {
    cookies: unknown
    headers: Headers
  }
  expect(ctx.cookies).toEqual({ marker: 'cookies' })
  expect(ctx.headers.get('cookie')).toBe('session=secret')
  expect(events).toEqual([])
})

test('private island: Bearer token on the request, no-store, and no token anywhere in the result', async () => {
  const fed = federation()
  const r = await loadIsland(
    fed,
    { getIdentity: () => ({ sub: 'user-1' }) },
    { remote: 'a', island: 'MyOrders', private: true }
  )
  expect(seen.headers.authorization).toMatch(/^Bearer ey/)
  expect(seen.init.cache).toBe('no-store')
  expect(JSON.stringify(r)).not.toContain(seen.headers.authorization!.slice(7))
  expect(r).toMatchObject({
    kind: 'ok',
    token: { endpoint: '/base/api/next-federation/token?aud=a' },
  })
  const key = (r as { token: { identityKey: string } }).token.identityKey
  expect(typeof key).toBe('string')
  expect(key).not.toContain('user-1')
  expect(getPublicEnvelope).not.toHaveBeenCalled()
  // Events never carry the token either.
  expect(JSON.stringify(events)).not.toContain(
    seen.headers.authorization!.slice(7)
  )
})

test('host cookies are never forwarded to the remote', async () => {
  await loadIsland(
    federation(),
    { getIdentity: () => ({ sub: 'user-1' }) },
    { remote: 'a', island: 'MyOrders', private: true }
  )
  const names = Object.keys(seen.headers).map((h) => h.toLowerCase())
  expect(names).not.toContain('cookie')
  expect(JSON.stringify(seen.headers)).not.toContain('session=secret')
  expect(seen.init.credentials).toBe('omit')
})

test('a remote 401 (expired token) is kind "failed"', async () => {
  const error = rs.spyOn(logger, 'error').mockImplementation(() => {})
  respond = () => new Response('expired', { status: 401 })
  const r = await loadIsland(
    federation(),
    { getIdentity: () => ({ sub: 'user-1' }) },
    { remote: 'a', island: 'MyOrders', private: true }
  )
  expect(r).toEqual({ kind: 'failed' })
  expect(events).toMatchObject([
    { type: 'island:error', code: 'NF-007', status: 401 },
  ])
  expect(error).toHaveBeenCalledWith('NF-007', expect.any(String))
})

test('an invalid envelope is kind "failed", emits island:error with NF-004', async () => {
  const error = rs.spyOn(logger, 'error').mockImplementation(() => {})
  // The right protocol version, but not an envelope (no html/bootstrap).
  respond = () =>
    new Response(JSON.stringify({ protocolVersion: 1, remote: 'a' }))
  const r = await loadIsland(
    federation(),
    {},
    { remote: 'a', island: 'Banner', dynamic: true }
  )
  expect(r).toEqual({ kind: 'failed' })
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    type: 'island:error',
    remote: 'a',
    island: 'Banner',
    code: 'NF-004',
    attempts: 1,
  })
  expect(error).toHaveBeenCalledWith('NF-004', expect.any(String))
})

test('a Next control-flow error thrown by cookies() propagates', async () => {
  const dynamicUsage = Object.assign(new Error('Dynamic server usage'), {
    digest: 'DYNAMIC_SERVER_USAGE',
  })
  rs.mocked(cookies).mockRejectedValue(dynamicUsage)
  await expect(
    loadIsland(
      federation(),
      { getIdentity: () => ({ sub: 'user-1' }) },
      { remote: 'a', island: 'MyOrders', private: true }
    )
  ).rejects.toBe(dynamicUsage)
  expect(requests).toBe(0)
})

test('emits island:fetch with ms, bytes, attempts on success', async () => {
  const body = JSON.stringify(envelope)
  await loadIsland(
    federation(),
    {},
    { remote: 'a', island: 'Banner', dynamic: true }
  )
  expect(events).toHaveLength(1)
  const event = events[0]!
  expect(event).toMatchObject({
    type: 'island:fetch',
    remote: 'a',
    island: 'Banner',
    bytes: body.length,
    attempts: 1,
  })
  expect(typeof (event as { ms: number }).ms).toBe('number')
})

test('a cached public result does not re-emit its stored fetch meta', async () => {
  // The island cache marks the run that really fetched; a cache hit returns
  // the stored entry, mark included, which the first caller already took.
  const entry = markFresh(okResult(500))
  rs.mocked(getPublicEnvelope).mockImplementation(async () => entry)
  const fed = federation()
  await loadIsland(fed, {}, { remote: 'a', island: 'Banner' })
  expect(events).toMatchObject([{ type: 'island:fetch', ms: 500, bytes: 321 }])
  const hit = await loadIsland(fed, {}, { remote: 'a', island: 'Banner' })
  expect(hit).toMatchObject({ kind: 'ok' })
  expect(events).toHaveLength(1)
  // An entry filled by another process (or the build) carries an unknown mark.
  rs.mocked(getPublicEnvelope).mockImplementation(async () => ({
    ...okResult(),
    fresh: 'from-elsewhere',
  }))
  await loadIsland(fed, {}, { remote: 'a', island: 'Banner' })
  expect(events).toHaveLength(1)
})

test('never reads the wall clock (Next aborts cacheComponents prerenders on it)', async () => {
  const now = rs.spyOn(Date, 'now').mockImplementation(() => {
    throw new Error('Date.now() during prerender')
  })
  try {
    const fed = federation()
    await expect(
      loadIsland(fed, {}, { remote: 'a', island: 'Banner' })
    ).resolves.toMatchObject({ kind: 'ok' })
    await expect(
      loadIsland(fed, {}, { remote: 'a', island: 'Banner', dynamic: true })
    ).resolves.toMatchObject({ kind: 'ok' })
    expect(now).not.toHaveBeenCalled()
  } finally {
    now.mockRestore()
  }
})

test('in development an envelope over warnBytes warns NF-024 once', async () => {
  setNodeEnv('development')
  const warnOnce = rs.spyOn(logger, 'warnOnce').mockImplementation(() => {})
  const fed = defineFederation({
    remotes: { a: { origin: 'https://a.example.com' } },
    islands: { warnBytes: 100 },
  })
  await loadIsland(fed, {}, { remote: 'a', island: 'Banner' })
  expect(warnOnce).toHaveBeenCalledWith(
    'NF-024',
    'a:Banner',
    expect.stringContaining('321')
  )
  warnOnce.mockClear()
  setNodeEnv('production')
  await loadIsland(fed, {}, { remote: 'a', island: 'Banner' })
  expect(warnOnce).not.toHaveBeenCalled()
})

test('loadIsland without the wrapper env is NF-017', async () => {
  delete process.env.NF_CACHE_MODEL
  delete process.env.NF_BASE_PATH
  await expect(
    loadIsland(federation(), {}, { remote: 'a', island: 'Banner' })
  ).rejects.toMatchObject({ code: 'NF-017' })
  expect(getPublicEnvelope).not.toHaveBeenCalled()
})

test('an unknown remote is NF-001', async () => {
  await expect(
    loadIsland(federation(), {}, { remote: 'nope', island: 'Banner' })
  ).rejects.toMatchObject({ code: 'NF-001' })
})

describe('public islands on a host with getIdentity (Server Actions, D2)', () => {
  test('cached public island gets a null-key token and never reads identity at render', async () => {
    const getIdentity = rs.fn<AppIdentity>(async () => ({ sub: 'user-1' }))
    const r = await loadIsland(
      federation(),
      { getIdentity },
      { remote: 'a', island: 'Banner' }
    )
    expect(r).toEqual({
      kind: 'ok',
      envelope,
      token: {
        endpoint: '/base/api/next-federation/token?aud=a',
        identityKey: null,
      },
    })
    // Static: no identity lookup, no request APIs, no token on the fetch.
    expect(getIdentity).not.toHaveBeenCalled()
    expect(cookies).not.toHaveBeenCalled()
    expect(headers).not.toHaveBeenCalled()
    expect(getPublicEnvelope).toHaveBeenCalledTimes(1)
  })

  test('dynamic public island gets the same null-key token, without a bearer on the fetch', async () => {
    const getIdentity = rs.fn<AppIdentity>(async () => ({ sub: 'user-1' }))
    const r = await loadIsland(
      federation(),
      { getIdentity },
      { remote: 'a', island: 'Banner', dynamic: true }
    )
    expect(r).toMatchObject({
      kind: 'ok',
      token: { identityKey: null },
    })
    expect(seen.headers.authorization).toBeUndefined()
    expect(getIdentity).not.toHaveBeenCalled()
  })

  test('without getIdentity, or without identity config, public islands keep token null', async () => {
    expect(
      await loadIsland(federation(), {}, { remote: 'a', island: 'Banner' })
    ).toMatchObject({ token: null })
    expect(
      await loadIsland(
        federation(false),
        { getIdentity: () => ({ sub: 'u' }) },
        { remote: 'a', island: 'Banner' }
      )
    ).toMatchObject({ token: null })
  })
})

describe('NF-037: `next dev` where React debug info may carry private island values', () => {
  // Next's dev tooling treats code outside node_modules as the app's own, so
  // React's debug info records the values this library awaits (cookies,
  // headers, the identity, the token) and sends them to the browser. The
  // tests import the source, which is such a link.
  const spec = { remote: 'a', island: 'MyOrders', private: true }
  const user = { getIdentity: () => ({ sub: 'user-1' }) }

  test('a private island still renders on the server, with one warning naming the values and limits.md', async () => {
    setNodeEnv('development')
    const warnOnce = rs.spyOn(logger, 'warnOnce').mockImplementation(() => {})
    const fed = federation()
    expect(await loadIsland(fed, user, spec)).toMatchObject({ kind: 'ok' })
    expect(seen.headers.authorization).toMatch(/^Bearer ey/)
    await loadIsland(fed, user, { ...spec, props: { page: 2 } })
    const calls = warnOnce.mock.calls.filter(([code]) => code === 'NF-037')
    expect(calls).toHaveLength(2) // the logger itself keeps it to once
    expect(calls.map(([, key]) => key)).toEqual(['linked', 'linked'])
    const detail = calls[0]![2]!
    for (const word of [
      'outside node_modules',
      '-H 127.0.0.1',
      'token',
      'cookies',
      'headers',
      'getIdentity',
      'docs/guides/limits.md',
    ]) {
      expect(detail).toContain(word)
    }
  })

  test('installed, with source maps off: the warning names that cause', async () => {
    setNodeEnv('development')
    rs.doMock('../src/server/dev-debug-info.ts', () => ({
      devDebugInfoCause: () => 'source-maps-off',
    }))
    rs.resetModules()
    const { loadIsland: load } = await import('../src/server/load-island.ts')
    const sdk = await import('@next-federation/sdk')
    const warnOnce = rs
      .spyOn(sdk.logger, 'warnOnce')
      .mockImplementation(() => {})
    expect(await load(federation(), user, spec)).toMatchObject({ kind: 'ok' })
    const call = warnOnce.mock.calls.find(([code]) => code === 'NF-037')!
    expect(call[1]).toBe('source-maps-off')
    expect(call[2]).toContain('--disable-source-maps')
    expect(call[2]).toContain('docs/guides/limits.md')
    rs.doUnmock('../src/server/dev-debug-info.ts')
    rs.resetModules()
  })

  test('no warning in production, nor for a public island', async () => {
    const warnOnce = rs.spyOn(logger, 'warnOnce').mockImplementation(() => {})
    setNodeEnv('production')
    await loadIsland(federation(), user, spec)
    setNodeEnv('development')
    await loadIsland(federation(), user, { remote: 'a', island: 'Banner' })
    expect(warnOnce.mock.calls.filter(([c]) => c === 'NF-037')).toEqual([])
  })
})
