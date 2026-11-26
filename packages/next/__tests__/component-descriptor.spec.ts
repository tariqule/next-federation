import { generateKeyPairSync, sign } from 'node:crypto'
import { defineFederation } from '@next-federation/core'
import type { ComponentTarget } from '@next-federation/core'
import {
  canonicalJson,
  componentDescriptorDigest,
  componentTrustRegistry,
} from '@next-federation/protocol'
import type { ComponentBuildDescriptor } from '@next-federation/protocol'
import { cacheLife, cacheTag } from 'next/cache'
import { resolveComponentDescriptor } from '../src/server/component-descriptor.ts'
import { getDescriptorFile as legacyGet } from '../src/server/island-cache.legacy.ts'
import { getDescriptorFile as ccGet } from '../src/server/island-cache.cc.ts'

rs.mock('next/cache', () => ({ cacheLife: rs.fn(), cacheTag: rs.fn() }))
// Unit tests resolve package subpaths to their `default` (browser) export,
// whose canLoadServerCode is always false; this spec runs on Node, so it
// takes the Node loader's check (process.getBuiltinModule).
rs.mock('@next-federation/react/components/server-loader', () => ({
  canLoadServerCode: () =>
    typeof (globalThis as { process?: { getBuiltinModule?: unknown } }).process
      ?.getBuiltinModule === 'function',
}))

const ORIGIN = 'http://127.0.0.1:4110'
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pub: Record<string, string> = {
  ...(privateKey.export({ format: 'jwk' }) as Record<string, string>),
  kid: 'k1',
}
delete pub.d
const b64url = (data: string | Buffer) =>
  Buffer.from(data).toString('base64url')

/** A compact ES256 JWS, by hand (node:crypto, P1363 signature). */
function compactJws(payloadText: string): string {
  const header = b64url(
    JSON.stringify({ alg: 'ES256', kid: 'k1', typ: 'nf-components+jws' })
  )
  const input = `${header}.${b64url(payloadText)}`
  const signature = sign('sha256', Buffer.from(input), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  })
  return `${input}.${b64url(signature)}`
}

function payload(buildId: string): ComponentBuildDescriptor {
  const base = `${ORIGIN}/b/${buildId}/`
  return {
    v: 1,
    name: 'components',
    buildId,
    base,
    manifest: `${base}mf-manifest.json`,
    ssr: { integrity: { 'mf-manifest.json': 'sha384-AAAA' } },
  }
}

async function signedFile(buildId: string, sign = true) {
  const p = payload(buildId)
  const digest = await componentDescriptorDigest(p)
  if (!sign) return { ...p, digest }
  return { ...p, digest, jws: compactJws(canonicalJson(p)) }
}

const events: unknown[] = []
const federation = defineFederation({
  remotes: {
    components: {
      origin: ORIGIN,
      components: { ssr: { publicKeys: [pub as never] }, revalidate: 7 },
    },
  },
  onEvent: (e) => events.push(e),
})
const target: ComponentTarget = federation.componentTarget('components')

type Call = [string, RequestInit & { next?: unknown }]
let calls: Call[] = []
let respond: () => Response | Promise<Response>
const realFetch = globalThis.fetch

beforeEach(() => {
  calls = []
  events.length = 0
  globalThis.fetch = ((url: string, init: RequestInit) => {
    calls.push([url, init])
    return Promise.resolve(respond())
  }) as typeof fetch
  rs.mocked(cacheLife).mockClear()
  rs.mocked(cacheTag).mockClear()
})
afterEach(() => {
  globalThis.fetch = realFetch
  rs.restoreAllMocks()
})

test('legacy: the descriptor fetch uses next.revalidate and the remote tag', async () => {
  const file = await signedFile('c1')
  respond = () => new Response(JSON.stringify(file))
  const result = await legacyGet(target)
  expect(result.ok).toBe(true)
  expect(calls[0]![0]).toBe(`${ORIGIN}/_nf/components.json`)
  expect(calls[0]![1].next).toEqual({ revalidate: 7, tags: ['nf:components'] })
})

test("cacheComponents: 'use cache' with cacheLife >= the revalidate, a failure is retried soon but stays in the static shell", async () => {
  respond = async () => new Response(JSON.stringify(await signedFile('c1')))
  expect((await ccGet(target)).ok).toBe(true)
  expect(cacheLife).toHaveBeenCalledWith({
    stale: 300,
    revalidate: 7,
    expire: 3600,
  })
  expect(cacheTag).toHaveBeenCalledWith('nf:components')
  expect(calls[0]![1].next).toBeUndefined()
  respond = () => new Response('down', { status: 503 })
  expect((await ccGet(target)).ok).toBe(false)
  // expire >= 300 s: Next keeps it in the static shell (no dynamic hole,
  // which would stop the page from ever regenerating).
  expect(cacheLife).toHaveBeenLastCalledWith({
    stale: 30,
    revalidate: 5,
    expire: 600,
  })
})

