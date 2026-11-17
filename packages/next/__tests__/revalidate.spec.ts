import { defineFederation } from '@next-federation/core'
import {
  getPublicEnvelope,
  shortenEnclosingCache,
} from '@next-federation/next/island-cache'
import { revalidateTag } from 'next/cache'
import type { ReactElement } from 'react'
import { createIslands } from '../src/server/create-islands.tsx'

rs.mock('next/cache', () => ({ revalidateTag: rs.fn() }))
rs.mock('next/headers', () => ({ cookies: rs.fn(), headers: rs.fn() }))
rs.mock('next/navigation', () => ({ unstable_rethrow: rs.fn() }))
rs.mock('@next-federation/next/island-cache', () => ({
  getPublicEnvelope: rs.fn(),
  shortenEnclosingCache: rs.fn(),
}))

const federation = defineFederation({
  remotes: { a: { origin: 'https://a.example.com' } },
})

beforeEach(() => {
  rs.mocked(revalidateTag).mockClear()
})

test('revalidateIsland("a") → tag nf:a; ("a","Panel") → nf:a:Panel; unknown remote NF-001', () => {
  const { revalidateIsland } = createIslands(federation)
  revalidateIsland('a')
  revalidateIsland('a', 'Panel')
  // Immediate expiry, for deploy webhooks.
  expect(rs.mocked(revalidateTag).mock.calls).toEqual([
    ['nf:a', { expire: 0 }],
    ['nf:a:Panel', { expire: 0 }],
  ])
  expect(() => revalidateIsland('nope')).toThrow(
    expect.objectContaining({ code: 'NF-001' })
  )
  expect(revalidateTag).toHaveBeenCalledTimes(2)
})

test('preloadIsland never leaves an unhandled rejection', async () => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    const { preloadIsland } = createIslands(federation)
    // No wrapper env: the load rejects with NF-017.
    delete process.env.NF_CACHE_MODEL
    expect(preloadIsland({ remote: 'a', island: 'Panel' })).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(unhandled).toEqual([])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('RemoteIsland wraps the loader in its own Suspense boundary', () => {
  process.env.NF_CACHE_MODEL = 'legacy'
  const { RemoteIsland } = createIslands(federation)
  const fallback = 'loading'
  const element = RemoteIsland({
    remote: 'a',
    island: 'Panel',
    props: { n: 1 },
    fallback,
    errorFallback: 'down',
  })
  expect(String(element.type)).toBe('Symbol(react.suspense)')
  const props = element.props as {
    fallback: unknown
    children: { props: Record<string, unknown> }
  }
  expect(props.fallback).toBe('loading')
  expect(props.children.props).toMatchObject({
    spec: { remote: 'a', island: 'Panel', props: { n: 1 } },
    fallback: 'loading',
    errorFallback: 'down',
  })
})

describe('a failed island shortens an enclosing host cache scope', () => {
  // The async loader element inside RemoteIsland's Suspense, rendered by hand.
  async function renderLoader(): Promise<ReactElement> {
    process.env.NF_CACHE_MODEL = 'cache-components'
    const { RemoteIsland } = createIslands(federation)
    const element = RemoteIsland({
      remote: 'a',
      island: 'Panel',
      fallback: 'loading',
      errorFallback: 'down',
    })
    const loader = (element.props as { children: ReactElement }).children
    const render = loader.type as (props: unknown) => Promise<ReactElement>
    return render(loader.props)
  }

  beforeEach(() => {
    rs.mocked(shortenEnclosingCache).mockClear()
  })

  test('failure: shortenEnclosingCache is called and the error fallback renders', async () => {
    rs.mocked(getPublicEnvelope).mockResolvedValueOnce({
      ok: false,
      code: 'NF-007',
      meta: { ms: 1, bytes: 0, attempts: 1 },
    })
    const out = await renderLoader()
    expect(shortenEnclosingCache).toHaveBeenCalledTimes(1)
    expect((out.props as { children: unknown }).children).toBe('down')
  })

  test('success: the enclosing cache scope is left alone', async () => {
    rs.mocked(getPublicEnvelope).mockResolvedValueOnce({
      ok: true,
      envelope: {
        protocolVersion: 1,
        remote: 'a',
        buildId: 'b1',
        mode: 'production',
        html: '<p>hi</p>',
        rscPayload: '0:"x"',
        css: [],
        bootstrap: 'https://a.example.com/boot.js',
        reactVersion: '19.2.0',
        idPlaceholder: 'nfph0',
      },
      meta: { ms: 1, bytes: 10, attempts: 1 },
    })
    await renderLoader()
    expect(shortenEnclosingCache).not.toHaveBeenCalled()
  })
})

describe('RemoteIsland passes inertOnLoadFailure to IslandMount', () => {
  const envelope = {
    protocolVersion: 1,
    remote: 'a',
    buildId: 'b1',
    mode: 'production',
    html: '<p>hi</p>',
    rscPayload: '0:"x"',
    css: [],
    bootstrap: 'https://a.example.com/boot.js',
    reactVersion: '19.2.0',
    idPlaceholder: 'nfph0',
  } as const
  async function mountProps(
    extra: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    process.env.NF_CACHE_MODEL = 'cache-components'
    rs.mocked(getPublicEnvelope).mockResolvedValueOnce({
      ok: true,
      envelope,
      meta: { ms: 1, bytes: 10, attempts: 1 },
    } as never)
    const { RemoteIsland } = createIslands(federation)
    const element = RemoteIsland({
      remote: 'a',
      island: 'Panel',
      fallback: 'loading',
      ...extra,
    })
    const loader = (element.props as { children: ReactElement }).children
    // The option is for the mount, never part of the island spec (the load key).
    expect(
      (loader.props as { spec: Record<string, unknown> }).spec
    ).not.toHaveProperty('inertOnLoadFailure')
    const render = loader.type as (props: unknown) => Promise<ReactElement>
    return (await render(loader.props)).props as Record<string, unknown>
  }

  test.each([
    [{}, true],
    [{ errorFallback: 'down' }, false],
    [{ errorFallback: 'down', inertOnLoadFailure: true }, true],
    [{ inertOnLoadFailure: false }, false],
  ])('%j → inertOnLoadFailure %s', async (extra, expected) => {
    expect(await mountProps(extra)).toMatchObject({
      inertOnLoadFailure: expected,
    })
  })
})
