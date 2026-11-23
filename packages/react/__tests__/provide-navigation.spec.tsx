// `provideNavigation`: a host gives remote components its router's hooks;
// they get them as the shared `@next-federation/router` module.
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, rs } from '@rstest/core'
import {
  BrowserRouter,
  Route,
  Routes,
  useHref,
  useLocation,
  useNavigate,
} from 'react-router'
import { ROUTER_VERSION } from '@next-federation/router'
import type { RouterModule } from '@next-federation/router'
import * as runtimeModule from '../src/components/runtime.ts'
import type { SharedModules } from '../src/components/runtime.ts'
import { provideNavigation } from '../src/components/index.tsx'

// The components runtime, its exports wrapped in spies (same behaviour).
rs.mock('../src/components/runtime.ts', { spy: true })
// The runtime `@next-federation/react/components` created at load.
const runtime = rs.mocked(runtimeModule.createComponentRuntime).mock.results[0]!
  .value as { registerShared(shared: SharedModules): void }
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

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

/** The router module a provideNavigation call registers. */
function provided(hooks: Parameters<typeof provideNavigation>[0]) {
  const registerShared = rs.spyOn(runtime, 'registerShared')
  provideNavigation(hooks)
  expect(registerShared).toHaveBeenCalledTimes(1)
  const shared = registerShared.mock.calls[0]![0]
  expect(Object.keys(shared)).toEqual(['@next-federation/router'])
  return shared['@next-federation/router']! as {
    version: string
    module: RouterModule
  }
}

/** Replaces `location.assign`/`replace` (a full page load). */
function stubLocation() {
  const assign = rs.fn()
  const original = window.location
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new Proxy(original, {
      get: (target, key) =>
        key === 'assign' || key === 'replace'
          ? assign
          : Reflect.get(target, key),
    }),
  })
  return {
    assign,
    restore: () =>
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: original,
      }),
  }
}

describe('provideNavigation', () => {
  it('provideNavigation registers @next-federation/router at ROUTER_VERSION', () => {
    const { version, module } = provided({ useNavigate: () => () => {} })
    expect(version).toBe(ROUTER_VERSION)
    expect(module.ROUTER_SHARE_NAME).toBe('@next-federation/router')
    expect(module.ROUTER_VERSION).toBe(ROUTER_VERSION)
    for (const name of [
      'Link',
      'useNavigate',
      'usePathname',
      'useSearchParams',
    ] as const) {
      expect(typeof module[name], name).toBe('function')
    }
  })

  it('with React Router hooks passed directly, a remote Link under BrowserRouter basename /rr renders /rr/x and navigates without reload', () => {
    history.replaceState(null, '', '/rr/')
    const { module } = provided({ useNavigate, useHref, useLocation })
    const { Link, usePathname, useSearchParams } = module
    function Remote() {
      return (
        <>
          <Link href="/x?q=1" id="go">
            x
          </Link>
          <output id="where">
            {usePathname()} {useSearchParams().get('q')}
          </output>
        </>
      )
    }
    const loc = stubLocation()
    try {
      const el = mount(
        <BrowserRouter basename="/rr">
          <Routes>
            <Route path="/x" element={<h1 id="page">x page</h1>} />
            <Route path="*" element={<h1 id="page">home</h1>} />
          </Routes>
          <Remote />
        </BrowserRouter>
      )
      const a = el.querySelector('#go')!
      expect(a.getAttribute('href')).toBe('/rr/x?q=1')
      const event = click(a)
      expect(event.defaultPrevented).toBe(true)
      expect(location.pathname).toBe('/rr/x')
      expect(el.querySelector('#page')!.textContent).toBe('x page')
      // Without the basename, as React Router's own hooks give it.
      expect(el.querySelector('#where')!.textContent).toBe('/x 1')
      expect(loc.assign).not.toHaveBeenCalled()
      // A modified click and target=_blank are the browser's.
      const meta = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
        metaKey: true,
      })
      act(() => void a.dispatchEvent(meta))
      expect(meta.defaultPrevented).toBe(false)
    } finally {
      loc.restore()
    }
  })

  it('without useHref the href is unprefixed', () => {
    const navigate = rs.fn()
    const { module } = provided({ useNavigate: () => navigate })
    const el = mount(
      <module.Link href="/x" replace scroll={false}>
        x
      </module.Link>
    )
    const a = el.querySelector('a')!
    expect(a.getAttribute('href')).toBe('/x')
    expect(a.hasAttribute('replace')).toBe(false)
    click(a)
    expect(navigate).toHaveBeenCalledWith('/x', {
      replace: true,
      scroll: false,
    })
    // External hrefs and target=_blank are never intercepted.
    const el2 = mount(
      <>
        <module.Link href="https://example.com/" id="ext">
          ext
        </module.Link>
        <module.Link href="/y" target="_blank" id="blank">
          blank
        </module.Link>
      </>
    )
    const ext = click(el2.querySelector('#ext')!)
    const blank = click(el2.querySelector('#blank')!)
    expect(ext.defaultPrevented).toBe(false)
    expect(blank.defaultPrevented).toBe(false)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('without useLocation, usePathname follows popstate', () => {
    history.replaceState(null, '', '/a?q=1')
    const { module } = provided({ useNavigate: () => () => {} })
    function Where() {
      return (
        <p>
          {module.usePathname()} {module.useSearchParams().get('q')}
        </p>
      )
    }
    const el = mount(<Where />)
    expect(el.textContent).toBe('/a 1')
    act(() => {
      history.pushState(null, '', '/b?q=2')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(el.textContent).toBe('/b 2')
  })
})
