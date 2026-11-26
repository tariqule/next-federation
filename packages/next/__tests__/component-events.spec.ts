// Server-side component events reach the `onEvent` of the federation that
// resolved the descriptor: by an opaque key carried on the descriptor (never
// by remote name), so a cached, copied or serialised descriptor routes too.
import { defineFederation } from '@next-federation/core'
import type { FederationEvent } from '@next-federation/core'
import {
  componentDescriptorDigest,
  componentTrustRegistry,
  parseComponentDescriptorFile,
  routeComponentEvent,
} from '@next-federation/protocol'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import { resolveComponentDescriptor } from '../src/server/component-descriptor.ts'
import { getDescriptorFile as legacyGet } from '../src/server/island-cache.legacy.ts'

rs.mock('next/cache', () => ({ cacheLife: rs.fn(), cacheTag: rs.fn() }))
rs.mock('@next-federation/react/components/server-loader', () => ({
  canLoadServerCode: () => true,
}))

const ORIGIN_A = 'http://127.0.0.1:4120'
const ORIGIN_B = 'http://127.0.0.1:4121'

async function file(origin: string, buildId: string) {
  const base = `${origin}/b/${buildId}/`
  const p = {
    v: 1 as const,
    name: 'components',
    buildId,
    base,
    manifest: `${base}mf-manifest.json`,
    ssr: null,
  }
  return { ...p, digest: await componentDescriptorDigest(p) }
}

const eventsA: FederationEvent[] = []
const eventsB: FederationEvent[] = []
// The same remote name in both federations.
const fedA = defineFederation({
  remotes: { cart: { origin: ORIGIN_A, components: { ssr: false } } },
  onEvent: (e) => eventsA.push(e),
})
const fedB = defineFederation({
  remotes: { cart: { origin: ORIGIN_B, components: { ssr: false } } },
  onEvent: (e) => eventsB.push(e),
})

const realFetch = globalThis.fetch
beforeEach(() => {
  eventsA.length = 0
  eventsB.length = 0
  globalThis.fetch = (async (url: string) =>
    new Response(
      JSON.stringify(
        await file(url.startsWith(ORIGIN_A) ? ORIGIN_A : ORIGIN_B, 'c1')
      )
    )) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

const resolve = async (fed: typeof fedA) =>
  (await resolveComponentDescriptor(fed, 'cart', {
    get: legacyGet,
  })) as RemoteComponentDescriptor

/** What the server runtime emits for a refused build (render.tsx). */
function refusedEvents(d: RemoteComponentDescriptor) {
  routeComponentEvent(d, {
    type: 'component:error',
    remote: d.remote,
    buildId: d.buildId,
    expose: './Cart',
    code: 'NF-027',
    error: new Error('refused'),
    env: 'server',
    phase: 'render',
    outcome: 'refused',
  })
  routeComponentEvent(d, {
    type: 'component:fallback',
    remote: d.remote,
    buildId: d.buildId,
    expose: './Cart',
    env: 'server',
    phase: 'render',
    reason: 'refused',
    code: 'NF-027',
  })
}

function loadEvent(d: RemoteComponentDescriptor) {
  routeComponentEvent(d, {
    type: 'component:load',
    remote: d.remote,
    buildId: d.buildId,
    expose: './Cart',
    ms: 1,
    env: 'server',
    phase: 'load',
    outcome: 'ready',
  })
}

const types = (events: FederationEvent[]) =>
  events.map((e) => e.type).filter((t) => t !== 'component:descriptor')

test('two federations with the same remote name each receive only their own component events', async () => {
  const a = await resolve(fedA)
  const b = await resolve(fedB)
  expect(a.events).toEqual(expect.any(String))
  expect(b.events).toEqual(expect.any(String))
  expect(a.events).not.toBe(b.events)
  refusedEvents(a)
  loadEvent(b)
  expect(types(eventsA)).toEqual(['component:error', 'component:fallback'])
  expect(types(eventsB)).toEqual(['component:load'])
})

test('a cached descriptor reused across requests still routes to its own federation', async () => {
  const cached = await resolve(fedA)
  await resolve(fedB)
  // Later requests reuse the same object.
  loadEvent(cached)
  loadEvent(cached)
  expect(types(eventsA)).toEqual(['component:load', 'component:load'])
  expect(types(eventsB)).toEqual([])
})

test('a copied descriptor (structuredClone and JSON round trip, as Pages props and RSC do) still routes correctly', async () => {
  const a = await resolve(fedA)
  const b = await resolve(fedB)
  refusedEvents(structuredClone(a))
  loadEvent(JSON.parse(JSON.stringify(b)) as RemoteComponentDescriptor)
  loadEvent({ ...b })
  expect(types(eventsA)).toEqual(['component:error', 'component:fallback'])
  expect(types(eventsB)).toEqual(['component:load', 'component:load'])
})

test('no function or callback reference appears in JSON.stringify(descriptor)', async () => {
  const a = await resolve(fedA)
  for (const value of Object.values(a)) {
    expect(typeof value).not.toBe('function')
  }
  const json = JSON.stringify(a)
  expect(json).not.toMatch(/onEvent|emit|=>|function/)
  expect(JSON.parse(json)).toEqual(a)
})

test('an unknown or missing key keeps today’s behaviour: nothing is routed', async () => {
  const a = await resolve(fedA)
  expect(routeComponentEvent({ ...a, events: 'nope' }, { type: 'x' })).toBe(
    false
  )
  const bare: Partial<RemoteComponentDescriptor> = { ...a }
  delete bare.events
  expect(routeComponentEvent(bare as { events?: string }, { type: 'x' })).toBe(
    false
  )
  expect(types(eventsA)).toEqual([])
  expect(types(eventsB)).toEqual([])
})

test('the `events` key is outside the signed payload: same digest, dropped by the file parser, not in the trust registry keys', async () => {
  const f = await file(ORIGIN_A, 'c1')
  const { digest, ...p } = f
  expect(await componentDescriptorDigest({ ...p, events: 'k' } as never)).toBe(
    digest
  )
  expect(parseComponentDescriptorFile({ ...f, events: 'k' })).toEqual(f)
  const a = await resolve(fedA)
  for (const key of componentTrustRegistry().verified.keys()) {
    expect(key).not.toContain(a.events!)
  }
})
