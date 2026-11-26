// Mode A render paths, server HTML then hydration (happy-dom): a server
// render, a boundary the server left to the browser (the mark), and an
// unverified build (BrowserOnly). None may produce a recoverable error.
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import {
  BROWSER_ONLY_ATTR,
  REFUSED_ATTR,
  createBindings,
} from '../src/components/render.tsx'
import type { BindingsRuntime } from '../src/components/render.tsx'
import type { RemoteModule } from '../src/components/runtime.ts'
import {
  descriptor,
  fakeRuntime,
  fulfilled,
  mod,
} from './helpers/components-fakes.tsx'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
// happy-dom 21 loads no stylesheets unless asked; these tests load their own
// trusted ones (data: URLs, a local server), as a browser would.
;(
  window as unknown as {
    happyDOM: { settings: { enableCSSFileLoading: boolean } }
  }
).happyDOM.settings.enableCSSFileLoading = true

async function serverThenHydrate(
  serverModule: RemoteModule | null,
  ssr: boolean
) {
  const server = createBindings({
    runtime: fakeRuntime(serverModule),
    isServer: true,
  }).createRemoteComponent<{ start?: number }>({
    expose: './Counter',
    fallback: <i data-testid="fallback">unavailable</i>,
  })
  const client = createBindings({
    runtime: fakeRuntime(null),
    isServer: false,
  }).createRemoteComponent<{ start?: number }>({
    expose: './Counter',
    fallback: <i data-testid="fallback">unavailable</i>,
  })
  const d = descriptor(ssr)
  const Page = ({ C }: { C: typeof server }) => (
    <main>
      <C descriptor={d} start={2} />
    </main>
  )
  const raw = renderToString(<Page C={server} />)
  const html = raw.replaceAll('<!-- -->', '')
  const container = document.createElement('div')
  container.innerHTML = raw
  document.body.appendChild(container)
  const recoverable: unknown[] = []
  const caught: unknown[] = []
  await act(async () => {
    hydrateRoot(container, <Page C={client} />, {
      onRecoverableError: (e) => recoverable.push(e),
      onCaughtError: (e) => caught.push(e),
    })
  })
  await act(async () => {})
  const text = container.textContent
  container.remove()
  return { html, text, recoverable, caught }
}

test('server rendered: the server HTML has the component and hydrates as is', async () => {
  const r = await serverThenHydrate(mod, true)
  expect(r.html).toContain('count 2')
  expect(r.html).not.toContain(BROWSER_ONLY_ATTR)
  expect(r.text).toBe('count 2')
  expect(r.recoverable).toEqual([])
  expect(r.caught).toEqual([])
})

test('left to the browser by the server: mark + fallback, then the component, no recoverable error', async () => {
  const r = await serverThenHydrate(null, true)
  expect(r.html).toContain(`<template ${BROWSER_ONLY_ATTR}=`)
  expect(r.html).toContain('unavailable')
  expect(r.html).not.toContain('count')
  expect(r.text).toBe('count 2')
  expect(r.recoverable).toEqual([])
  expect(r.caught).toEqual([])
})

test('unverified build (ssr: null): fallback on the server, the component after hydration', async () => {
  const r = await serverThenHydrate(mod, false)
  expect(r.html).toContain('unavailable')
  expect(r.html).not.toContain('count')
  expect(r.text).toBe('count 2')
  expect(r.recoverable).toEqual([])
  expect(r.caught).toEqual([])
})