test('a verified descriptor keeps SSR and is reported', async () => {
  const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
  respond = async () => new Response(JSON.stringify(await signedFile('c1')))
  const descriptor = await resolveComponentDescriptor(
    federation,
    'components',
    {
      get: legacyGet,
    }
  )
  expect(descriptor).toMatchObject({
    remote: 'components',
    buildId: 'c1',
    ssr: payload('c1').ssr,
  })
  expect(events).toEqual([
    expect.objectContaining({
      type: 'component:descriptor',
      remote: 'components',
      buildId: 'c1',
      ssr: true,
    }),
  ])
  expect(warn).not.toHaveBeenCalled()
})

test('an unsigned build renders browser-only with a warning once per build', async () => {
  const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
  respond = async () =>
    new Response(JSON.stringify(await signedFile('u1', false)))
  for (let i = 0; i < 3; i++) {
    const d = await resolveComponentDescriptor(federation, 'components', {
      get: legacyGet,
    })
    expect(d?.ssr).toBeNull()
  }
  expect(warn).toHaveBeenCalledTimes(1)
  expect(String(warn.mock.calls[0]!.join(' '))).toMatch(/NF-028.*u1/)
})

test('remote down: the last known descriptor is kept; never fetched -> null', async () => {
  const error = rs.spyOn(console, 'error').mockImplementation(() => {})
  const fresh = defineFederation({
    remotes: { other: { origin: ORIGIN, components: { ssr: false } } },
  })
  respond = () => new Response('down', { status: 503 })
  expect(
    await resolveComponentDescriptor(fresh, 'other', { get: legacyGet })
  ).toBeNull()
  respond = async () =>
    new Response(JSON.stringify(await signedFile('k1', false)))
  const up = await resolveComponentDescriptor(fresh, 'other', {
    get: legacyGet,
  })
  expect(up?.buildId).toBe('k1')
  respond = () => {
    throw new TypeError('fetch failed')
  }
  const down = await resolveComponentDescriptor(fresh, 'other', {
    get: legacyGet,
  })
  expect(down).toEqual(up)
  expect(error).toHaveBeenCalled()
})

test('dynamic descriptors are fetched with no-store', async () => {
  respond = async () => new Response(JSON.stringify(await signedFile('c1')))
  await resolveComponentDescriptor(federation, 'components', {
    get: legacyGet,
    dynamic: true,
  })
  expect(calls[0]![1]).toMatchObject({ cache: 'no-store' })
})

test('without process.getBuiltinModule (Node < 20.16) SSR is off, warned once', async () => {
  const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
  const proc = process as { getBuiltinModule?: unknown }
  const saved = proc.getBuiltinModule
  proc.getBuiltinModule = undefined
  try {
    respond = async () => new Response(JSON.stringify(await signedFile('n1')))
    for (let i = 0; i < 2; i++) {
      const d = await resolveComponentDescriptor(federation, 'components', {
        get: legacyGet,
      })
      expect(d?.ssr).toBeNull()
    }
  } finally {
    proc.getBuiltinModule = saved
  }
  const lines = warn.mock.calls.map((c) => c.join(' '))
  expect(lines.filter((l) => /NF-028.*20\.16/.test(l))).toHaveLength(1)
})

test('a build this process refused comes back marked `refused`; other builds do not', async () => {
  rs.spyOn(console, 'warn').mockImplementation(() => {})
  respond = async () => new Response(JSON.stringify(await signedFile('c1')))
  const plain = await resolveComponentDescriptor(federation, 'components', {
    get: legacyGet,
  })
  expect(plain?.refused).toBeUndefined()
  const registry = componentTrustRegistry()
  const refusedBuilds = new Map([[payload('c1').base, 'NF-036' as const]])
  ;(registry.refusedBuilds ??= new Map()).set('components', refusedBuilds)
  try {
    const marked = await resolveComponentDescriptor(federation, 'components', {
      get: legacyGet,
    })
    expect(marked).toMatchObject({
      buildId: 'c1',
      ssr: payload('c1').ssr,
      refused: { code: 'NF-036' },
    })
    // The verified descriptor itself is not changed (nor the last known one).
    expect(plain?.refused).toBeUndefined()
  } finally {
    refusedBuilds.delete(payload('c1').base)
  }
})
