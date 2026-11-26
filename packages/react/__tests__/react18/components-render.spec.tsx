// Remote components on a React 18 host: server HTML (streamed, Suspense
// resolved), hydration, client mounts, failures and the shared React check.
// Runs on React 18.3.1 (the `dom-react18` project in rstest.config.ts), for
// this spec and the library source it imports.
import { Writable } from 'node:stream'
import * as React from 'react'
import { act, version } from 'react'
import type { ReactElement } from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import { createRoot, hydrateRoot, type Root } from 'react-dom/client'
import { renderToPipeableStream } from 'react-dom/server'
import * as JsxRuntime from 'react/jsx-runtime'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import { createBindings } from '../../src/components/render.tsx'
import type { BindingsRuntime } from '../../src/components/render.tsx'
import { createComponentRuntime } from '../../src/components/runtime.ts'
import type {
  ComponentEvent,
  RemoteModule,
  Thenable,
} from '../../src/components/runtime.ts'
import {
  descriptor,
  fakeRuntime,
  fulfilled,
  mod,
} from '../helpers/components-fakes.tsx'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const BASE = descriptor(true).base
const CSS = `${BASE}assets/Counter-a.css`

/** A descriptor whose expose has one stylesheet and one chunk. */
const styled = (ssr = true): RemoteComponentDescriptor => ({
  ...descriptor(ssr),
  assets: {
    entry: `${BASE}remoteEntry.js`,
    exposes: {
      './Counter': { css: [CSS], js: [`${BASE}assets/Counter-c.js`] },
    },
  },
})

/** A pending thenable; settling it sets status/value first, as the runtime does. */
function deferred<T>(): { thenable: Thenable<T>; resolve: (value: T) => void } {
  let settle!: (value: T) => void
  const thenable = new Promise<T>((r) => (settle = r)) as Thenable<T>
  thenable.status = 'pending'
  return {
    thenable,
    resolve: (value) => {
      thenable.status = 'fulfilled'
      thenable.value = value
      settle(value)
    },
  }
}

const rejected = <T,>(reason: unknown): Thenable<T> => {
  const p = Promise.reject(reason) as Thenable<T>
  p.catch(() => {})
  return Object.assign(p, { status: 'rejected' as const, reason })
}

function bind(
  runtime: BindingsRuntime,
  isServer: boolean,
  events: ComponentEvent[] = [],
  options: { errorFallback?: boolean } = {}
) {
  return createBindings({
    runtime,
    isServer,
    emit: (event) => events.push(event),
  }).createRemoteComponent<{ start?: number }>({
    expose: './Counter',
    fallback: <i data-testid="fallback">loading</i>,
    ...(options.errorFallback
      ? { errorFallback: <b data-testid="error">failed</b> }
      : {}),
  })
}

const headLinks = () =>
  [...document.head.querySelectorAll('link[rel="stylesheet"]')].filter(
    (l) => l.getAttribute('href') === CSS
  )
const inlineLinks = (container: HTMLElement) =>
  container.querySelectorAll(`link[href="${CSS}"]`)

// React 18 warns on the server for a layout effect; the spec DOM has a
// `document`, so `useIsomorphicLayoutEffect` is `useLayoutEffect` here.
const SERVER_LAYOUT_EFFECT = /useLayoutEffect does nothing on the server/

/**
 * Server HTML on React 18, streamed once every Suspense boundary resolved.
 * Fails on any React error and on any console.error other than the
 * server layout-effect warning.
 */
async function serverHtml(element: ReactElement): Promise<string> {
  const error = rs.spyOn(console, 'error').mockImplementation(() => {})
  const errors: unknown[] = []
  try {
    const html = await new Promise<string>((resolve, reject) => {
      let out = ''
      const sink = new Writable({
        write(chunk, _encoding, done) {
          out += String(chunk)
          done()
        },
      })
      sink.on('finish', () => resolve(out))
      const stream = renderToPipeableStream(element, {
        onAllReady: () => stream.pipe(sink),
        onShellError: reject,
        onError: (e) => {
          errors.push(e)
        },
      })
    })
    const logged = error.mock.calls
      .map((args: unknown[]) => String(args[0]))
      .filter((m: string) => !SERVER_LAYOUT_EFFECT.test(m))
    expect(logged).toEqual([])
    expect(errors).toEqual([])
    return html
  } finally {
    error.mockRestore()
  }
}

// happy-dom reports each stylesheet it is not set up to load (the head copy)
// on console.error; that one is the test DOM's, not React's.
const HAPPY_DOM_CSS = 'NotSupportedError: Failed to load external stylesheet'