describe('stylesheets and modulepreload (descriptor assets)', () => {
  // A local server answers the stylesheets the document loads.
  let server: Server
  let base = ''
  const served: string[] = []
  // Lets the document finish loading a stylesheet before the test ends.
  const loaded = async (sheet: string) => {
    for (let i = 0; i < 100 && !served.some((u) => u.endsWith(sheet)); i++) {
      await act(() => new Promise((r) => setTimeout(r, 10)))
    }
    await act(() => new Promise((r) => setTimeout(r, 10)))
  }
  beforeAll(async () => {
    server = createServer((req, res) => {
      res.setHeader('content-type', 'text/css')
      res.end('.nf-counter{color:red}', () => served.push(req.url!))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/b/c1/`
  })
  afterAll(async () => {
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
  })
  // React keeps the stylesheets it inserted per document, across tests:
  // the tests that touch the document use their own stylesheet.
  const styled = (
    ssr: boolean,
    sheet = 'Counter-a'
  ): RemoteComponentDescriptor => ({
    ...descriptor(ssr),
    base,
    manifest: `${base}mf-manifest.json`,
    assets: {
      entry: `${base}remoteEntry.js`,
      exposes: {
        './Counter': {
          css: [`${base}assets/${sheet}.css`],
          js: [`${base}assets/dist-b.js`, `${base}assets/Counter-c.js`],
        },
      },
    },
  })
  const bind = (runtime: BindingsRuntime, isServer: boolean) =>
    createBindings({ runtime, isServer }).createRemoteComponent<{
      start?: number
    }>({
      expose: './Counter',
      fallback: <i data-testid="fallback">unavailable</i>,
    })
  const links = (html: string, rel: string) =>
    [...html.matchAll(/<link [^>]*>/g)]
      .map((m) => m[0])
      .filter((l) => l.includes(`rel="${rel}"`))
  const hrefOf = (l: string) => /href="([^"]+)"/.exec(l)?.[1]

  test('server render: one stylesheet link per href (precedence) and modulepreload for entry + chunks', () => {
    const C = bind(fakeRuntime(mod), true)
    const html = renderToString(
      <main>
        <C descriptor={styled(true)} />
        <C descriptor={styled(true)} start={3} />
      </main>
    )
    const css = links(html, 'stylesheet')
    expect(css.map(hrefOf)).toEqual([`${base}assets/Counter-a.css`])
    expect(css[0]).toContain('data-precedence="next-federation"')
    expect(links(html, 'modulepreload').map(hrefOf)).toEqual([
      `${base}remoteEntry.js`,
      `${base}assets/dist-b.js`,
      `${base}assets/Counter-c.js`,
    ])
    // Ahead of the component markup.
    expect(html.indexOf('Counter-a.css')).toBeLessThan(html.indexOf('count'))
  })

  test('no links when the server does not render the build (blocked, unverified, no assets)', () => {
    const Blocked = bind(
      { ...fakeRuntime(null), serverBlock: () => 'untrusted' },
      true
    )
    const Unverified = bind(fakeRuntime(mod), true)
    const Plain = bind(fakeRuntime(mod), true)
    for (const html of [
      renderToString(<Blocked descriptor={styled(true)} />),
      renderToString(<Unverified descriptor={styled(false)} />),
      renderToString(<Plain descriptor={descriptor(true)} />),
    ]) {
      expect(links(html, 'stylesheet')).toEqual([])
      expect(links(html, 'modulepreload')).toEqual([])
    }
  })

  test('URLs outside the descriptor base are never rendered', () => {
    const C = bind(fakeRuntime(mod), true)
    const html = renderToString(
      <C
        descriptor={{
          ...styled(true),
          assets: {
            entry: 'https://evil.example/e.js',
            exposes: {
              './Counter': {
                css: ['https://evil.example/a.css'],
                js: ['https://evil.example/a.js'],
              },
            },
          },
        }}
      />
    )
    expect(html).not.toContain('evil.example')
  })

  test('hydrating a server render: the stylesheet stays one link, no recoverable error', async () => {
    const Server = bind(fakeRuntime(mod), true)
    const Client = bind(fakeRuntime(null), false)
    const raw = renderToString(
      <main>
        <Server descriptor={styled(true, 'Counter-h')} start={2} />
      </main>
    )
    const container = document.createElement('div')
    container.innerHTML = raw
    document.body.appendChild(container)
    const recoverable: unknown[] = []
    await act(async () => {
      hydrateRoot(
        container,
        <main>
          <Client descriptor={styled(true, 'Counter-h')} start={2} />
        </main>,
        { onRecoverableError: (e) => recoverable.push(e) }
      )
    })
    await act(async () => {})
    expect(container.textContent).toBe('count 2')
    expect(
      document.querySelectorAll(`link[href="${base}assets/Counter-h.css"]`)
    ).toHaveLength(1)
    expect(recoverable).toEqual([])
    await loaded('Counter-h.css')
    container.remove()
    for (const l of document.querySelectorAll('link')) l.remove()
  })

  test('a boundary the server left to the browser inserts its stylesheet before the module loads', async () => {
    const sheet = `${base}assets/Counter-l.css`
    const Server = bind(fakeRuntime(null), true)
    const order: string[] = []
    const Client = bind(
      {
        ...fakeRuntime(null),
        load: () => {
          order.push(
            document.querySelector(`link[rel="stylesheet"][href="${sheet}"]`)
              ? 'load-after-css'
              : 'load-before-css'
          )
          return fulfilled(mod)
        },
      },
      false
    )
    const raw = renderToString(
      <Server descriptor={styled(true, 'Counter-l')} />
    )
    expect(raw).toContain(BROWSER_ONLY_ATTR)
    // Preload hints went out with the shell; no stylesheet link did.
    expect(links(raw, 'stylesheet')).toEqual([])
    const container = document.createElement('div')
    container.innerHTML = raw
    document.body.appendChild(container)
    const recoverable: unknown[] = []
    await act(async () => {
      hydrateRoot(
        container,
        <Client descriptor={styled(true, 'Counter-l')} />,
        {
          onRecoverableError: (e) => recoverable.push(e),
        }
      )
    })
    await act(async () => {})
    expect(container.textContent).toBe('count 0')
    expect(order[0]).toBe('load-after-css')
    expect(
      document.querySelectorAll(`link[rel="stylesheet"][href="${sheet}"]`)
    ).toHaveLength(1)
    expect(recoverable).toEqual([])
    await loaded('Counter-l.css')
    container.remove()
  })

  test('a client-first mount inserts the stylesheet (preinit) before the module loads', async () => {
    const order: string[] = []
    const runtime: BindingsRuntime = {
      ...fakeRuntime(null),
      load: () => {
        order.push(
          document.querySelector(`link[href="${base}assets/Counter-m.css"]`)
            ? 'load-after-css'
            : 'load-before-css'
        )
        return fulfilled(mod)
      },
    }
    const C = bind(runtime, false)
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <>
          <C descriptor={styled(false, 'Counter-m')} />
          <C descriptor={styled(false, 'Counter-m')} />
        </>
      )
    })
    expect(container.textContent).toBe('count 0count 0')
    const css = document.querySelectorAll(
      `link[rel="stylesheet"][href="${base}assets/Counter-m.css"]`
    )
    expect(css).toHaveLength(1)
    expect(css[0]!.getAttribute('data-precedence')).toBe('next-federation')
    expect(order[0]).toBe('load-after-css')
    await loaded('Counter-m.css')
    await act(async () => root.unmount())
    container.remove()
    for (const l of document.querySelectorAll('link')) l.remove()
  })
})

describe('refused builds (server integrity failure)', () => {
  const refusedRuntime = (): BindingsRuntime => ({
    ...fakeRuntime(null),
    serverOutcome: () => ({
      kind: 'error',
      code: 'NF-027',
      error: new Error('integrity'),
    }),
  })
  const withAssets = (): RemoteComponentDescriptor => ({
    ...descriptor(true),
    assets: {
      entry: 'http://127.0.0.1:4110/b/c1/remoteEntry.js',
      exposes: {
        './Counter': {
          css: ['http://127.0.0.1:4110/b/c1/assets/Counter-r.css'],
          js: ['http://127.0.0.1:4110/b/c1/assets/Counter-r.js'],
        },
      },
    },
  })
  const bind = (runtime: BindingsRuntime, isServer: boolean) =>
    createBindings({ runtime, isServer }).createRemoteComponent<{
      start?: number
    }>({
      expose: './Counter',
      fallback: <i data-testid="fallback">unavailable</i>,
      errorFallback: <b data-testid="error">refused</b>,
    })

  test('server render of an NF-027 build emits the refused marker and errorFallback, not the browser-only marker', () => {
    const C = bind(refusedRuntime(), true)
    const html = renderToString(<C descriptor={descriptor(true)} />)
    expect(html).toContain(`<template ${REFUSED_ATTR}=`)
    expect(html).toContain('refused')
    expect(html).not.toContain('unavailable')
    expect(html).not.toContain(BROWSER_ONLY_ATTR)
  })

  test('no modulepreload links for a refused boundary', async () => {
    const runtime = refusedRuntime()
    const b = createBindings({ runtime, isServer: true })
    const C = b.createRemoteComponent({
      expose: './Counter',
      errorFallback: <b>refused</b>,
    })
    await b.preloadRemoteComponent(withAssets(), './Counter')
    const html = renderToString(<C descriptor={withAssets()} />)
    expect(html).not.toContain('modulepreload')
    expect(html).not.toContain('Counter-r')
  })

  async function hydrateRefused(clientStart: number) {
    const Server = bind(refusedRuntime(), true)
    let loads = 0
    const Client = bind(
      {
        ...fakeRuntime(null),
        load: () => {
          loads++
          return fulfilled(mod)
        },
      },
      false
    )
    const raw = renderToString(
      <main>
        <Server descriptor={descriptor(true)} start={2} />
      </main>
    )
    const container = document.createElement('div')
    container.innerHTML = raw
    document.body.appendChild(container)
    const recoverable: unknown[] = []
    const consoleError = rs.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => {
      hydrateRoot(
        container,
        <main>
          <Client descriptor={descriptor(true)} start={clientStart} />
        </main>,
        { onRecoverableError: (e) => recoverable.push(e) }
      )
    })
    await act(async () => {})
    await act(() => new Promise((r) => setTimeout(r, 20)))
    const errors = consoleError.mock.calls
    consoleError.mockRestore()
    const text = container.textContent
    container.remove()
    return { text, loads, recoverable, errors }
  }

  test('hydrating a refused marker keeps errorFallback and never calls runtime.load', async () => {
    const r = await hydrateRefused(2)
    expect(r.text).toBe('refused')
    expect(r.loads).toBe(0)
    expect(r.recoverable).toEqual([])
  })

  test('hydrating a refused marker with a different client prop logs no hydration warning', async () => {
    const r = await hydrateRefused(7)
    expect(r.text).toBe('refused')
    expect(r.loads).toBe(0)
    expect(r.recoverable).toEqual([])
    expect(r.errors).toEqual([])
  })

  test('no modulepreload for a refusal learned while rendering (no prior preload)', async () => {
    // The load is still running when the shell renders.
    let settled = false
    let settle!: (v: null) => void
    const pending = Object.assign(
      new Promise<null>((r) => (settle = r)).then((v) => {
        settled = true
        Object.assign(pending, { status: 'fulfilled', value: v })
        return v
      }),
      { status: 'pending' as const }
    )
    const C = bind(
      {
        ...refusedRuntime(),
        serverLoad: () => pending as never,
        serverOutcome: () =>
          settled
            ? { kind: 'error', code: 'NF-027', error: new Error('integrity') }
            : undefined,
      },
      true
    )
    setTimeout(() => settle(null), 5)
    const { prerender } = await import('react-dom/static')
    const { prelude } = await prerender(<C descriptor={withAssets()} />)
    const html = await new Response(prelude).text()
    expect(html).toContain(`<template ${REFUSED_ATTR}=`)
    expect(html).not.toContain('modulepreload')
    expect(html).not.toContain('Counter-r')
  })

  test('hints still go out for a build the server loaded', () => {
    const C = bind(fakeRuntime(mod), true)
    const html = renderToString(<C descriptor={withAssets()} />)
    expect(html).toContain('rel="modulepreload"')
    expect(html).toContain('Counter-r.js')
  })

  const counting = () => {
    const runtime = fakeRuntime(null)
    const counter = { loads: 0 }
    return {
      counter,
      runtime: {
        ...runtime,
        load: () => {
          counter.loads++
          return fulfilled(mod)
        },
      } satisfies BindingsRuntime,
    }
  }

  test('a client-only mount of a refused descriptor never loads and shows errorFallback', async () => {
    const { runtime, counter } = counting()
    const C = bind(runtime, false)
    const { createRoot } = await import('react-dom/client')
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => {
      root.render(
        <C descriptor={{ ...withAssets(), refused: { code: 'NF-027' } }} />
      )
    })
    expect(el.textContent).toBe('refused')
    expect(counter.loads).toBe(0)
    expect(document.querySelector('link[href*="Counter-r"]')).toBeNull()
    await act(async () => root.unmount())
    el.remove()
  })

  test('after hydrating a refused marker, new and remounted boundaries of that build never load', async () => {
    const Server = bind(refusedRuntime(), true)
    const { runtime, counter } = counting()
    const Client = bind(runtime, false)
    const raw = renderToString(
      <main>
        <Server descriptor={descriptor(true)} />
      </main>
    )
    const el = document.createElement('div')
    el.innerHTML = raw
    document.body.appendChild(el)
    let root!: ReturnType<typeof hydrateRoot>
    await act(async () => {
      root = hydrateRoot(
        el,
        <main>
          <Client descriptor={descriptor(true)} />
        </main>
      )
    })
    // A second instance (a client navigation), then a remount of both.
    await act(async () => {
      root.render(
        <main>
          <Client descriptor={descriptor(true)} />
          <Client descriptor={descriptor(true)} />
        </main>
      )
    })
    await act(async () => root.render(<main />))
    await act(async () => {
      root.render(
        <main>
          <Client key="again" descriptor={descriptor(true)} />
        </main>
      )
    })
    expect(el.textContent).toBe('refused')
    expect(counter.loads).toBe(0)
    await act(async () => root.unmount())
    el.remove()
  })

  test('a refused marker for another build (mismatching base) is ignored', async () => {
    const Server = bind(refusedRuntime(), true)
    const { runtime, counter } = counting()
    const Client = bind(runtime, false)
    const raw = renderToString(
      <main>
        <Server descriptor={descriptor(true)} />
      </main>
    ).replace(
      `data-nf-base="${descriptor(true).base}"`,
      'data-nf-base="http://127.0.0.1:4110/b/other/"'
    )
    expect(raw).toContain('b/other/')
    const el = document.createElement('div')
    el.innerHTML = raw
    document.body.appendChild(el)
    rs.spyOn(console, 'error').mockImplementation(() => {})
    let root!: ReturnType<typeof hydrateRoot>
    await act(async () => {
      root = hydrateRoot(
        el,
        <main>
          <Client descriptor={descriptor(true)} />
        </main>,
        { onRecoverableError: () => {} }
      )
    })
    await act(async () => {})
    expect(runtime.refusedBuild(descriptor(true))).toBeUndefined()
    expect(counter.loads).toBeGreaterThan(0)
    await act(async () => root.unmount())
    rs.restoreAllMocks()
    el.remove()
  })

  test('an unsigned (unverified) build still renders in the browser', async () => {
    const r = await serverThenHydrate(mod, false)
    expect(r.html).not.toContain(REFUSED_ATTR)
    expect(r.text).toBe('count 2')
    expect(r.recoverable).toEqual([])
  })
})
