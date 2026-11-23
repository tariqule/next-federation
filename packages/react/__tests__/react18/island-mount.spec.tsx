import { StrictMode, act, version } from 'react'
import type { ReactElement } from 'react'
import { createRoot, hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import type {
  IslandBootstrapModule,
  IslandEnvelope,
} from '@next-federation/protocol'
import { IslandMount } from '../../src/island-mount.tsx'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// Runs on React 18.3.1 (the `dom-react18` project in rstest.config.ts), for
// this spec and the library source it imports.

const PLACEHOLDER = 'nfid-1a2b3c4d'
const CSS = '/x.css'

function envelope(over: Partial<IslandEnvelope> = {}): IslandEnvelope {
  return {
    protocolVersion: 1,
    remote: 'shop',
    buildId: 'b1',
    mode: 'development',
    html: `<p id="${PLACEHOLDER}:r0:">cart v1</p>`,
    rscPayload: `0:["${PLACEHOLDER}:r0:","v1"]`,
    css: [CSS],
    bootstrap: 'https://shop.example.com/_nf/b1/bootstrap.js',
    reactVersion: '19.3.1',
    idPlaceholder: PLACEHOLDER,
    ...over,
  }
}

// The bootstrap never resolves: these specs stop at the host-side mount.
const loadBootstrap = (): Promise<IslandBootstrapModule> =>
  new Promise(() => {})

const headLinks = (href = CSS) =>
  [...document.head.querySelectorAll('link[rel="stylesheet"]')].filter(
    (l) => l.getAttribute('href') === href
  )

/** Server HTML on React 18; its server-only warnings are not under test. */
function serverHtml(element: ReactElement): string {
  const error = rs.spyOn(console, 'error').mockImplementation(() => {})
  try {
    return renderToString(element)
  } finally {
    error.mockRestore()
  }
}

let container: HTMLElement
let root: Root | null

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  container = document.createElement('div')
  document.body.appendChild(container)
  root = null
})

afterEach(() => {
  if (root) act(() => root!.unmount())
})

it('runs on React 18', () => {
  expect(version).toBe('18.3.1')
})

it('client mount: the head link exists before the bootstrap import is called', () => {
  const linksAtImport: number[] = []
  const load = rs.fn((): Promise<IslandBootstrapModule> => {
    linksAtImport.push(headLinks().length)
    return new Promise(() => {})
  })
  act(() => {
    root = createRoot(container)
    root.render(<IslandMount envelope={envelope()} loadBootstrap={load} />)
  })
  expect(load).toHaveBeenCalledTimes(1)
  expect(linksAtImport).toEqual([1])
  const [link] = headLinks()
  expect(link!.getAttribute('data-precedence')).toBe('next-federation')
  expect(link!.getAttribute('data-nf-css')).toBe('')
  // Nothing inline: the head link is the only one.
  expect(container.querySelectorAll('link')).toHaveLength(0)
  expect(container.querySelector('[data-nf-root]')?.textContent).toBe('cart v1')
})

it('server render emits an inline link before the root', () => {
  const html = serverHtml(
    <IslandMount envelope={envelope()} loadBootstrap={loadBootstrap} />
  )
  expect(html).toMatch(
    /<link rel="stylesheet" href="\/x.css" data-precedence="next-federation"\/?><div[^>]*data-nf-root/
  )
})

it('hydrating the server HTML logs no console.error, and adds a head copy', () => {
  const page = (
    <IslandMount envelope={envelope()} loadBootstrap={loadBootstrap} />
  )
  container.innerHTML = serverHtml(page)
  expect(headLinks()).toHaveLength(0)
  const recoverable: unknown[] = []
  const error = rs.spyOn(console, 'error').mockImplementation(() => {})
  try {
    act(() => {
      root = hydrateRoot(container, page, {
        onRecoverableError: (e) => recoverable.push(e),
      })
    })
    // happy-dom reports each stylesheet it is not set up to load (the head
    // copy) on console.error; that one is the test DOM's, not React's.
    const logged = error.mock.calls
      .map((args) => String(args[0]))
      .filter((m) => !/^NotSupportedError: Failed to load external/.test(m))
    expect(logged).toEqual([])
  } finally {
    error.mockRestore()
  }
  expect(recoverable).toEqual([])
  // The server's inline link is adopted, and a head copy outlives it.
  expect(container.querySelectorAll(`link[href="${CSS}"]`)).toHaveLength(1)
  const [copy] = headLinks()
  expect(headLinks()).toHaveLength(1)
  expect(copy!.getAttribute('data-precedence')).toBe('next-federation')
  expect(copy!.getAttribute('data-nf-css')).toBe('')
  expect(container.querySelector('[data-nf-root]')?.textContent).toBe('cart v1')
})

it('StrictMode client mount: one head link, bootstrap imported once', () => {
  const load = rs.fn(loadBootstrap)
  act(() => {
    root = createRoot(container)
    root.render(
      <StrictMode>
        <IslandMount envelope={envelope()} loadBootstrap={load} />
      </StrictMode>
    )
  })
  expect(headLinks()).toHaveLength(1)
  expect(load).toHaveBeenCalledTimes(1)
  expect(container.querySelectorAll('[data-nf-root]')).toHaveLength(1)
})

it('one of two islands with the same css unmounts: the head link stays', () => {
  function Page({ first }: { first: boolean }) {
    return (
      <main>
        {first ? (
          <IslandMount
            key="a"
            envelope={envelope()}
            loadBootstrap={loadBootstrap}
          />
        ) : null}
        <IslandMount
          key="b"
          envelope={envelope({ remote: 'cart' })}
          loadBootstrap={loadBootstrap}
        />
      </main>
    )
  }
  act(() => {
    root = createRoot(container)
    root.render(<Page first />)
  })
  expect(headLinks()).toHaveLength(1)
  act(() => root!.render(<Page first={false} />))
  expect(container.querySelectorAll('[data-nf-root]')).toHaveLength(1)
  expect(headLinks()).toHaveLength(1)
  expect(headLinks()[0]!.isConnected).toBe(true)
})