let roots: Root[]

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  roots = []
})

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  rs.restoreAllMocks()
})

function container(html = ''): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}

/** Hydrates; returns what React logged on console.error (happy-dom's CSS noise aside). */
async function hydrate(
  el: HTMLElement,
  page: ReactElement
): Promise<{ root: Root; logged: string[]; recoverable: unknown[] }> {
  const recoverable: unknown[] = []
  const error = rs.spyOn(console, 'error').mockImplementation(() => {})
  let root!: Root
  try {
    await act(async () => {
      root = hydrateRoot(el, page, {
        onRecoverableError: (e) => recoverable.push(e),
      })
    })
    await act(async () => {})
    roots.push(root)
    const logged = error.mock.calls
      .map((args: unknown[]) => String(args[0]))
      .filter((m: string) => !m.startsWith(HAPPY_DOM_CSS))
    return { root, logged, recoverable }
  } finally {
    error.mockRestore()
  }
}

it('runs on React 18', () => {
  expect(version).toBe('18.3.1')
})

it('server render (renderToPipeableStream, onAllReady) resolves the module; the inline link precedes the markup', async () => {
  const { thenable, resolve } = deferred<RemoteModule | null>()
  const C = bind({ ...fakeRuntime(null), serverLoad: () => thenable }, true)
  setTimeout(() => resolve(mod), 5)
  const html = await serverHtml(
    <main>
      <C descriptor={styled()} start={2} />
    </main>
  )
  expect(html).toMatch(
    new RegExp(
      `<link rel="stylesheet" href="${CSS}" data-precedence="next-federation"/?><span data-testid="counter">count <!-- -->2</span>`
    )
  )
  expect(html).not.toContain('loading')
  // React 18 has no resource hints: nothing else is emitted for the build.
  expect(html.match(/<link /g)).toHaveLength(1)
})

it('hydrating that HTML logs no console.error and adds the head copy', async () => {
  const Server = bind(fakeRuntime(mod), true)
  const Client = bind(fakeRuntime(null), false)
  const el = container(
    await serverHtml(
      <main>
        <Server descriptor={styled()} start={2} />
      </main>
    )
  )
  expect(headLinks()).toHaveLength(0)
  const { logged, recoverable } = await hydrate(
    el,
    <main>
      <Client descriptor={styled()} start={2} />
    </main>
  )
  expect(logged).toEqual([])
  expect(recoverable).toEqual([])
  expect(el.textContent).toBe('count 2')
  // The server's inline link is adopted, and a head copy outlives it.
  expect(inlineLinks(el)).toHaveLength(1)
  expect(headLinks()).toHaveLength(1)
  const [copy] = headLinks()
  expect(copy!.getAttribute('data-precedence')).toBe('next-federation')
  expect(copy!.getAttribute('data-nf-css')).toBe('')
})

it('a client mount inserts the head link before runtime.load is called', async () => {
  const linksAtLoad: number[] = []
  const C = bind(
    {
      ...fakeRuntime(null),
      load: () => {
        linksAtLoad.push(headLinks().length)
        return fulfilled(mod)
      },
    },
    false
  )
  const el = container()
  const root = createRoot(el)
  roots.push(root)
  await act(async () => {
    root.render(<C descriptor={styled()} />)
  })
  expect(el.textContent).toBe('count 0')
  expect(linksAtLoad[0]).toBe(1)
  expect(headLinks()).toHaveLength(1)
  const [link] = headLinks()
  expect(link!.getAttribute('data-precedence')).toBe('next-federation')
  expect(link!.getAttribute('data-nf-css')).toBe('')
  // Nothing inline: the head link is the only one.
  expect(inlineLinks(el)).toHaveLength(0)
})

it('a failed load renders the fallback and reports the same NF code as React 19', async () => {
  const consoleError = rs.spyOn(console, 'error').mockImplementation(() => {})
  const nfLogs = (code: string) =>
    consoleError.mock.calls.filter((args: unknown[]) =>
      args.some((a) => typeof a === 'string' && a.includes(code))
    )
  const events: ComponentEvent[] = []
  const reason = Object.assign(new Error('NF-029: load failed'), {
    code: 'NF-029',
  })
  const C = bind(
    { ...fakeRuntime(null), load: () => rejected(reason) },
    false,
    events,
    { errorFallback: true }
  )
  const el = container()
  const root = createRoot(el)
  roots.push(root)
  await act(async () => root.render(<C descriptor={descriptor(true)} />))
  // Assertions as in components-render-errors.spec.tsx ("browser: a failed
  // load renders errorFallback and is not reported again as a render error").
  expect(el.textContent).toBe('failed')
  // The runtime reported the load failure itself (NF-029): only its fallback.
  expect(events).toEqual([
    expect.objectContaining({
      type: 'component:fallback',
      reason: 'failed',
      code: 'NF-029',
    }),
  ])
  expect(nfLogs('NF-040')).toHaveLength(0)
})

