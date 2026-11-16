import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IslandBridge } from '@next-federation/protocol'
import { BridgeProvider } from '../src/bridge-context.tsx'
import { Link } from '../src/link.tsx'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  rs.restoreAllMocks()
})

function makeBridge(over: Partial<IslandBridge> = {}) {
  const navigate = rs.fn()
  const prefetch = rs.fn()
  const bridge: IslandBridge = {
    navigate,
    prefetch,
    basePath: '/base',
    locale: 'fr',
    ...over,
  }
  return { bridge, navigate, prefetch }
}

function render(node: ReactNode, bridge?: IslandBridge): HTMLAnchorElement {
  act(() =>
    root.render(
      bridge ? <BridgeProvider value={bridge}>{node}</BridgeProvider> : node
    )
  )
  return container.querySelector('a') as HTMLAnchorElement
}

function click(a: HTMLAnchorElement, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  })
  act(() => {
    a.dispatchEvent(event)
  })
  return event
}

test('renders basePath and locale into the href', () => {
  const { bridge } = makeBridge()
  const a = render(<Link href="/nav/two">two</Link>, bridge)
  expect(a.getAttribute('href')).toBe('/base/fr/nav/two')
})

test('omits the locale segment when the locale is empty', () => {
  const { bridge } = makeBridge({ locale: '' })
  const a = render(<Link href="/x">x</Link>, bridge)
  expect(a.getAttribute('href')).toBe('/base/x')
})

test('a plain click calls navigate with the full href and prevents default', () => {
  const { bridge, navigate } = makeBridge()
  const a = render(<Link href="/nav/two">two</Link>, bridge)
  const event = click(a)
  expect(navigate).toHaveBeenCalledTimes(1)
  expect(navigate).toHaveBeenCalledWith('/base/fr/nav/two')
  expect(event.defaultPrevented).toBe(true)
})

test.each(['metaKey', 'ctrlKey', 'shiftKey', 'altKey'])(
  '%s-click is left to the browser',
  (key) => {
    const { bridge, navigate } = makeBridge()
    const a = render(<Link href="/x">x</Link>, bridge)
    const event = click(a, { [key]: true })
    expect(navigate).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  }
)

test('a non-primary button click is left to the browser', () => {
  const { bridge, navigate } = makeBridge()
  const a = render(<Link href="/x">x</Link>, bridge)
  click(a, { button: 1 })
  expect(navigate).not.toHaveBeenCalled()
})

test('target="_blank", download and external hrefs are not intercepted', () => {
  const { bridge, navigate } = makeBridge()
  for (const node of [
    <Link href="/x" target="_blank">
      x
    </Link>,
    <Link href="/x" download>
      x
    </Link>,
    <Link href="https://example.com/a">x</Link>,
    <Link href="//example.com/a">x</Link>,
    <Link href="#top">x</Link>,
    <Link href="mailto:a@b.c">x</Link>,
  ]) {
    const a = render(node, bridge)
    const event = click(a)
    expect(event.defaultPrevented).toBe(false)
  }
  expect(navigate).not.toHaveBeenCalled()
})

test('external hrefs are rendered as-is', () => {
  const { bridge } = makeBridge()
  for (const href of ['https://example.com/a', '//example.com/a', '#top']) {
    expect(
      render(<Link href={href}>x</Link>, bridge).getAttribute('href')
    ).toBe(href)
  }
})

test('an onClick that prevents default suppresses navigation', () => {
  const { bridge, navigate } = makeBridge()
  const a = render(
    <Link href="/x" onClick={(e) => e.preventDefault()}>
      x
    </Link>,
    bridge
  )
  click(a)
  expect(navigate).not.toHaveBeenCalled()
})

test('hover prefetches once per href; prefetch={false} never does', () => {
  const { bridge, prefetch } = makeBridge()
  const a = render(<Link href="/x">x</Link>, bridge)
  act(() => {
    a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    a.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
  })
  expect(prefetch).toHaveBeenCalledTimes(1)
  expect(prefetch).toHaveBeenCalledWith('/base/fr/x')

  const off = makeBridge()
  const b = render(
    <Link href="/x" prefetch={false}>
      x
    </Link>,
    off.bridge
  )
  act(() => {
    b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  })
  expect(off.prefetch).not.toHaveBeenCalled()
})

test('without a provider navigate falls back to location.assign', () => {
  const assign = rs.fn()
  rs.spyOn(window, 'location', 'get').mockReturnValue({
    ...window.location,
    assign,
  } as unknown as Location)
  const a = render(<Link href="/x">x</Link>)
  expect(a.getAttribute('href')).toBe('/x')
  click(a)
  expect(assign).toHaveBeenCalledWith('/x')
})

test.each(['/\\evil.com', '\\/evil.com', '\\\\evil.com'])(
  'backslash-prefixed href %s is external and never intercepted',
  (href) => {
    const { bridge, navigate } = makeBridge()
    const a = render(<Link href={href}>x</Link>, bridge)
    expect(a.getAttribute('href')).toBe(href)
    expect(click(a).defaultPrevented).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  }
)
