// `@next-federation/router` on a React 18 host: the document router (the copy
// a remote bundles) server-renders, then hydrates without a mismatch, and a
// host router module provided with createRouterModule renders its own Link.
// Runs on React 18.3.1 (the `dom-react18` project in rstest.config.ts), for
// this spec and the library source it imports.
import { act, version } from 'react'
import type { ReactNode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import {
  Link,
  createRouterModule,
  useNavigate,
  usePathname,
  useSearchParams,
} from '../../src/index.ts'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount())
  document.body.innerHTML = ''
  history.replaceState(null, '', '/')
  rs.restoreAllMocks()
})

function RouterLink(): ReactNode {
  return (
    <span>
      <Link href="/router/next" data-testid="link">
        next
      </Link>
      <output data-testid="pathname">{usePathname()}</output>
    </span>
  )
}

test('the lane runs React 18.3.1', () => {
  expect(version).toBe('18.3.1')
})

test('Link and usePathname render and hydrate on React 18.3.1', () => {
  const html = renderToString(<RouterLink />)
  expect(html).toContain('href="/router/next"')
  // The server knows no location: an empty pathname.
  expect(html).toContain('<output data-testid="pathname"></output>')

  history.replaceState(null, '', '/router/static?q=1')
  const el = document.createElement('div')
  el.innerHTML = html
  document.body.append(el)
  const anchor = el.querySelector('a')
  const errors: unknown[] = []
  const consoleError = rs.spyOn(console, 'error').mockImplementation(() => {})
  act(() => {
    roots.push(
      hydrateRoot(el, <RouterLink />, {
        onRecoverableError: (error) => errors.push(error),
      })
    )
  })
  expect(errors).toEqual([])
  expect(consoleError).not.toHaveBeenCalled()
  // Hydrated in place (the server's <a> is kept), then the client pathname.
  expect(el.querySelector('a')).toBe(anchor)
  expect(el.querySelector('a')!.getAttribute('href')).toBe('/router/next')
  expect(el.querySelector('output')!.textContent).toBe('/router/static')

  // A host router (pushState) updates it on popstate.
  act(() => {
    history.pushState(null, '', '/router/next')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  expect(el.querySelector('output')!.textContent).toBe('/router/next')
})

test('useSearchParams and useNavigate on React 18', () => {
  history.replaceState(null, '', '/s?q=shoes')
  let q: string | null = null
  let navigate: ReturnType<typeof useNavigate> | undefined
  function Probe(): null {
    q = useSearchParams().get('q')
    navigate = useNavigate()
    return null
  }
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  roots.push(root)
  act(() => root.render(<Probe />))
  expect(q).toBe('shoes')
  expect(typeof navigate).toBe('function')
})

test("a host's router module (createRouterModule) renders its own Link on React 18", () => {
  const module = createRouterModule({
    Link: ({ href, children }) => (
      <a data-host-link="" href={`/rr${href}`}>
        {children}
      </a>
    ),
    useNavigate: () => () => {},
    usePathname: () => '/router/next',
    useSearchParams: () => new URLSearchParams(),
  })
  const html = renderToString(
    <>
      <module.Link href="/router/next">in</module.Link>
      <module.Link href="https://example.com/">out</module.Link>
    </>
  )
  expect(html).toContain('<a data-host-link="" href="/rr/router/next">in</a>')
  // External: a plain anchor, never the host's Link.
  expect(html).toContain('<a href="https://example.com/">out</a>')
})