it('a build requiring react ^19.0.0 on a host registering react 18.3.1 renders the fallback and reports NF-036; render does not throw', async () => {
  const consoleError = rs.spyOn(console, 'error').mockImplementation(() => {})
  const runtimeEvents: ComponentEvent[] = []
  const bindingEvents: ComponentEvent[] = []
  const instances: unknown[] = []
  // The host's own React, registered as index.tsx registers it.
  const runtime = createComponentRuntime({
    isServer: false,
    react: React,
    hostShared: {
      react: { version: React.version, module: React },
      'react/jsx-runtime': { version: React.version, module: JsxRuntime },
      'react-dom': { version: ReactDOM.version, module: ReactDOM },
      'react-dom/client': { version: ReactDOM.version, module: ReactDOMClient },
    },
    createInstance: (options) => {
      instances.push(options)
      throw new Error('the shared check refuses before Module Federation runs')
    },
    canLoadServerCode: () => false,
    emit: (event) => runtimeEvents.push(event),
  })
  const d: RemoteComponentDescriptor = {
    ...descriptor(true),
    shared: { react: { requiredVersion: '^19.0.0', fallback: false } },
  }
  const C = bind(runtime, false, bindingEvents, { errorFallback: true })
  const el = container()
  const root = createRoot(el)
  roots.push(root)
  await act(async () => root.render(<C descriptor={d} />))
  await act(async () => {})
  expect(el.textContent).toBe('failed')
  expect(instances).toEqual([])
  expect(runtimeEvents).toEqual([
    expect.objectContaining({
      type: 'component:error',
      remote: 'components',
      expose: './Counter',
      code: 'NF-036',
      env: 'client',
    }),
  ])
  const nf036 = consoleError.mock.calls.filter((args: unknown[]) =>
    args.some((a) => typeof a === 'string' && a.includes('NF-036'))
  )
  expect(nf036).toHaveLength(1)
  expect(String(nf036[0])).toContain('^19.0.0')
  expect(String(nf036[0])).toContain('18.3.1')
  // The boundary only renders the fallback: no render error (NF-040).
  expect(bindingEvents).toEqual([
    expect.objectContaining({ type: 'component:fallback', code: 'NF-036' }),
  ])
  const nf040 = consoleError.mock.calls.filter((args: unknown[]) =>
    args.some((a) => typeof a === 'string' && a.includes('NF-040'))
  )
  expect(nf040).toEqual([])
})

/** A browser runtime on this host's React 18, registered as index.tsx does. */
function react18Runtime(
  runtimeEvents: ComponentEvent[],
  loads: string[]
): ReturnType<typeof createComponentRuntime> {
  return createComponentRuntime({
    isServer: false,
    react: React,
    hostShared: {
      react: { version: React.version, module: React },
      'react/jsx-runtime': { version: React.version, module: JsxRuntime },
      'react-dom': { version: ReactDOM.version, module: ReactDOM },
      'react-dom/client': { version: ReactDOM.version, module: ReactDOMClient },
    },
    createInstance: () => ({
      registerRemotes() {},
      registerShared() {},
      async loadRemote(id: string) {
        loads.push(id)
        return mod as never
      },
    }),
    canLoadServerCode: () => false,
    emit: (event) => runtimeEvents.push(event),
  })
}

