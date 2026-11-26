// Lifecycle events of remote components: `phase` and `outcome` on
// component:load and component:error, and component:fallback, fired only when
// a degraded tree (refused, browser-only on the server, a render error, a
// failed load) renders in place of the component.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { prerender } from 'react-dom/static'
import { NFError } from '@next-federation/sdk'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import { createBindings } from '../src/components/render.tsx'
import type { BindingsRuntime } from '../src/components/render.tsx'
import { createComponentRuntime } from '../src/components/runtime.ts'
import type {
  ComponentEvent,
  FederationInstance,
  RemoteModule,
  Thenable,
} from '../src/components/runtime.ts'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const fulfilled = <T,>(value: T): Thenable<T> =>
  Object.assign(Promise.resolve(value), {
    status: 'fulfilled' as const,
    value,
  })
const rejected = <T,>(reason: unknown): Thenable<T> => {
  const p = Promise.reject(reason) as Thenable<T>
  p.catch(() => {})
  return Object.assign(p, { status: 'rejected' as const, reason })
}

const descriptor: RemoteComponentDescriptor = {
  remote: 'widgets',
  name: 'widgets',
  buildId: 'w1',
  base: 'http://127.0.0.1:4110/b/w1/',
  manifest: 'http://127.0.0.1:4110/b/w1/mf-manifest.json',
  ssr: { integrity: { 'mf-manifest.json': 'sha384-AAAA' } },
  maxBuilds: 5,
}
const id = { remote: 'widgets', buildId: 'w1', expose: './Widget' }

const ok: RemoteModule = { default: () => <span>widget</span> }

function fakeRuntime(over: Partial<BindingsRuntime> = {}): BindingsRuntime {
  return {
    load: () => fulfilled(ok),
    serverLoad: () => fulfilled(ok),
    serverBlock: () => null,
    serverOutcome: () => ({ kind: 'loaded' }),
    registerShared: () => {},
    refuse: () => {},
    refusedBuild: () => undefined,
    ...over,
  }
}

function bind(runtime: BindingsRuntime, isServer: boolean) {
  const events: ComponentEvent[] = []
  const bindings = createBindings({
    runtime,
    isServer,
    emit: (event) => events.push(event),
  })
  const C = bindings.createRemoteComponent({
    expose: './Widget',
    fallback: <i>loading</i>,
    errorFallback: <b>failed</b>,
  })
  return { C, events, bindings }
}

async function serverHtml(node: React.ReactNode): Promise<string> {
  const { prelude } = await prerender(node, { onError: () => {} })
  return new Response(prelude).text()
}

async function clientRender(node: React.ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(node)
  })
  await act(async () => {})
  return { container, done: () => (root.unmount(), container.remove()) }
}

const fallbacks = (events: ComponentEvent[]) =>
  events.filter((e) => e.type === 'component:fallback')

beforeEach(() => {
  rs.spyOn(console, 'error').mockImplementation(() => {})
  rs.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  rs.restoreAllMocks()
  delete (globalThis as { __mf_module_cache__?: unknown }).__mf_module_cache__
})

test("a healthy server render and hydration emit component:load with phase 'load' and outcome 'ready', and no component:fallback", async () => {
  const events: ComponentEvent[] = []
  const fakeReact = { useState: () => null, version: '19.3.1' }
  const instance: FederationInstance = {
    registerRemotes() {},
    registerShared() {},
    loadRemote: async () => ({ default: () => null }) as never,
  }
  for (const isServer of [true, false]) {
    const runtime = createComponentRuntime({
      isServer,
      react: fakeReact,
      hostShared: { react: { version: '19.3.1', module: fakeReact } },
      createInstance: () => instance,
      serverPlugin: () => ({ name: 'test' }),
      canLoadServerCode: () => true,
      isTrusted: () => true,
      emit: (event) => events.push(event),
    })
    await runtime.load(descriptor, './Widget')
  }
  expect(events).toEqual([
    expect.objectContaining({
      type: 'component:load',
      ...id,
      env: 'server',
      phase: 'load',
      outcome: 'ready',
    }),
    expect.objectContaining({
      type: 'component:load',
      ...id,
      env: 'client',
      phase: 'load',
      outcome: 'ready',
    }),
  ])
  // The bindings themselves add nothing to a healthy render.
  const server = bind(fakeRuntime(), true)
  expect(await serverHtml(<server.C descriptor={descriptor} />)).toContain(
    'widget'
  )
  const client = bind(fakeRuntime(), false)
  const { container, done } = await clientRender(
    <client.C descriptor={descriptor} />
  )
  expect(container.textContent).toBe('widget')
  done()
  expect(server.events).toEqual([])
  expect(client.events).toEqual([])
})

