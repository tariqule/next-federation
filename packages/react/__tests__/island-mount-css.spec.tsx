import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { act, startTransition } from 'react'
import { createRoot, hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import type {
  IslandBootstrapModule,
  IslandEnvelope,
} from '@next-federation/protocol'
import { IslandMount } from '../src/index.ts'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const PLACEHOLDER = 'nfid-1a2b3c4d'
// React keeps the stylesheets it inserted per document, across tests, so every
// test gets new hrefs. `data:` URLs load in happy-dom without a network.
let run = 0
const sheet = (name: string) => `data:text/css,.${name}{color:red}/*${run}*/`
let SHOP_CSS: string
let ADS_CSS: string

function envelope(over: Partial<IslandEnvelope> = {}): IslandEnvelope {
  return {
    protocolVersion: 1,
    remote: 'shop',
    buildId: 'b1',
    mode: 'development',
    html: `<p id="${PLACEHOLDER}:r0:">cart v1</p>`,
    rscPayload: `0:["${PLACEHOLDER}:r0:","v1"]`,
    css: [SHOP_CSS],
    bootstrap: 'https://shop.example.com/_nf/b1/bootstrap.js',
    reactVersion: '19.3.1',
    idPlaceholder: PLACEHOLDER,
    ...over,
  }
}

// The bootstrap never resolves: these tests are about the stylesheets only.
const loadBootstrap = (): Promise<IslandBootstrapModule> =>
  new Promise(() => {})

// Two islands of one remote share a stylesheet; a third remote has its own.
function Page() {
  return (
    <main>
      <IslandMount envelope={envelope()} loadBootstrap={loadBootstrap} />
      <IslandMount envelope={envelope()} loadBootstrap={loadBootstrap} />
      <IslandMount
        envelope={envelope({
          remote: 'ads',
          buildId: 'b7',
          css: [ADS_CSS],
          bootstrap: 'https://ads.example.com/_nf/b7/bootstrap.js',
        })}
        loadBootstrap={loadBootstrap}
      />
    </main>
  )
}

const sheets = (scope: ParentNode) =>
  [...scope.querySelectorAll('link[rel="stylesheet"]')].map((l) => ({
    href: l.getAttribute('href'),
    precedence: l.getAttribute('data-precedence'),
  }))

let container: HTMLElement
let root: Root | null

beforeEach(() => {
  run++
  SHOP_CSS = sheet('shop')
  ADS_CSS = sheet('ads')
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  container = document.createElement('div')
  document.body.appendChild(container)
  root = null
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
})

test('server render: one stylesheet link per href, ahead of the island markup', () => {
  const html = renderToString(<Page />)
  const links = [...html.matchAll(/<link[^>]*>/g)].map((m) => m[0])
  expect(links).toEqual([
    `<link rel="stylesheet" href="${SHOP_CSS}" data-precedence="next-federation"/>`,
    `<link rel="stylesheet" href="${ADS_CSS}" data-precedence="next-federation"/>`,
  ])
  expect(html.indexOf(SHOP_CSS)).toBeLessThan(html.indexOf('cart v1'))
})

test('client render (SPA): the stylesheets go to <head>, each href once', async () => {
  root = createRoot(container)
  await act(async () => root!.render(<Page />))
  expect(sheets(document.head)).toEqual([
    { href: SHOP_CSS, precedence: 'next-federation' },
    { href: ADS_CSS, precedence: 'next-federation' },
  ])
  expect(sheets(container)).toEqual([])
  expect(container.querySelectorAll('[data-nf-root]')).toHaveLength(3)
})

test('a link the host already has is reused, not added again', async () => {
  const existing = document.createElement('link')
  existing.rel = 'stylesheet'
  existing.href = SHOP_CSS
  existing.dataset.precedence = 'next-federation'
  document.head.appendChild(existing)
  root = createRoot(container)
  await act(async () => root!.render(<Page />))
  expect(sheets(document).map((s) => s.href)).toEqual([SHOP_CSS, ADS_CSS])
  expect(document.head.firstElementChild).toBe(existing)
})

test('hydration (Pages Router): server links are adopted, no recoverable error', async () => {
  container.innerHTML = renderToString(<Page />)
  const errors: unknown[] = []
  await act(async () => {
    root = hydrateRoot(container, <Page />, {
      onRecoverableError: (error) => errors.push(error),
    })
  })
  expect(errors).toEqual([])
  expect(sheets(document).map((s) => s.href)).toEqual([SHOP_CSS, ADS_CSS])
  expect(container.querySelectorAll('[data-nf-root]')).toHaveLength(3)
})

test('a new build adds its stylesheet next to the old one', async () => {
  const B2_CSS = sheet('shop-b2')
  root = createRoot(container)
  await act(async () =>
    root!.render(
      <IslandMount envelope={envelope()} loadBootstrap={loadBootstrap} />
    )
  )
  await act(async () =>
    root!.render(
      <IslandMount
        envelope={envelope({
          buildId: 'b2',
          css: [B2_CSS],
          bootstrap: 'https://shop.example.com/_nf/b2/bootstrap.js',
        })}
        loadBootstrap={loadBootstrap}
      />
    )
  )
  expect(sheets(document.head).map((s) => s.href)).toEqual([SHOP_CSS, B2_CSS])
})

test('duplicate hrefs in one envelope render one link, without a duplicate-key warning', async () => {
  const error = rs.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const twice = envelope({ css: [SHOP_CSS, SHOP_CSS, ADS_CSS] })
    const html = renderToString(
      <IslandMount envelope={twice} loadBootstrap={loadBootstrap} />
    )
    expect(html.split(SHOP_CSS).length - 1).toBe(1)
    root = createRoot(container)
    await act(async () =>
      root!.render(
        <IslandMount envelope={twice} loadBootstrap={loadBootstrap} />
      )
    )
    expect(sheets(document.head).map((s) => s.href)).toEqual([
      SHOP_CSS,
      ADS_CSS,
    ])
    expect(
      error.mock.calls.filter((c) => /same key/i.test(String(c[0])))
    ).toEqual([])
  } finally {
    error.mockRestore()
  }
})

describe('a stylesheet that never loads', () => {
  let server: Server
  let stalled: string
  beforeAll(async () => {
    // Accepts the request and never answers it.
    server = createServer(() => {})
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    stalled = `http://127.0.0.1:${(server.address() as AddressInfo).port}/s.css`
  })
  afterAll(async () => {
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
  })

  test('does not hold a client-side mount (a navigation transition) from committing', async () => {
    root = createRoot(container)
    await act(async () =>
      startTransition(() =>
        root!.render(
          <IslandMount
            envelope={envelope({ css: [`${stalled}?${run}`] })}
            loadBootstrap={loadBootstrap}
          />
        )
      )
    )
    expect(container.querySelectorAll('[data-nf-root]')).toHaveLength(1)
    // Still one stylesheet in <head>, in the island precedence group.
    expect(sheets(document.head)).toEqual([
      { href: `${stalled}?${run}`, precedence: 'next-federation' },
    ])
  })
})
