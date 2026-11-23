// The same-origin check on every navigation: the document router's
// navigate, every router module's useNavigate (createRouterModule) and the
// host Link's click (navigationModule).
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, rs } from '@rstest/core'
import { navigationModule } from '../src/host-navigation.tsx'
import { createRouterModule, useNavigate } from '../src/index.ts'
import type { Navigate } from '../src/index.ts'
import { localHref, sameOriginHref } from '../src/safe-href.ts'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

/** Hrefs that leave the page's origin, or run script. */
const UNSAFE = [
  'javascript:alert(1)',
  ' \u0001javascript:alert(1)',
  'java\tscript:alert(1)',
  'JAVASCRIPT:alert(1)',
  '//evil.example',
  '/\t/evil.example',
  '/\n/evil.example',
  '\\\\evil.example',
  '/\\evil.example',
  'https://evil.example/',
  'http://evil.example/',
  'data:text/html,x',
  'mailto:a@b.example',
]

const roots: Array<{ unmount(): void }> = []
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount())
  document.body.innerHTML = ''
  history.replaceState(null, '', '/')
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

function capture(useHook: () => Navigate): Navigate {
  let navigate!: Navigate
  function C() {
    navigate = useHook()
    return null
  }
  mount(<C />)
  return navigate
}

describe('sameOriginHref and localHref', () => {
  it('accepts only http(s) on the page origin; returns the href as the browser reads it', () => {
    for (const href of UNSAFE) expect(sameOriginHref(href), href).toBeNull()
    expect(sameOriginHref('/a?b=1#c')).toBe('/a?b=1#c')
    expect(sameOriginHref('?q=1')).toBe('?q=1')
    expect(sameOriginHref('rel')).toBe('rel')
    expect(sameOriginHref('/a\tb')).toBe('/ab')
    expect(sameOriginHref(`${location.origin}/x`)).toBe(`${location.origin}/x`)
    expect(sameOriginHref(42)).toBeNull()
  })

  it('localHref: a path, query or fragment (no scheme, no authority); the same answer without a page', () => {
    for (const href of UNSAFE) {
      expect(localHref(href), href).toBeNull()
    }
    expect(localHref('/a?b')).toBe('/a?b')
    expect(localHref('?q=1')).toBe('?q=1')
  })
})

describe('every navigate path drops hrefs that leave the origin', () => {
  function stubLocation() {
    const assign = rs.fn()
    const replace = rs.fn()
    const original = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new Proxy(original, {
        get: (target, key) =>
          key === 'assign'
            ? assign
            : key === 'replace'
              ? replace
              : Reflect.get(target, key),
      }),
    })
    return {
      assign,
      replace,
      restore: () =>
        Object.defineProperty(window, 'location', {
          configurable: true,
          value: original,
        }),
    }
  }

  it('the document navigate (no host router)', () => {
    const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
    const loc = stubLocation()
    try {
      const navigate = capture(useNavigate)
      for (const href of UNSAFE) {
        navigate(href)
        navigate(href, { replace: true })
      }
      expect(loc.assign).not.toHaveBeenCalled()
      expect(loc.replace).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalled()
      navigate('/ok')
      navigate('/\tok', { replace: true })
      expect(loc.assign.mock.calls).toEqual([['/ok']])
      expect(loc.replace.mock.calls).toEqual([['/ok']])
    } finally {
      loc.restore()
    }
  })

  it("a host router module's useNavigate (createRouterModule)", () => {
    rs.spyOn(console, 'warn').mockImplementation(() => {})
    const impl = rs.fn()
    const mod = createRouterModule({
      Link: () => null,
      useNavigate: () => impl,
      usePathname: () => '/',
      useSearchParams: () => new URLSearchParams(),
    })
    const navigate = capture(mod.useNavigate)
    for (const href of UNSAFE) navigate(href, { replace: true })
    expect(impl).not.toHaveBeenCalled()
    navigate('/ok', { scroll: false })
    expect(impl.mock.calls).toEqual([['/ok', { scroll: false }]])
  })

  it("the host Link (navigationModule): a click on an href that leaves the origin is the browser's, never the host navigate", () => {
    const navigate = rs.fn()
    const mod = navigationModule({ useNavigate: () => navigate })
    const el = mount(
      <>
        <mod.Link href={'/\t/evil.example'} id="tab">
          tab
        </mod.Link>
        <mod.Link href="/ok" id="ok">
          ok
        </mod.Link>
      </>
    )
    const click = (id: string) => {
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
      })
      act(() => void el.querySelector(id)!.dispatchEvent(event))
      return event
    }
    expect(click('#tab').defaultPrevented).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
    expect(click('#ok').defaultPrevented).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/ok', {
      replace: undefined,
      scroll: undefined,
    })
  })
})
