// The shim a remote build gets for `react-router` and `react-router-dom`.
// `@next-federation/router` is a host's module here (navigationModule with a
// spy navigate), as a host's `provideNavigation` registers it.
import { act, createRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, rs } from '@rstest/core'
import * as shim from '../src/shims/react-router.tsx'
import {
  Link,
  MemoryRouter,
  NavLink,
  Route,
  Routes,
  useHref,
  useLocation,
  useNavigate,
  useSearchParams,
} from '../src/shims/react-router.tsx'
import type { NavigateFunction } from '../src/shims/react-router.tsx'

import { navigationModule } from '../src/host-navigation.tsx'
// Not through '../src/index.ts' (mocked below as `@next-federation/router`).
import { createRouterModule } from '../src/create-router-module.tsx'
import type { LinkProps, RouterModule } from '../src/index.ts'
import NextLink from '../src/shims/next-link.tsx'
import { UNSAFE_LINKS, isScriptHref } from './helpers/unsafe-links.ts'

// The shim's `@next-federation/router`: delegates to `host.module`, set below.
const host = rs.hoisted(() => ({
  navigate: rs.fn(),
  module: null as RouterModule | null,
}))
rs.mock('@next-federation/router', () => ({
  Link: (props: LinkProps) =>
    (host.module!.Link as (props: LinkProps) => ReactNode)(props),
  useNavigate: () => host.module!.useNavigate(),
  usePathname: () => host.module!.usePathname(),
  useSearchParams: () => host.module!.useSearchParams(),
}))
host.module = navigationModule({ useNavigate: () => host.navigate })
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

/** Hrefs that leave the page's origin, or run script. */
const UNSAFE = [
  'javascript:alert(1)',
  ' \u0001javascript:alert(1)',
  'java\tscript:alert(1)',
  '//evil.example',
  '/\t/evil.example',
  '\\\\evil.example',
  '/\\evil.example',
  'https://evil.example/',
]

const roots: Array<{ unmount(): void }> = []
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount())
  document.body.innerHTML = ''
  history.replaceState(null, '', '/')
  host.navigate.mockReset()
  rs.restoreAllMocks()
})

function mount(node: ReactNode): HTMLElement {
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  roots.push(root)
  act(() => root.render(node))
  return el
}

function click(a: Element): MouseEvent {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
  })
  act(() => {
    a.dispatchEvent(event)
  })
  return event
}

