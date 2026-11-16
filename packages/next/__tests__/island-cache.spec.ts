import type { IslandTarget } from '@next-federation/core'
import { cacheLife, cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'
import {
  getPublicEnvelope as legacyGet,
  shortenEnclosingCache as legacyShorten,
} from '../src/server/island-cache.legacy.ts'
import {
  getPublicEnvelope as ccGet,
  shortenEnclosingCache as ccShorten,
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
// Next 16's built-in 'seconds' values, inlined so a host cannot redefine them.
const FAILURE_LIFE = { stale: 30, revalidate: 1, expire: 60 }

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

test('both implementations mark the result of the run that fetched, once', async () => {
  const { takeFresh } = await import('../src/server/fresh-mark.ts')
  for (const get of [legacyGet, ccGet]) {
    const r = await get(target, 'Banner', '{}', '{}', 60)
    expect(typeof r.fresh).toBe('string')
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
