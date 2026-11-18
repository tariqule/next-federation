import type { IslandTarget } from '@next-federation/core'
import { cacheLife, cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'
import { componentTrustRegistry } from '@next-federation/protocol'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import { logger } from '@next-federation/sdk'
import {
  getPublicEnvelope as legacyGet,
  shortenEnclosingCache as legacyShorten,
  skipStaticShellUntilReady as legacySkip,
} from '../src/server/island-cache.legacy.ts'
import {
  getPublicEnvelope as ccGet,
  shortenEnclosingCache as ccShorten,
  skipStaticShellUntilReady as ccSkip,
} from '../src/server/island-cache.cc.ts'

rs.mock('next/cache', () => ({ cacheLife: rs.fn(), cacheTag: rs.fn() }))

const target: IslandTarget = {
  remote: 'shop',
  origin: 'https://shop.example.com',
  allowedOrigins: ['https://shop.example.com'],
  timeoutMs: 3000,
  retries: 0,
}

const envelope = {
  protocolVersion: 1,
  remote: 'shop',
  buildId: 'b1',
  mode: 'production',
  html: '<p>hi</p>',
  rscPayload: '0:"x"',
  css: ['https://shop.example.com/a.css'],
  bootstrap: 'https://shop.example.com/boot.js',
  reactVersion: '19.2.0',
  idPlaceholder: 'nfph0',
}

type Call = [string, RequestInit & { next?: unknown }]
let calls: Call[] = []
let respond: () => Response | Promise<Response>
const realFetch = globalThis.fetch
// A failed island: retried within 5 s, yet still part of the static shell.
// Next 16 leaves an entry out of a static prerender (a dynamic hole) when its
// `revalidate` is 0 or its `expire` is under 300 s; a static shell whose only
// changing content is such a hole gets `revalidate: false` and is never
// regenerated again (B1). Inline, so a host cannot redefine it in next.config.
const FAILURE_LIFE = { stale: 30, revalidate: 5, expire: 600 }
// Next's prerender thresholds (next/dist/server/use-cache/constants.js).
const MIN_PRERENDERABLE_EXPIRE = 300
// NF-039 only: a render deliberately left out of the static shell (Next's
// 'seconds' values, inlined).
const DEFER_LIFE = { stale: 30, revalidate: 1, expire: 60 }

beforeEach(() => {
  calls = []
  respond = () => new Response(JSON.stringify(envelope))
  globalThis.fetch = ((url: string, init: RequestInit) => {
    calls.push([url, init])
    return Promise.resolve(respond())
  }) as typeof fetch
  rs.mocked(cacheLife).mockClear()
  rs.mocked(cacheTag).mockClear()
})
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('legacy', () => {
  test('legacy getPublicEnvelope passes revalidate and both tags to fetch', async () => {
    const r = await legacyGet(
      target,
      'Banner',
      '{"text":"hi"}',
      '{"basePath":"/b","locale":""}',
      120
    )
    expect(r.ok).toBe(true)
    expect(calls).toHaveLength(1)
    const [url, init] = calls[0]!
    expect(init.next).toEqual({
      revalidate: 120,
      tags: ['nf:shop', 'nf:shop:Banner'],
    })
    // Props and host context reach the request.
    expect(url).toContain('/_nf/island/Banner')
    expect(decodeURIComponent(url)).not.toContain('{"text":"hi"}')
    expect(init.credentials).toBe('omit')
  })

  test("legacy: `at` is when the envelope was fetched (the response's Date), not this render: a fetch-cache hit keeps its age", async () => {
    // Next's fetch cache replays the stored response, Date header included.
    const fetchedAt = Math.floor(Date.now() / 1000) * 1000 - 90_000
    respond = () =>
      new Response(JSON.stringify(envelope), {
        headers: { date: new Date(fetchedAt).toUTCString() },
      })
    const r = await legacyGet(target, 'Banner', '{}', '{}', 60)
    expect(r.ok).toBe(true)
    expect(r.at).toBe(fetchedAt)
  })

  test('legacy: without a usable Date header (missing, invalid, in the future) `at` is now', async () => {
    for (const date of [
      undefined,
      'not a date',
      new Date(Date.now() + 600_000).toUTCString(),
    ]) {
      respond = () =>
        new Response(JSON.stringify(envelope), {
          headers: date === undefined ? {} : { date },
        })
      const before = Date.now()
      const r = await legacyGet(target, 'Banner', '{}', '{}', 60)
      expect(r.at).toBeGreaterThanOrEqual(before)
      expect(r.at).toBeLessThanOrEqual(Date.now())
    }
  })

  test('legacy returns the failure result for a remote error', async () => {
    respond = () => new Response('nope', { status: 500 })
    const r = await legacyGet(target, 'Banner', '{}', '{}', 60)
    expect(r).toMatchObject({ ok: false, code: 'NF-007', status: 500 })
  })
})

describe('cache-components', () => {
  test('cc: a successful result is returned with cacheLife and both tags', async () => {
    const r = await ccGet(target, 'Banner', '{"text":"hi"}', '{}', 60)
    expect(r.ok).toBe(true)
    expect(cacheLife).toHaveBeenCalledWith({
      stale: 300,
      revalidate: 60,
      expire: 3600,
    })
    expect(cacheTag).toHaveBeenCalledWith('nf:shop', 'nf:shop:Banner')
    // No Next fetch-cache options inside 'use cache'.
    expect(calls[0]![1].next).toBeUndefined()
  })

  test('cc: expire is at least twice revalidate', async () => {
    await ccGet(target, 'Banner', '{}', '{}', 5000)
    expect(cacheLife).toHaveBeenCalledWith({
      stale: 300,
      revalidate: 5000,
      expire: 10000,
    })
  })

  test('cc: the failure profile keeps the page static: a non-zero revalidate and an expire Next prerenders', () => {
    expect(FAILURE_LIFE.revalidate).toBeGreaterThan(0)
    expect(FAILURE_LIFE.expire).toBeGreaterThanOrEqual(
      2 * MIN_PRERENDERABLE_EXPIRE
    )
  })

  test('cc: a failed result is returned, not thrown, under the inline short failure profile', async () => {
    respond = () => new Response('nope', { status: 503 })
    const r = await ccGet(target, 'Banner', '{}', '{}', 60)
    expect(r).toMatchObject({ ok: false, code: 'NF-007', status: 503 })
    expect(cacheLife).toHaveBeenCalledTimes(2)
    expect(cacheLife).toHaveBeenLastCalledWith(FAILURE_LIFE)
    // Never the named profile: next.config `cacheLife.seconds` could redefine it.
    expect(cacheLife).not.toHaveBeenCalledWith('seconds')
    expect(cacheTag).toHaveBeenCalledWith('nf:shop', 'nf:shop:Banner')
  })

  test('cc: a network failure is NF-007 under the inline failure profile', async () => {
    respond = () => {
      throw new TypeError('fetch failed')
    }
    const r = await ccGet(target, 'Banner', '{}', '{}', 60)
    expect(r).toMatchObject({ ok: false, code: 'NF-007' })
    expect(cacheLife).toHaveBeenLastCalledWith(FAILURE_LIFE)
  })

  test('cc: success never selects the failure profile', async () => {
    await ccGet(target, 'Banner', '{}', '{}', 60)
    expect(cacheLife).toHaveBeenCalledTimes(1)
    expect(cacheLife).not.toHaveBeenCalledWith(FAILURE_LIFE)
  })

  test('cc: an envelope for another remote resolves to its specific failure (NF-004)', async () => {
    respond = () =>
      new Response(JSON.stringify({ ...envelope, remote: 'other' }))
    const r = await ccGet(target, 'Banner', '{}', '{}', 60)
    expect(r).toMatchObject({ ok: false, code: 'NF-004' })
    expect(cacheLife).toHaveBeenLastCalledWith(FAILURE_LIFE)
  })

  test('cc: Next control-flow errors propagate, not turned into failures', async () => {
    const flow = Object.assign(new Error('postpone'), { nextControlFlow: true })
    respond = () => {
      throw flow
    }
    await expect(ccGet(target, 'Banner', '{}', '{}', 60)).rejects.toBe(flow)
  })
})

test('both implementations mark the result of the run that fetched, once, with the time it ran', async () => {
  const { takeFresh } = await import('../src/server/fresh-mark.ts')
  for (const get of [legacyGet, ccGet]) {
    const before = Date.now()
    const r = await get(target, 'Banner', '{}', '{}', 60)
    expect(typeof r.fresh).toBe('string')
    // Read inside the cached function (the caller never reads the clock):
    // bounds how long a last good envelope may stand in for a failure.
    expect(r.at).toBeGreaterThanOrEqual(before)
    expect(r.at).toBeLessThanOrEqual(Date.now())
    expect(takeFresh(r)).toBe(true)
    // A cache hit hands back the same stored mark: no longer fresh.
    expect(takeFresh(r)).toBe(false)
  }
})

describe('shortenEnclosingCache', () => {
  test("cc: applies the inline failure profile to the enclosing 'use cache' scope", () => {
    ccShorten()
    expect(cacheLife).toHaveBeenCalledTimes(1)
    expect(cacheLife).toHaveBeenCalledWith(FAILURE_LIFE)
  })

  test("cc: outside a 'use cache' scope (cacheLife throws) it is a no-op", () => {
    rs.mocked(cacheLife).mockImplementationOnce(() => {
      throw new Error('cacheLife() can only be called inside a "use cache"')
    })
    expect(() => ccShorten()).not.toThrow()
  })

  test('cc: a Next control-flow error from cacheLife is rethrown, not swallowed', () => {
    // A real control-flow error (its digest is what unstable_rethrow checks).
    let flow: unknown
    try {
      notFound()
    } catch (error) {
      flow = error
    }
    rs.mocked(cacheLife).mockImplementationOnce(() => {
      throw flow
    })
    expect(() => ccShorten()).toThrow(flow as Error)
  })

  test('legacy: does nothing', () => {
    legacyShorten()
    expect(cacheLife).not.toHaveBeenCalled()
  })
})

describe('skipStaticShellUntilReady (remote components on a static cacheComponents page)', () => {
  const base = 'https://widgets.example.com/b/b1/'
  const d = (ssr = true) =>
    ({
      remote: 'widgets',
      name: 'widgets',
      buildId: 'b1',
      base,
      manifest: `${base}mf-manifest.json`,
      ssr: ssr ? { integrity: {} } : null,
      maxBuilds: 5,
    }) as unknown as RemoteComponentDescriptor
  const env = { ...process.env }
  const setEnv = (values: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) delete (process.env as Record<string, string>)[k]
      else (process.env as Record<string, string>)[k] = v
    }
  }
  beforeEach(() => {
    componentTrustRegistry().serverReady?.clear()
    setEnv({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-server' })
  })
  afterEach(() => {
    process.env = { ...env }
    rs.restoreAllMocks()
  })

  test('cc, next start: a build the server has not loaded yet keeps this render out of the static shell, and says so', async () => {
    const warn = rs.spyOn(logger, 'warnOnce').mockImplementation(() => {})
    // Not inside a host 'use cache' scope: cacheLife() throws there.
    rs.mocked(cacheLife).mockImplementationOnce(() => {
      throw new Error('cacheLife() can only be called inside a "use cache"')
    })
    await ccSkip(d())
    // A deliberate dynamic hole (the page's descriptor entries stay in the
    // shell, so the page still regenerates), not the failure profile: the
    // only cacheLife() that applies is the hole's own.
    expect(cacheLife).toHaveBeenLastCalledWith(DEFER_LIFE)
    const applied = rs
      .mocked(cacheLife)
      .mock.calls.filter(
        (_, i) => rs.mocked(cacheLife).mock.results[i]!.type !== 'throw'
      )
    expect(applied).toEqual([[DEFER_LIFE]])
    expect(warn).toHaveBeenCalledWith(
      'NF-039',
      `not-loaded:${base}`,
      expect.stringMatching(/not loaded in this server process yet/)
    )
    expect(warn.mock.calls.map((c) => c[0])).not.toContain('NF-028')
  })

  test("cc: inside the host's own 'use cache' scope, that scope gets the failure profile, never a hole (it would take the descriptor out of the shell)", async () => {
    // A host component with 'use cache' that reads the descriptor: a
    // short-lived life there would make the whole scope (descriptor entry
    // included) a dynamic hole, and a shell left without a revalidating entry
    // gets `revalidate: false`, stuck as a partial prerender. The failure
    // profile keeps that scope in the shell, retried within seconds.
    const warn = rs.spyOn(logger, 'warnOnce').mockImplementation(() => {})
    await ccSkip(d())
    expect(cacheLife).toHaveBeenCalledWith(FAILURE_LIFE)
    expect(cacheLife).not.toHaveBeenCalledWith(DEFER_LIFE)
    for (const [life] of rs.mocked(cacheLife).mock.calls) {
      expect((life as { expire: number }).expire).toBeGreaterThanOrEqual(
        2 * MIN_PRERENDERABLE_EXPIRE
      )
    }
    expect(warn).toHaveBeenCalledWith(
      'NF-039',
      `not-loaded:${base}`,
      expect.stringMatching(/not loaded in this server process yet/)
    )
  })

  test('cc: a loaded or refused build, a browser-only descriptor, the build and dev do nothing', async () => {
    rs.spyOn(logger, 'warnOnce').mockImplementation(() => {})
    const registry = componentTrustRegistry()
    registry.serverReady ??= new Map()
    registry.serverReady.set(base, 'loaded')
    await ccSkip(d())
    registry.serverReady.set(base, 'refused')
    await ccSkip(d())
    registry.serverReady.clear()
    await ccSkip(d(false))
    await ccSkip(null)
    setEnv({ NEXT_PHASE: 'phase-production-build' })
    await ccSkip(d())
    setEnv({ NODE_ENV: 'development', NEXT_PHASE: undefined })
    await ccSkip(d())
    expect(cacheLife).not.toHaveBeenCalled()
  })

  test('legacy: does nothing (a static render waits for every boundary)', async () => {
    await legacySkip(d())
    expect(cacheLife).not.toHaveBeenCalled()
  })
})
