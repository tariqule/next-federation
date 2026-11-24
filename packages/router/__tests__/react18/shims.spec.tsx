// The shims a remote build gets for `next/link`, `next/navigation` and
// `react-router`, on React 18.3.1 (the `dom-react18` project): server render,
// then hydrate without a mismatch; a React Router link inside the remote's
// own MemoryRouter still routes there.
import { act, createRef, version } from 'react'
import type { ReactNode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import NextLink from '../../src/shims/next-link.tsx'
import { usePathname } from '../../src/shims/next-navigation.ts'
import {
  Link as RouterLink,
  MemoryRouter,
  Route,
  Routes,
} from '../../src/shims/react-router.tsx'
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

function Remote(): ReactNode {
  return (
    <div>
      <NextLink href={{ pathname: '/p', query: { id: '1' } }} id="next">
        next
      </NextLink>
      <output id="pathname">{usePathname()}</output>
      <RouterLink to="/outside" id="outside">
        outside
      </RouterLink>
      <MemoryRouter initialEntries={['/one']}>
        <Routes>
          <Route
            path="/one"
            element={
              <RouterLink to="/two" id="inside">
                two
              </RouterLink>
            }
          />
          <Route path="/two" element={<p id="two">two</p>} />
        </Routes>
      </MemoryRouter>
    </div>
  )
}

test('the lane runs React 18.3.1', () => {
  expect(version).toBe('18.3.1')
})

test('next and react-router shims render and hydrate on React 18.3.1', () => {
  const html = renderToString(<Remote />)
  expect(html).toContain('href="/p?id=1"')
  expect(html).toContain('href="/outside"')
  expect(html).toContain('href="/two"')
  // The server knows no location.
  expect(html).toContain('<output id="pathname"></output>')

  history.replaceState(null, '', '/page')
  const el = document.createElement('div')
  el.innerHTML = html
  document.body.append(el)
  const outside = el.querySelector('#outside')
  const errors: unknown[] = []
  const consoleError = rs.spyOn(console, 'error').mockImplementation(() => {})
  act(() => {
    roots.push(
      hydrateRoot(el, <Remote />, {
        onRecoverableError: (error) => errors.push(error),
      })
    )
  })
  expect(errors).toEqual([])
  expect(consoleError).not.toHaveBeenCalled()
  expect(el.querySelector('#outside')).toBe(outside)
  expect(el.querySelector('#pathname')!.textContent).toBe('/page')

  // Inside the remote's own router: React Router's Link, routed there.
  const click = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
  })
  act(() => void el.querySelector('#inside')!.dispatchEvent(click))
  expect(click.defaultPrevented).toBe(true)
  expect(el.querySelector('#two')!.textContent).toBe('two')
  expect(location.pathname).toBe('/page')
})

test('React 18: a ref on Link, or on its legacyBehavior child, is not forwarded (React warns for the first)', () => {
  const ref = createRef<HTMLAnchorElement>()
  const childRef = createRef<HTMLAnchorElement>()
  const consoleError = rs.spyOn(console, 'error').mockImplementation(() => {})
  const el = document.createElement('div')
  document.body.append(el)
  act(() => {
    const root = createRoot(el)
    roots.push(root)
    root.render(
      <>
        <NextLink
          href="/r"
          // React 18 types have no `ref` on a function component's props.
          {...({ ref } as object)}
          id="link"
        >
          r
        </NextLink>
        <NextLink href="/c" legacyBehavior>
          <a ref={childRef} id="child">
            c
          </a>
        </NextLink>
      </>
    )
  })
  expect(el.querySelector('#link')!.getAttribute('href')).toBe('/r')
  expect(el.querySelector('#child')!.getAttribute('href')).toBe('/c')
  expect(ref.current).toBeNull()
  expect(childRef.current).toBeNull()
  expect(String(consoleError.mock.calls[0]?.[0])).toContain(
    'Function components cannot be given refs'
  )
})
