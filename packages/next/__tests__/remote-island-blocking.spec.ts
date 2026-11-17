import { defineFederation } from '@next-federation/core'
import { generateSigningKey } from '@next-federation/core/identity'
import { shortenEnclosingCache } from '@next-federation/next/island-cache'
import { cookies, headers } from 'next/headers'
import type { ReactElement } from 'react'
import { createIslands } from '../src/server/create-islands.tsx'
import type { RemoteIslandProps } from '../src/server/create-islands.tsx'

rs.mock('next/cache', () => ({ revalidateTag: rs.fn() }))
rs.mock('next/headers', () => ({ cookies: rs.fn(), headers: rs.fn() }))
rs.mock('next/navigation', () => ({ unstable_rethrow: rs.fn() }))
rs.mock('@next-federation/next/island-cache', () => ({
  getPublicEnvelope: rs.fn(),
  shortenEnclosingCache: rs.fn(),
}))

const envelope = {
  protocolVersion: 1,
  remote: 'a',
  buildId: 'b1',
  mode: 'production',
  html: '<p>orders</p>',
  rscPayload: '0:"x"',
  css: [],
  bootstrap: 'https://a.example.com/boot.js',
  reactVersion: '19.2.0',
  idPlaceholder: 'nfph0',
}

let signingKey: string
let user: string | null
let respond: () => Promise<Response>
const realFetch = globalThis.fetch
const env = { ...process.env }

beforeAll(async () => {
  signingKey = await generateSigningKey('k1')
})

beforeEach(() => {
  process.env.NF_CACHE_MODEL = 'cache-components'
  user = 'user-1'
  respond = () => Promise.resolve(new Response(JSON.stringify(envelope)))
  globalThis.fetch = (() => respond()) as typeof fetch
  rs.mocked(cookies).mockResolvedValue({} as never)
  rs.mocked(headers).mockResolvedValue(new Headers() as never)
  rs.mocked(shortenEnclosingCache).mockClear()
})
afterEach(() => {
  globalThis.fetch = realFetch
  process.env = { ...env }
})

function islands() {
  const federation = defineFederation({
    remotes: { a: { origin: 'https://a.example.com', retries: 0 } },
    identity: { issuer: 'https://host.example.com', signingKeys: signingKey },
  })
  return createIslands(federation, {
    getIdentity: () => (user ? { sub: user } : null),
  })
}

const PRIVATE: RemoteIslandProps = {
  remote: 'a',
  island: 'MyOrders',
  private: true,
  fallback: 'loading',
  errorFallback: 'down',
}

/** Renders the async loader element the way React would (one level). */
async function render(element: ReactElement): Promise<ReactElement> {
  const run = element.type as (props: unknown) => Promise<ReactElement>
  return run(element.props)
}

test('blocking private island: no Suspense of its own, the loader renders in place', () => {
  const element = islands().RemoteIsland({ ...PRIVATE, blocking: true })
  expect(typeof element.type).toBe('function')
  expect(String(element.type)).not.toBe('Symbol(react.suspense)')
  const props = element.props as Record<string, unknown>
  expect(props).toMatchObject({
    spec: { remote: 'a', island: 'MyOrders', private: true },
    fallback: 'loading',
    errorFallback: 'down',
  })
  // Not part of the island spec (the load key): a preload with the same
  // spec shares the load.
  expect(props.spec).not.toHaveProperty('blocking')
})

test('blocking={false} keeps the Suspense boundary (the default)', () => {
  for (const blocking of [false, undefined]) {
    const element = islands().RemoteIsland({ ...PRIVATE, blocking })
    expect(String(element.type)).toBe('Symbol(react.suspense)')
    const loader = (element.props as { children: ReactElement }).children
    expect(
      (loader.props as { spec: Record<string, unknown> }).spec
    ).not.toHaveProperty('blocking')
  }
})

test('blocking on a public island is NF-002', () => {
  const { RemoteIsland } = islands()
  expect(() =>
    RemoteIsland({ remote: 'a', island: 'Banner', blocking: true })
  ).toThrow(expect.objectContaining({ code: 'NF-002' }))
  expect(() =>
    RemoteIsland({
      remote: 'a',
      island: 'Banner',
      blocking: true,
      dynamic: true,
    })
  ).toThrow(/private/)
})

test('blocking: the signed-in island renders the mount in place', async () => {
  const out = await render(
    islands().RemoteIsland({ ...PRIVATE, blocking: true })
  )
  const props = out.props as Record<string, unknown>
  expect(props.envelope).toEqual(envelope)
  // The browser gets the endpoint only, never a token.
  expect(JSON.stringify(props)).not.toMatch(/eyJ/)
  expect(props.errorFallback).toBe('down')
})

test.each([
  [
    'the remote fails',
    () => Promise.resolve(new Response('no', { status: 500 })),
  ],
  [
    'the remote is unreachable',
    () => Promise.reject(new TypeError('fetch failed')),
  ],
])('blocking: %s → errorFallback in place, nothing thrown', async (_, fail) => {
  respond = fail
  const out = await render(
    islands().RemoteIsland({ ...PRIVATE, blocking: true })
  )
  expect((out.props as { children: unknown }).children).toBe('down')
})

test('blocking: an anonymous visitor gets errorFallback (or fallback) in place', async () => {
  user = null
  const out = await render(
    islands().RemoteIsland({ ...PRIVATE, blocking: true })
  )
  expect((out.props as { children: unknown }).children).toBe('down')
  const noError = await render(
    islands().RemoteIsland({
      ...PRIVATE,
      errorFallback: undefined,
      blocking: true,
    })
  )
  expect((noError.props as { children: unknown }).children).toBe('loading')
})