it('a build whose descriptor lists no React range counts as react ^19.0.0: fallback and NF-036 on React 18.3.1', async () => {
  const consoleError = rs.spyOn(console, 'error').mockImplementation(() => {})
  const runtimeEvents: ComponentEvent[] = []
  const bindingEvents: ComponentEvent[] = []
  const loads: string[] = []
  const C = bind(react18Runtime(runtimeEvents, loads), false, bindingEvents, {
    errorFallback: true,
  })
  const el = container()
  const root = createRoot(el)
  roots.push(root)
  // descriptor(): no `shared` at all, as every build made before Workstream D.
  await act(async () => root.render(<C descriptor={descriptor(true)} />))
  await act(async () => {})
  expect(el.textContent).toBe('failed')
  expect(loads).toEqual([])
  expect(runtimeEvents).toEqual([
    expect.objectContaining({ type: 'component:error', code: 'NF-036' }),
  ])
  const nf036 = consoleError.mock.calls.filter((args: unknown[]) =>
    args.some((a) => typeof a === 'string' && a.includes('NF-036'))
  )
  expect(nf036).toHaveLength(1)
  expect(String(nf036[0])).toContain('"react" "^19.0.0"')
  expect(String(nf036[0])).toContain('18.3.1')
  expect(bindingEvents).toEqual([
    expect.objectContaining({ type: 'component:fallback', code: 'NF-036' }),
  ])
})

it("a build listing react '^18.3.0 || ^19.0.0' renders on React 18.3.1", async () => {
  const runtimeEvents: ComponentEvent[] = []
  const loads: string[] = []
  const C = bind(react18Runtime(runtimeEvents, loads), false, [], {
    errorFallback: true,
  })
  const range = '^18.3.0 || ^19.0.0'
  const d: RemoteComponentDescriptor = {
    ...descriptor(true),
    shared: {
      react: { requiredVersion: range, fallback: false },
      'react-dom': { requiredVersion: range, fallback: false },
      'react-dom/client': { requiredVersion: range, fallback: false },
      'react/jsx-runtime': { requiredVersion: range, fallback: false },
    },
  }
  const el = container()
  const root = createRoot(el)
  roots.push(root)
  await act(async () => root.render(<C descriptor={d} start={3} />))
  await act(async () => {})
  expect(el.querySelector('[data-testid="counter"]')?.textContent).toBe(
    'count 3'
  )
  expect(loads).toEqual(['components/Counter'])
  expect(runtimeEvents.filter((e) => e.type === 'component:error')).toEqual([])
})

it('a server-rendered instance unmounts while a client-mounted sibling with the same css stays: head link present', async () => {
  const Server = bind(fakeRuntime(mod), true)
  const Client = bind(fakeRuntime(null), false)
  function Page({
    C,
    a,
    b,
  }: {
    C: typeof Server
    a: boolean
    b: boolean
  }): ReactElement {
    return (
      <main>
        {a ? <C descriptor={styled()} start={1} /> : null}
        {b ? <C descriptor={styled()} start={2} /> : null}
      </main>
    )
  }
  const el = container(await serverHtml(<Page C={Server} a b={false} />))
  const { root, logged } = await hydrate(el, <Page C={Client} a b={false} />)
  expect(logged).toEqual([])
  expect(el.textContent).toBe('count 1')
  const [copy] = headLinks()
  expect(copy).toBeDefined()
  // The sibling mounts in the browser: it finds the head copy, adds none.
  await act(async () => root.render(<Page C={Client} a b />))
  expect(el.textContent).toBe('count 1count 2')
  expect(headLinks()).toEqual([copy])
  // Client navigation drops the server-rendered one and its inline link.
  await act(async () => root.render(<Page C={Client} a={false} b />))
  expect(el.textContent).toBe('count 2')
  expect(inlineLinks(el)).toHaveLength(0)
  expect(headLinks()).toEqual([copy])
  expect(copy!.isConnected).toBe(true)
})

it('a refused build: the server sends the refused marker and errorFallback; hydration keeps it and never loads', async () => {
  const Server = bind(
    {
      ...fakeRuntime(null),
      serverOutcome: () => ({
        kind: 'error',
        code: 'NF-027',
        error: new Error('integrity'),
      }),
    },
    true,
    [],
    { errorFallback: true }
  )
  let loads = 0
  const Client = bind(
    {
      ...fakeRuntime(null),
      load: () => {
        loads++
        return fulfilled(mod)
      },
    },
    false,
    [],
    { errorFallback: true }
  )
  const html = await serverHtml(
    <main>
      <Server descriptor={styled()} start={2} />
    </main>
  )
  expect(html).toContain('data-nf-refused=')
  expect(html).not.toContain('data-nf-browser-only')
  expect(html).not.toContain('modulepreload')
  const el = container(html)
  const { logged, recoverable } = await hydrate(
    el,
    <main>
      <Client descriptor={styled()} start={7} />
    </main>
  )
  expect(el.textContent).toBe('failed')
  expect(loads).toBe(0)
  expect(logged).toEqual([])
  expect(recoverable).toEqual([])
  expect(headLinks()).toHaveLength(0)
})
