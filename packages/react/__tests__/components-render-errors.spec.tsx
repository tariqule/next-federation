// Mode A render errors. React error boundaries do not run on the server, so a
// remote component that throws while the server renders it would reach the
// host's renderer (Next fails a build-time prerender on any such error): the
// bindings catch it, render the fallback marked for the browser, and report
// NF-040. In the browser the boundary reports it (componentDidCatch) and
// renders `errorFallback`.
import { act, use, useId } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { prerender } from 'react-dom/static'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import { BROWSER_ONLY_ATTR, createBindings } from '../src/components/render.tsx'
import type { BindingsRuntime } from '../src/components/render.tsx'
import type {
  ComponentEvent,
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

function Boom({ message = 'boom' }: { message?: string }): never {
  throw new Error(message)
}
const boom: RemoteModule = { default: Boom }

function runtimeOf(
  server: Thenable<RemoteModule | null>,
  client: Thenable<RemoteModule> = server as Thenable<RemoteModule>
): BindingsRuntime {
  return {
    load: () => client,
    serverLoad: () => server,
    serverBlock: () => null,
    registerShared: () => {},
  }
}

function bind(
  runtime: BindingsRuntime,
  isServer: boolean,
  events: ComponentEvent[],
  options: { errorFallback?: boolean } = {}
) {
  return createBindings({
    runtime,
    isServer,
    emit: (event) => events.push(event),
  }).createRemoteComponent<{ message?: string }>({
    expose: './Boom',
    fallback: <i data-testid="fallback">loading</i>,
    ...(options.errorFallback
      ? { errorFallback: <b data-testid="error">failed</b> }
      : {}),
  })
}

async function serverHtml(
  node: React.ReactNode
): Promise<{ html: string; errors: unknown[] }> {
  const errors: unknown[] = []
  const { prelude } = await prerender(node, {
    onError: (error) => {
      errors.push(error)
    },
  })
  const html = await new Response(prelude).text()
  return { html, errors }
}

let consoleError: ReturnType<typeof rs.spyOn>
beforeEach(() => {
  consoleError = rs.spyOn(console, 'error').mockImplementation(() => {})
  rs.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  rs.restoreAllMocks()
})
const nfLogs = (code: string) =>
  consoleError.mock.calls.filter((args: unknown[]) =>
    args.some((a) => typeof a === 'string' && a.includes(code))
  )

test('server: a component that throws while rendering never reaches the renderer; fallback + browser mark, NF-040', async () => {
  const events: ComponentEvent[] = []
  const C = bind(runtimeOf(fulfilled(boom)), true, events)
  const { html, errors } = await serverHtml(
    <main>
      <C descriptor={descriptor} message="server boom" />
    </main>
  )
  // A build-time prerender fails on any error React reports here.
  expect(errors).toEqual([])
  expect(html).toContain(`<template ${BROWSER_ONLY_ATTR}=`)
  expect(html).toContain('loading')
  expect(nfLogs('NF-040')).toHaveLength(1)
  expect(String(nfLogs('NF-040')[0])).toContain('widgets:./Boom')
  expect(events).toEqual([
    expect.objectContaining({
      type: 'component:error',
      remote: 'widgets',
      buildId: 'w1',
      expose: './Boom',
      code: 'NF-040',
      env: 'server',
      error: expect.objectContaining({ message: 'server boom' }),
    }),
  ])
})

test('server: a component that suspends (use) still renders; React control flow is never caught', async () => {
  const events: ComponentEvent[] = []
  let resolve!: (v: string) => void
  const data = new Promise<string>((r) => (resolve = r))
  function Slow() {
    return <span>value {use(data)}</span>
  }
  const C = bind(runtimeOf(fulfilled({ default: Slow })), true, events)
  setTimeout(() => resolve('ready'), 5)
  const { html, errors } = await serverHtml(<C descriptor={descriptor} />)
  expect(errors).toEqual([])
  expect(html).toContain('value <!-- -->ready')
  expect(html).not.toContain(BROWSER_ONLY_ATTR)
  expect(events).toEqual([])
})

test("the workspace React's suspension error still starts with 'Suspense Exception:' (render.tsx isControlFlow relies on it)", async () => {
  // React throws this Error (not the thenable) from `use()` on a pending
  // promise. If a React upgrade renames it, the renderer would catch React's
  // own suspension as a render error: update isControlFlow, then this test.
  let thrown: unknown
  let resolve!: (v: string) => void
  const data = new Promise<string>((r) => (resolve = r))
  function Probe() {
    try {
      return <span>{use(data)}</span>
    } catch (error) {
      thrown ??= error
      throw error
    }
  }
  setTimeout(() => resolve('ready'), 5)
  await serverHtml(<Probe />)
  expect(thrown).toBeInstanceOf(Error)
  expect((thrown as Error).message).toMatch(/^Suspense Exception:/)
  expect(typeof (thrown as { then?: unknown }).then).not.toBe('function')
})

test('server: a framework control-flow error (it carries a digest) passes through', async () => {
  const events: ComponentEvent[] = []
  function Bailout(): never {
    throw Object.assign(new Error('bail out to client rendering'), {
      digest: 'FRAMEWORK_SIGNAL',
    })
  }
  const C = bind(runtimeOf(fulfilled({ default: Bailout })), true, events)
  const { errors } = await serverHtml(<C descriptor={descriptor} />)
  expect(errors).toEqual([
    expect.objectContaining({ digest: 'FRAMEWORK_SIGNAL' }),
  ])
  expect(events).toEqual([])
})

test('hydrating a server render error: the browser renders it, its error goes to errorFallback, NF-040 + component:error', async () => {
  const serverEvents: ComponentEvent[] = []
  const clientEvents: ComponentEvent[] = []
  const Server = bind(runtimeOf(fulfilled(boom)), true, serverEvents, {
    errorFallback: true,
  })
  const Client = bind(runtimeOf(fulfilled(boom)), false, clientEvents, {
    errorFallback: true,
  })
  const { html } = await serverHtml(<Server descriptor={descriptor} />)
  // The server knows only that its own render failed: the loading fallback.
  expect(html).toContain('loading')
  expect(html).not.toContain('failed')
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.appendChild(container)
  const recoverable: unknown[] = []
  await act(async () => {
    hydrateRoot(container, <Client descriptor={descriptor} />, {
      onRecoverableError: (e) => recoverable.push(e),
      onCaughtError: () => {},
    })
  })
  await act(async () => {})
  expect(container.textContent).toBe('failed')
  expect(recoverable).toEqual([])
  expect(clientEvents).toEqual([
    expect.objectContaining({
      type: 'component:error',
      remote: 'widgets',
      buildId: 'w1',
      expose: './Boom',
      code: 'NF-040',
      env: 'client',
      error: expect.objectContaining({ message: 'boom' }),
    }),
  ])
  container.remove()
})

test('hydrating a server render error: a fallback that uses useId gets the same id on both sides', async () => {
  const ids: string[] = []
  function IdFallback() {
    const id = useId()
    ids.push(id)
    return (
      <i id={id} data-testid="fallback">
        loading
      </i>
    )
  }
  const make = (isServer: boolean) =>
    createBindings({
      runtime: runtimeOf(fulfilled(boom)),
      isServer,
      emit: () => {},
    }).createRemoteComponent<{ message?: string }>({
      expose: './Boom',
      fallback: <IdFallback />,
      errorFallback: <b>failed</b>,
    })
  const Server = make(true)
  const Client = make(false)
  const { html } = await serverHtml(<Server descriptor={descriptor} />)
  const serverId = /<i id="([^"]+)"/.exec(html)?.[1]
  expect(serverId).toBeDefined()
  ids.length = 0
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.appendChild(container)
  await act(async () => {
    hydrateRoot(container, <Client descriptor={descriptor} />, {
      onRecoverableError: () => {},
      onCaughtError: () => {},
    })
  })
  // The first client render is the hydration of the server's fallback.
  expect(ids[0]).toBe(serverId)
  const mismatch = consoleError.mock.calls.filter((args: unknown[]) =>
    args.some((a) => typeof a === 'string' && /didn't match|hydrat/i.test(a))
  )
  expect(mismatch).toEqual([])
  container.remove()
})