describe('react-router shim', () => {
  it('inside MemoryRouter: Link, useNavigate, useLocation are the real ones (route changes, host navigate not called)', () => {
    let navigate: NavigateFunction | null = null
    function Page({ name }: { name: string }) {
      navigate = useNavigate()
      return <p id="page">{`${name} ${useLocation().pathname}`}</p>
    }
    const el = mount(
      <MemoryRouter initialEntries={['/one']}>
        <Link to="/two" id="go">
          two
        </Link>
        <Routes>
          <Route path="/one" element={<Page name="one" />} />
          <Route path="/two" element={<Page name="two" />} />
          <Route path="/three" element={<Page name="three" />} />
        </Routes>
      </MemoryRouter>
    )
    expect(el.querySelector('#page')!.textContent).toBe('one /one')
    const event = click(el.querySelector('#go')!)
    expect(event.defaultPrevented).toBe(true)
    expect(el.querySelector('#page')!.textContent).toBe('two /two')
    act(() => void navigate!('/three'))
    expect(el.querySelector('#page')!.textContent).toBe('three /three')
    expect(host.navigate).not.toHaveBeenCalled()
    // The document never moved either.
    expect(location.pathname).toBe('/')
  })

  it('outside a router: Link renders <a href> from the host module and a click calls host navigate', () => {
    const el = mount(
      <Link to="/x?y=1" className="c" replace>
        x
      </Link>
    )
    const a = el.querySelector('a')!
    expect(a.getAttribute('href')).toBe('/x?y=1')
    expect(a.className).toBe('c')
    expect(a.hasAttribute('replace')).toBe(false)
    const event = click(a)
    expect(event.defaultPrevented).toBe(true)
    expect(host.navigate).toHaveBeenCalledWith('/x?y=1', {
      replace: true,
      scroll: true,
    })
    // `to` as an object, preventScrollReset.
    const el2 = mount(
      <Link
        to={{ pathname: '/p', search: '?q=1', hash: '#h' }}
        preventScrollReset
      >
        p
      </Link>
    )
    click(el2.querySelector('a')!)
    expect(host.navigate).toHaveBeenLastCalledWith('/p?q=1#h', {
      replace: undefined,
      scroll: false,
    })
  })

  it('NavLink outside a router sets aria-current on the active path', () => {
    history.replaceState(null, '', '/orders/7')
    const el = mount(
      <>
        <NavLink
          to="/orders"
          id="orders"
          className={({ isActive, isPending }) =>
            `${isActive ? 'on' : 'off'} ${isPending ? 'pending' : 'idle'}`
          }
          style={({ isActive }) => ({ fontWeight: isActive ? 700 : 400 })}
        >
          {({ isActive }) => (isActive ? 'Orders (here)' : 'Orders')}
        </NavLink>
        <NavLink to="/orders" end id="orders-end">
          end
        </NavLink>
        <NavLink to="/cart" id="cart">
          cart
        </NavLink>
      </>
    )
    const orders = el.querySelector('#orders')!
    expect(orders.getAttribute('aria-current')).toBe('page')
    expect(orders.className).toBe('on idle')
    expect((orders as HTMLElement).style.fontWeight).toBe('700')
    expect(orders.textContent).toBe('Orders (here)')
    expect(el.querySelector('#orders-end')!.hasAttribute('aria-current')).toBe(
      false
    )
    expect(el.querySelector('#cart')!.hasAttribute('aria-current')).toBe(false)
    click(el.querySelector('#cart')!)
    expect(host.navigate).toHaveBeenCalledWith('/cart', {
      replace: undefined,
      scroll: true,
    })
  })

  it('useNavigate(-1) calls history.go(-1); useNavigate(to, options) calls host navigate', () => {
    const go = rs.spyOn(history, 'go').mockImplementation(() => {})
    let navigate: NavigateFunction | null = null
    function Probe() {
      navigate = useNavigate()
      return null
    }
    mount(<Probe />)
    act(() => void navigate!(-1))
    expect(go).toHaveBeenCalledWith(-1)
    act(() => void navigate!('/a', { replace: true, preventScrollReset: true }))
    expect(host.navigate).toHaveBeenCalledWith('/a', {
      replace: true,
      scroll: false,
    })
  })

  it('useSearchParams setter navigates to ?q=2; useLocation gives pathname and search', () => {
    history.replaceState(null, '', '/list?q=1')
    let set: ReturnType<typeof useSearchParams>[1] | null = null
    function Probe() {
      const [params, setParams] = useSearchParams()
      const location = useLocation()
      set = setParams
      return (
        <p>{`${params.get('q')} ${location.pathname} ${location.search} ${location.key}`}</p>
      )
    }
    const el = mount(<Probe />)
    expect(el.textContent).toBe('1 /list ?q=1 default')
    act(() => set!({ q: '2' }))
    expect(host.navigate).toHaveBeenCalledWith('?q=2', {
      replace: undefined,
      scroll: true,
    })
    act(() => set!((prev) => (prev.set('page', '3'), prev), { replace: true }))
    expect(host.navigate).toHaveBeenLastCalledWith('?q=1&page=3', {
      replace: true,
      scroll: true,
    })
  })

  it('useNavigate outside a router drops hrefs that leave the origin (host navigate never called)', () => {
    const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
    let navigate: NavigateFunction | null = null
    function Probe() {
      navigate = useNavigate()
      return null
    }
    mount(<Probe />)
    for (const to of UNSAFE) {
      act(() => void navigate!(to))
      act(() => void navigate!(to, { replace: true }))
    }
    act(() => void navigate!({ pathname: '//evil.example' }))
    expect(host.navigate).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    act(() => void navigate!('/ok'))
    expect(host.navigate).toHaveBeenCalledWith('/ok', {
      replace: undefined,
      scroll: true,
    })
  })

  it('useHref outside a router: a path stays as it is; a value that leaves the origin becomes / plus the value', () => {
    const hrefs: string[] = []
    function Probe({ to }: { to: string }) {
      hrefs.push(useHref(to))
      return null
    }
    const cases = ['/a?b=1#c', '?q=1', ...UNSAFE]
    mount(
      <>
        {cases.map((to) => (
          <Probe key={to} to={to} />
        ))}
      </>
    )
    expect(hrefs.slice(0, 2)).toEqual(['/a?b=1#c', '?q=1'])
    for (const [i, href] of hrefs.slice(2).entries()) {
      // Always a path on this origin, never the raw value.
      expect(href, cases[i + 2]).toMatch(/^\/(?![\\/])/)
      expect(new URL(href, location.href).origin, cases[i + 2]).toBe(
        location.origin
      )
    }
    expect(hrefs[2]).toBe('/javascript:alert(1)')
    expect(hrefs[cases.indexOf('//evil.example')]).toBe('/evil.example')
  })

  it("useSearchParams outside a router returns a URLSearchParams the remote may change, even when the host's is read-only", () => {
    const original = host.module
    const readOnly = new URLSearchParams('q=1')
    readOnly.set = () => {
      throw new Error('read-only')
    }
    host.module = {
      ...original!,
      useSearchParams: () => readOnly,
    }
    try {
      let params: URLSearchParams | null = null
      const seen: URLSearchParams[] = []
      function Probe() {
        params = useSearchParams()[0]
        seen.push(params)
        return null
      }
      const el = mount(<Probe />)
      expect(params!.get('q')).toBe('1')
      expect(() => params!.set('q', '2')).not.toThrow()
      expect(params!.get('q')).toBe('2')
      // Memoised per search string: the same object on a re-render.
      act(() => {
        roots.at(-1)!.unmount()
        roots.pop()
      })
      el.remove()
      const root = createRoot(document.createElement('div'))
      roots.push(root)
      let rerender: () => void = () => {}
      function Twice() {
        const [, force] = useState(0)
        rerender = () => force((n) => n + 1)
        seen.push(useSearchParams()[0])
        return null
      }
      seen.length = 0
      act(() => root.render(<Twice />))
      act(() => rerender())
      expect(seen).toHaveLength(2)
      expect(seen[0]).toBe(seen[1])
    } finally {
      host.module = original
    }
  })

  it("unsafe hrefs never reach the host's Link through React Router's Link/NavLink outside a router or the next/link shim (href, as, legacyBehavior)", () => {
    const original = host.module
    const rendered: string[] = []
    host.module = createRouterModule({
      Link: (props: LinkProps) => {
        rendered.push(props.href)
        return <a data-impl href={props.href} />
      },
      useNavigate: () => host.navigate,
      usePathname: () => '/',
      useSearchParams: () => new URLSearchParams(),
    })
    try {
      for (const href of UNSAFE_LINKS) {
        const el = mount(
          <>
            <Link to={href}>rr</Link>
            <NavLink to={href}>nav</NavLink>
            <Link to={href} reloadDocument>
              rr reload
            </Link>
            <NavLink to={href} reloadDocument>
              nav reload
            </NavLink>
            <NextLink href={href}>next</NextLink>
            <NextLink href="/post/[pid]" as={href}>
              as
            </NextLink>
            <NextLink href={href} legacyBehavior>
              <a className="legacy">legacy</a>
            </NextLink>
          </>
        )
        const anchors = [...el.querySelectorAll('a')]
        expect(anchors, href).toHaveLength(7)
        for (const a of anchors) {
          expect(a.hasAttribute('data-impl'), href).toBe(false)
          expect(isScriptHref(a.getAttribute('href')), href).toBe(false)
        }
      }
      expect(rendered).toEqual([])
      expect(host.navigate).not.toHaveBeenCalled()
      // A local href is the host's Link.
      mount(<Link to="/ok">ok</Link>)
      expect(rendered).toEqual(['/ok'])
      // reloadDocument with a local href: a plain anchor that keeps it.
      const reload = mount(
        <>
          <Link to="/reload?x=1" reloadDocument>
            r
          </Link>
          <NavLink to="/reload" reloadDocument>
            n
          </NavLink>
        </>
      )
      expect(
        [...reload.querySelectorAll('a')].map((a) => [
          a.getAttribute('href'),
          a.hasAttribute('data-impl'),
        ])
      ).toEqual([
        ['/reload?x=1', false],
        ['/reload', false],
      ])
      expect(rendered).toEqual(['/ok'])
    } finally {
      host.module = original
    }
  })

  it("React 19: a ref on next/link's Link, or on its legacyBehavior child, reaches the <a> the host's Link renders", () => {
    const ref = createRef<HTMLAnchorElement>()
    const childRef = createRef<HTMLAnchorElement>()
    const el = mount(
      <>
        <NextLink
          href="/r"
          // No `ref` in the shim's props type (remotes type-check against
          // next/link's own types).
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
    expect(ref.current).toBe(el.querySelector('#link'))
    expect(childRef.current).toBe(el.querySelector('#child'))
    expect(el.querySelectorAll('a')).toHaveLength(2)
  })

  it('export * keeps createMemoryRouter, Routes, Outlet available', () => {
    for (const name of [
      'createMemoryRouter',
      'RouterProvider',
      'Routes',
      'Route',
      'Outlet',
      'MemoryRouter',
      'useParams',
      'useInRouterContext',
    ]) {
      expect(typeof (shim as Record<string, unknown>)[name], name).not.toBe(
        'undefined'
      )
    }
  })
})
