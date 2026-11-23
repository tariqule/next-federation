import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, rs } from '@rstest/core'
// eslint-disable-next-line no-restricted-imports -- test host for the adapter
import {
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
  createMemoryRouter,
  useNavigate,
} from 'react-router'
import { reactRouterModule } from '../src/react-router.tsx'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const roots: Array<{ unmount(): void }> = []
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount())
  document.body.innerHTML = ''
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

const mod = reactRouterModule()

describe('reactRouterModule', () => {
  it('Link navigates through React Router (route element changes, no location.assign)', () => {
    const assign = rs.fn()
    const original = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign, replace: assign },
    })
    try {
      const el = mount(
        <MemoryRouter initialEntries={['/a']}>
          <Routes>
            <Route
              path="/a"
              element={
                <mod.Link href="/target" data-testid="go">
                  go
                </mod.Link>
              }
            />
            <Route path="/target" element={<p id="b">page b</p>} />
          </Routes>
        </MemoryRouter>
      )
      const a = el.querySelector('a') as HTMLAnchorElement
      expect(a.getAttribute('href')).toBe('/target')
      act(() => {
        a.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            button: 0,
          })
        )
      })
      expect(el.querySelector('#b')?.textContent).toBe('page b')
      expect(assign).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: original,
      })
    }
  })

  it('useNavigate with { replace: true } replaces', () => {
    let nav: ReturnType<typeof mod.useNavigate> | undefined
    let back: (() => void) | undefined
    function Probe(): React.ReactNode {
      nav = mod.useNavigate()
      const rr = useNavigate()
      back = () => void rr(-1)
      return <span id="p">{mod.usePathname()}</span>
    }
    const el = mount(
      <MemoryRouter initialEntries={['/z', '/a']} initialIndex={1}>
        <Routes>
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    )
    act(() => nav?.('/b', { replace: true }))
    expect(el.querySelector('#p')?.textContent).toBe('/b')
    // /a was replaced, so going back lands on /z (a push would land on /a).
    act(() => back?.())
    expect(el.querySelector('#p')?.textContent).toBe('/z')
    act(() => nav?.('/c'))
    act(() => back?.())
    expect(el.querySelector('#p')?.textContent).toBe('/z')
  })

  it('usePathname and useSearchParams follow the router', () => {
    let nav: ReturnType<typeof mod.useNavigate> | undefined
    function Probe(): React.ReactNode {
      nav = mod.useNavigate()
      const q = mod.useSearchParams()
      return (
        <span id="p">
          {mod.usePathname()}|{q.get('x') ?? 'none'}
        </span>
      )
    }
    const el = mount(
      <MemoryRouter initialEntries={['/a?x=1']}>
        <Routes>
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    )
    expect(el.querySelector('#p')?.textContent).toBe('/a|1')
    act(() => nav?.('/b?x=2'))
    expect(el.querySelector('#p')?.textContent).toBe('/b|2')
  })

  it('an https: href stays a plain anchor', () => {
    const el = mount(
      <MemoryRouter>
        <mod.Link href="https://example.com/x">out</mod.Link>
      </MemoryRouter>
    )
    const a = el.querySelector('a') as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe('https://example.com/x')
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => {
      a.dispatchEvent(ev)
    })
    expect(ev.defaultPrevented).toBe(false)
  })

  it('scroll: false is preventScrollReset (Link and useNavigate); otherwise false', async () => {
    let nav: ReturnType<typeof mod.useNavigate> | undefined
    function Page(): React.ReactNode {
      nav = mod.useNavigate()
      return (
        <>
          <mod.Link href="/kept" scroll={false} data-testid="kept">
            kept
          </mod.Link>
          <mod.Link href="/reset" data-testid="reset">
            reset
          </mod.Link>
          <span id="p">{mod.usePathname()}</span>
        </>
      )
    }
    const router = createMemoryRouter([{ path: '*', element: <Page /> }], {
      initialEntries: ['/a'],
    })
    const el = mount(<RouterProvider router={router} />)
    const click = async (testId: string) => {
      const a = el.querySelector(`[data-testid="${testId}"]`)!
      await act(async () => {
        a.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            button: 0,
          })
        )
      })
    }
    await click('kept')
    expect(router.state.location.pathname).toBe('/kept')
    expect(router.state.preventScrollReset).toBe(true)
    await click('reset')
    expect(router.state.location.pathname).toBe('/reset')
    expect(router.state.preventScrollReset).toBe(false)
    await act(async () => nav?.('/n', { scroll: false }))
    expect(router.state.location.pathname).toBe('/n')
    expect(router.state.preventScrollReset).toBe(true)
    await act(async () => nav?.('/m'))
    expect(router.state.location.pathname).toBe('/m')
    expect(router.state.preventScrollReset).toBe(false)
    expect(el.querySelector('#p')?.textContent).toBe('/m')
  })
})
