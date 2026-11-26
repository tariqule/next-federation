// Server-side component events go to the federation that resolved the
// descriptor, by its `events` key (never by remote name).
import { prerender } from 'react-dom/static'
import { componentTrustRegistry } from '@next-federation/protocol'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import { createBindings } from '../src/components/render.tsx'
import type { BindingsRuntime } from '../src/components/render.tsx'
import { createComponentRuntime } from '../src/components/runtime.ts'
import type { FederationInstance } from '../src/components/runtime.ts'
import { serverComponentEmit } from '../src/components/server-events.ts'

const base: RemoteComponentDescriptor = {
  remote: 'cart',
  name: 'cart',
  buildId: 'c1',
  base: 'http://127.0.0.1:4130/b/c1/',
  manifest: 'http://127.0.0.1:4130/b/c1/mf-manifest.json',
  ssr: { integrity: { 'mf-manifest.json': 'sha384-AAAA' } },
  maxBuilds: 5,
}

const got: Record<'A' | 'B', Array<{ type: string }>> = { A: [], B: [] }
const fedA = { emit: (e: object) => got.A.push(e as { type: string }) }
const fedB = { emit: (e: object) => got.B.push(e as { type: string }) }
const routes = (componentTrustRegistry().eventRoutes ??= new Map())
routes.set('test.A', new WeakRef(fedA))
routes.set('test.B', new WeakRef(fedB))

beforeEach(() => {
  rs.spyOn(console, 'error').mockImplementation(() => {})
  rs.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  rs.restoreAllMocks()
})

test('a refused render through federation A and a healthy load through B each reach only their own federation', async () => {
  const runtime: BindingsRuntime = {
    load: () => {
      throw new Error('never loaded')
    },
    serverLoad: () => {
      throw new Error('never loaded')
    },
    serverBlock: () => null,
    serverOutcome: () => ({ kind: 'loaded' }),
    registerShared: () => {},
    refuse: () => {},
    refusedBuild: (d) => d.refused?.code,
  }
  const { createRemoteComponent } = createBindings({
    runtime,
    isServer: true,
    emit: serverComponentEmit,
  })
  const C = createRemoteComponent({ expose: './Cart', errorFallback: <b /> })
  // A copy, as RSC hands it to the render.
  const a = structuredClone({
    ...base,
    refused: { code: 'NF-027' as const },
    events: 'test.A',
  })
  await prerender(<C descriptor={a} />, { onError: () => {} })

  const fakeReact = { useState: () => null, version: '19.3.1' }
  const instance: FederationInstance = {
    registerRemotes() {},
    registerShared() {},
    loadRemote: async () => ({ default: () => null }) as never,
  }
  const serverRuntime = createComponentRuntime({
    isServer: true,
    react: fakeReact,
    hostShared: { react: { version: '19.3.1', module: fakeReact } },
    createInstance: () => instance,
    serverPlugin: () => ({ name: 'test' }),
    canLoadServerCode: () => true,
    isTrusted: () => true,
    emit: serverComponentEmit,
  })
  await serverRuntime.load(
    JSON.parse(JSON.stringify({ ...base, events: 'test.B' })),
    './Cart'
  )
  expect(got.A.map((e) => e.type)).toEqual([
    'component:error',
    'component:fallback',
  ])
  expect(got.B.map((e) => e.type)).toEqual(['component:load'])
})

test('without a route nothing is delivered and nothing throws', async () => {
  got.A.length = 0
  got.B.length = 0
  expect(() =>
    serverComponentEmit(
      {
        type: 'component:fallback',
        remote: 'cart',
        buildId: 'c1',
        expose: './Cart',
        env: 'server',
        phase: 'render',
        reason: 'refused',
      },
      { ...base, events: 'unknown' }
    )
  ).not.toThrow()
  expect(got).toEqual({ A: [], B: [] })
})