test('a pending load emits no component:fallback while the placeholder shows', async () => {
  const pending = Object.assign(new Promise<RemoteModule>(() => {}), {
    status: 'pending' as const,
  }) as Thenable<RemoteModule>
  const { C, events } = bind(fakeRuntime({ load: () => pending }), false)
  const { container, done } = await clientRender(<C descriptor={descriptor} />)
  expect(container.textContent).toBe('loading')
  done()
  expect(events).toEqual([])
})

test("refused emits component:error (code NF-027, outcome 'refused') and component:fallback (reason 'refused')", async () => {
  // Refused before any load: by the descriptor the server set.
  const refusedDescriptor: RemoteComponentDescriptor = {
    ...descriptor,
    refused: { code: 'NF-027' },
  }
  const runtime = fakeRuntime({
    refusedBuild: (d) => d.refused?.code,
    load: () => {
      throw new Error('never loaded')
    },
    serverLoad: () => {
      throw new Error('never loaded')
    },
  })
  for (const isServer of [true, false]) {
    const { C, events } = bind(runtime, isServer)
    if (isServer) {
      expect(await serverHtml(<C descriptor={refusedDescriptor} />)).toContain(
        'failed'
      )
    } else {
      const { container, done } = await clientRender(
        <C descriptor={refusedDescriptor} />
      )
      expect(container.textContent).toBe('failed')
      done()
    }
    const env = isServer ? 'server' : 'client'
    expect(events).toEqual([
      expect.objectContaining({
        type: 'component:error',
        ...id,
        env,
        code: 'NF-027',
        outcome: 'refused',
      }),
      {
        type: 'component:fallback',
        ...id,
        env,
        phase: 'render',
        reason: 'refused',
        code: 'NF-027',
      },
    ])
  }
})

test("browser-only emits component:fallback reason 'browser-only' on the server only; the browser then emits component:load", async () => {
  const server = bind(fakeRuntime(), true)
  await serverHtml(<server.C descriptor={descriptor} browserOnly />)
  expect(server.events).toEqual([
    {
      type: 'component:fallback',
      ...id,
      env: 'server',
      phase: 'render',
      reason: 'browser-only',
    },
  ])
  // A build the server would not load (blocked): browser-only too.
  const blocked = bind(
    fakeRuntime({
      serverLoad: () => fulfilled(null),
      serverOutcome: () => ({
        kind: 'blocked',
        block: 'untrusted',
        code: 'NF-028',
      }),
    }),
    true
  )
  await serverHtml(<blocked.C descriptor={descriptor} />)
  expect(fallbacks(blocked.events)).toEqual([
    expect.objectContaining({ reason: 'browser-only', code: 'NF-028' }),
  ])
  // The browser renders it: no fallback event there.
  const client = bind(fakeRuntime(), false)
  const { container, done } = await clientRender(
    <client.C descriptor={descriptor} browserOnly />
  )
  expect(container.textContent).toBe('widget')
  done()
  expect(fallbacks(client.events)).toEqual([])
})

test("an NF-040 render error emits component:error and component:fallback reason 'render-error'", async () => {
  const boom: RemoteModule = {
    default: () => {
      throw new Error('boom')
    },
  }
  for (const isServer of [true, false]) {
    const { C, events } = bind(
      fakeRuntime({
        load: () => fulfilled(boom),
        serverLoad: () => fulfilled(boom),
      }),
      isServer
    )
    if (isServer) await serverHtml(<C descriptor={descriptor} />)
    else (await clientRender(<C descriptor={descriptor} />)).done()
    const env = isServer ? 'server' : 'client'
    expect(events).toEqual([
      expect.objectContaining({
        type: 'component:error',
        ...id,
        env,
        code: 'NF-040',
        phase: 'render',
        outcome: 'fallback',
      }),
      {
        type: 'component:fallback',
        ...id,
        env,
        phase: 'render',
        reason: 'render-error',
        code: 'NF-040',
      },
    ])
  }
})

