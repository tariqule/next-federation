import { act, useState } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, rs } from '@rstest/core'
import {
  Link,
  ROUTER_SHARE_NAME,
  ROUTER_VERSION,
  createRouterModule,
  provideRouter,
  useNavigate,
  usePathname,
  useSearchParams,
} from '../src/index.ts'
import type { LinkProps, RouterImpl } from '../src/index.ts'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const roots: Array<{ unmount(): void }> = []
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount())
  document.body.innerHTML = ''
  delete (globalThis as { navigation?: unknown }).navigation
  rs.restoreAllMocks()
})

function mount(node: React.ReactNode): HTMLElement {
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  roots.push(root)
  act(() => root.render(node))
  return el
}

const impl = (): RouterImpl & { calls: LinkProps[] } => {
  const calls: LinkProps[] = []
  return {
    calls,
    Link: (props) => {
      calls.push(props)
      return <span data-impl>{props.children}</span>
    },
    useNavigate: () => () => {},
    usePathname: () => '/x',
    useSearchParams: () => new URLSearchParams(),
  }
}

describe('document router', () => {
  it('Link renders <a href> with children and anchor attributes; replace/scroll/prefetch are not DOM attributes', () => {
    const err = rs.spyOn(console, 'error').mockImplementation(() => {})
    const el = mount(
      <Link href="/a" className="c" target="_blank" replace scroll prefetch>
        go
      </Link>
    )
    expect(err).not.toHaveBeenCalled()
    // String values would render as attributes if they leaked to the DOM.
    const el2 = mount(
      <Link
        href="/b"
        {...({ replace: 'x', scroll: 'y', prefetch: 'z' } as object)}
      >
        go
      </Link>
    )
    for (const n of ['replace', 'scroll', 'prefetch'])
      expect(el2.querySelector('a')!.hasAttribute(n)).toBe(false)
    const a = el.querySelector('a')!
    expect(a.getAttribute('href')).toBe('/a')
    expect(a.className).toBe('c')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.textContent).toBe('go')
    for (const n of ['replace', 'scroll', 'prefetch'])
      expect(a.hasAttribute(n)).toBe(false)
  })

  it('document Link does not call preventDefault on a left click', () => {
    const el = mount(<Link href="/a">go</Link>)
    const a = el.querySelector('a')!
    const ev = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    a.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
  })

  it('document useNavigate calls location.assign, or location.replace with { replace: true }', () => {
    const assign = rs.fn()
    const replace = rs.fn()
    rs.spyOn(window, 'location', 'get').mockReturnValue({
      assign,
      replace,
      pathname: '/',
      search: '',
      href: 'http://localhost:3000/',
      origin: 'http://localhost:3000',
    } as unknown as Location)
    let nav!: ReturnType<typeof useNavigate>
    function C() {
      nav = useNavigate()
      return null
    }
    mount(<C />)
    nav('/one')
    expect(assign).toHaveBeenCalledWith('/one')
    nav('/two', { replace: true })
    expect(replace).toHaveBeenCalledWith('/two')
    expect(assign).toHaveBeenCalledTimes(1)
  })

  it('usePathname/useSearchParams update on popstate', () => {
    history.replaceState(null, '', '/a?x=1')
    function C() {
      return (
        <p>
          {usePathname()}|{useSearchParams().get('x')}
        </p>
      )
    }
    const el = mount(<C />)
    expect(el.textContent).toBe('/a|1')
    act(() => {
      history.pushState(null, '', '/b?x=2')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(el.textContent).toBe('/b|2')
  })

  it('useSearchParams memoises per search string', async () => {
    history.replaceState(null, '', '/a?x=1')
    const seen: URLSearchParams[] = []
    let bump!: () => void
    function C() {
      const [, set] = useState(0)
      bump = () => set((n) => n + 1)
      seen.push(useSearchParams() as URLSearchParams)
      return null
    }
    mount(<C />)
    act(() => bump())
    expect(seen.length).toBeGreaterThan(1)
    expect(seen[seen.length - 1]).toBe(seen[0])
    const before = seen.length
    act(() => {
      history.pushState(null, '', '/a?x=2')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(seen.length).toBeGreaterThan(before)
    expect(seen[seen.length - 1]).not.toBe(seen[0])
    expect(seen.at(-1)!.get('x')).toBe('2')
  })

  it('usePathname updates on a navigation currententrychange event when globalThis.navigation exists', () => {
    history.replaceState(null, '', '/a')
    const nav = new EventTarget()
    ;(globalThis as { navigation?: unknown }).navigation = nav
    function C() {
      return <p>{usePathname()}</p>
    }
    const el = mount(<C />)
    expect(el.textContent).toBe('/a')
    act(() => {
      history.pushState(null, '', '/c')
      nav.dispatchEvent(new Event('currententrychange'))
    })
    expect(el.textContent).toBe('/c')
  })

  it("server render gives '' and empty params; hydrating logs no console.error and then shows the real path", async () => {
    history.replaceState(null, '', '/real?q=1')
    function C() {
      return (
        <p>
          [{usePathname()}][{useSearchParams().toString()}]
        </p>
      )
    }
    const html = renderToString(<C />)
    expect(html).toContain('[<!-- -->]')
    expect(html).not.toContain('/real')
    const err = rs.spyOn(console, 'error').mockImplementation(() => {})
    const el = document.createElement('div')
    el.innerHTML = html
    document.body.append(el)
    let root!: ReturnType<typeof hydrateRoot>
    await act(async () => {
      root = hydrateRoot(el, <C />)
    })
    roots.push(root)
    expect(err).not.toHaveBeenCalled()
    expect(el.textContent).toBe('[/real][q=1]')
  })
})

describe('createRouterModule', () => {
  it.each([
    'https://a.example/x',
    'mailto:a@b.c',
    '//cdn.example/x',
    ' https://a.example/x',
    '\thttps://a.example/x',
    '\n //cdn.example/x',
    '/\\cdn.example/x',
    '\\\\cdn.example/x',
    '\\/cdn.example/x',
  ])(
    'createRouterModule: %j renders a plain <a> and never impl.Link',
    (href) => {
      const i = impl()
      const { Link: L } = createRouterModule(i)
      const err = rs.spyOn(console, 'error').mockImplementation(() => {})
      const el = mount(
        <L href={href} replace scroll prefetch>
          x
        </L>
      )
      expect(err).not.toHaveBeenCalled()
      expect(el.querySelector('a')!.getAttribute('href')).toBe(href)
      expect(el.querySelector('[data-impl]')).toBeNull()
      expect(i.calls).toHaveLength(0)
    }
  )

  it('createRouterModule: an internal href renders impl.Link with href, replace, scroll, prefetch', () => {
    const i = impl()
    const { Link: L } = createRouterModule(i)
    mount(
      <L href="/in" replace scroll={false} prefetch>
        x
      </L>
    )
    expect(i.calls[0]).toMatchObject({
      href: '/in',
      replace: true,
      scroll: false,
      prefetch: true,
    })
  })

  it('passes the other impl members through by identity; useNavigate wraps the impl navigate (same-origin check)', () => {
    const i = impl()
    const calls: unknown[][] = []
    i.useNavigate =
      () =>
      (...args) =>
        void calls.push(args)
    const mod = createRouterModule(i)
    expect(mod.usePathname).toBe(i.usePathname)
    expect(mod.useSearchParams).toBe(i.useSearchParams)
    let nav!: ReturnType<typeof mod.useNavigate>
    function C() {
      nav = mod.useNavigate()
      return null
    }
    mount(<C />)
    nav('/a', { replace: true, scroll: false })
    expect(calls).toEqual([['/a', { replace: true, scroll: false }]])
  })

  it('provideRouter registers ROUTER_SHARE_NAME with ROUTER_VERSION', () => {
    const mod = createRouterModule(impl())
    const register = rs.fn()
    provideRouter(mod, register)
    expect(register).toHaveBeenCalledWith({
      [ROUTER_SHARE_NAME]: { version: ROUTER_VERSION, module: mod },
    })
    expect(ROUTER_SHARE_NAME).toBe('@next-federation/router')
  })
})