async function clientRender(node: React.ReactNode): Promise<string> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container, { onCaughtError: () => {} })
  await act(async () => root.render(node))
  const text = container.textContent ?? ''
  await act(async () => root.unmount())
  container.remove()
  return text
}

test('browser: an error thrown deeper in the remote tree is reported too (componentDidCatch)', async () => {
  const events: ComponentEvent[] = []
  function Child(): never {
    throw new Error('deep')
  }
  function Parent() {
    return (
      <div>
        <Child />
      </div>
    )
  }
  const C = bind(runtimeOf(fulfilled({ default: Parent })), false, events, {
    errorFallback: true,
  })
  expect(await clientRender(<C descriptor={descriptor} />)).toBe('failed')
  expect(events).toEqual([
    expect.objectContaining({ code: 'NF-040', env: 'client' }),
  ])
  expect(nfLogs('NF-040')).toHaveLength(1)
})

test('browser: a failed load renders errorFallback and is not reported again as a render error', async () => {
  const events: ComponentEvent[] = []
  const reason = Object.assign(new Error('NF-029: load failed'), {
    code: 'NF-029',
  })
  const C = bind(runtimeOf(rejected(reason), rejected(reason)), false, events, {
    errorFallback: true,
  })
  expect(await clientRender(<C descriptor={descriptor} />)).toBe('failed')
  // The runtime reported the load failure itself (NF-029).
  expect(events).toEqual([])
  expect(nfLogs('NF-040')).toHaveLength(0)
})

test('errorFallback: fallback while loading, errorFallback on failure and for a null descriptor; defaults to fallback', async () => {
  const events: ComponentEvent[] = []
  const pending = Object.assign(new Promise<RemoteModule>(() => {}), {
    status: 'pending' as const,
  })
  const Loading = bind(runtimeOf(pending), false, events, {
    errorFallback: true,
  })
  expect(await clientRender(<Loading descriptor={descriptor} />)).toBe(
    'loading'
  )
  expect(await clientRender(<Loading descriptor={null} />)).toBe('failed')
  // A per-use override.
  expect(
    await clientRender(
      <Loading descriptor={null} errorFallback={<b>down</b>} />
    )
  ).toBe('down')
  const Plain = bind(runtimeOf(fulfilled(boom)), false, events)
  expect(await clientRender(<Plain descriptor={descriptor} />)).toBe('loading')
  expect(await clientRender(<Plain descriptor={null} />)).toBe('loading')
})