test("a failed load emits component:fallback reason 'failed' (its component:error is the runtime's)", async () => {
  const error = new NFError('NF-029', 'down')
  const client = bind(fakeRuntime({ load: () => rejected(error) }), false)
  ;(await clientRender(<client.C descriptor={descriptor} />)).done()
  expect(client.events).toEqual([
    {
      type: 'component:fallback',
      ...id,
      env: 'client',
      phase: 'render',
      reason: 'failed',
      code: 'NF-029',
    },
  ])
  const server = bind(
    fakeRuntime({
      serverLoad: () => fulfilled(null),
      serverOutcome: () => ({ kind: 'error', code: 'NF-029', error }),
    }),
    true
  )
  await serverHtml(<server.C descriptor={descriptor} />)
  expect(server.events).toEqual([
    expect.objectContaining({
      type: 'component:fallback',
      reason: 'failed',
      code: 'NF-029',
    }),
  ])
})

test('a caller timeout emits nothing', async () => {
  const pending = Object.assign(new Promise<RemoteModule>(() => {}), {
    status: 'pending' as const,
  }) as Thenable<RemoteModule>
  const { bindings, events } = bind(
    fakeRuntime({ serverLoad: () => pending }),
    true
  )
  const result = await bindings.preloadRemoteComponent(descriptor, './Widget', {
    timeoutMs: 5,
  })
  expect(result.state).toBe('timeout')
  expect(events).toEqual([])
})

test("server: an unverified (ssr null) build emits fallback 'browser-only'; a refused one emits 'refused'", async () => {
  const unverified: RemoteComponentDescriptor = {
    ...descriptor,
    ssr: null,
  }
  const plain = bind(fakeRuntime(), true)
  await serverHtml(<plain.C descriptor={unverified} />)
  expect(plain.events).toEqual([
    {
      type: 'component:fallback',
      ...id,
      env: 'server',
      phase: 'render',
      reason: 'browser-only',
    },
  ])
  const refused = bind(fakeRuntime(), true)
  await serverHtml(
    <refused.C descriptor={{ ...unverified, refused: { code: 'NF-027' } }} />
  )
  expect(refused.events).toEqual([
    expect.objectContaining({ type: 'component:error', code: 'NF-027' }),
    expect.objectContaining({
      type: 'component:fallback',
      reason: 'refused',
      code: 'NF-027',
    }),
  ])
})

test("browser: a load refused with NF-027 or NF-036 emits fallback reason 'refused'", async () => {
  for (const code of ['NF-027', 'NF-036'] as const) {
    const error = new NFError(code, 'refused')
    const { C, events } = bind(
      fakeRuntime({ load: () => rejected(error) }),
      false
    )
    ;(await clientRender(<C descriptor={descriptor} />)).done()
    expect(events).toEqual([
      {
        type: 'component:fallback',
        ...id,
        env: 'client',
        phase: 'render',
        reason: 'refused',
        code,
      },
    ])
  }
})

test('server: a loader-blocked refusal (no load ran) emits component:error and fallback', async () => {
  const { C, events } = bind(
    fakeRuntime({
      serverLoad: () => fulfilled(null),
      serverOutcome: () => ({
        kind: 'blocked',
        block: 'nested-remotes',
        code: 'NF-027',
      }),
    }),
    true
  )
  expect(await serverHtml(<C descriptor={descriptor} />)).toContain('failed')
  expect(events).toEqual([
    expect.objectContaining({
      type: 'component:error',
      ...id,
      env: 'server',
      code: 'NF-027',
      phase: 'render',
      outcome: 'refused',
    }),
    {
      type: 'component:fallback',
      ...id,
      env: 'server',
      phase: 'render',
      reason: 'refused',
      code: 'NF-027',
    },
  ])
})

test('server: a load that failed with NF-027 (the runtime reported it) emits only fallback refused', async () => {
  const error = new NFError('NF-027', 'integrity')
  const { C, events } = bind(
    fakeRuntime({
      serverLoad: () => fulfilled(null),
      serverOutcome: () => ({ kind: 'error', code: 'NF-027', error }),
    }),
    true
  )
  expect(await serverHtml(<C descriptor={descriptor} />)).toContain('failed')
  expect(events).toEqual([
    {
      type: 'component:fallback',
      ...id,
      env: 'server',
      phase: 'render',
      reason: 'refused',
      code: 'NF-027',
    },
  ])
})
