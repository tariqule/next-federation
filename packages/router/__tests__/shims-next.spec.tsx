// The shims a remote build gets for `next/link` and `next/navigation`. Here
// `@next-federation/router` is the document router (no host registered one).
import { act, createRef } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, rs } from '@rstest/core'
import Link from '../src/shims/next-link.tsx'
import { UNSAFE_LINKS, isScriptHref } from './helpers/unsafe-links.ts'
import {
  usePathname,
  useRouter,
  useSearchParams,
} from '../src/shims/next-navigation.ts'
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
  'data:text/html,x',
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

/** Replaces `location.assign`/`replace` (happy-dom would navigate). */
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

describe('next/link shim', () => {
  it('Link with { pathname, query } renders href /p?id=1', () => {
    const el = mount(
      <>
        <Link href={{ pathname: '/p', query: { id: '1' } }}>p</Link>
        <Link href={{ pathname: '/q', query: { a: '1', b: 'x y' }, hash: 'h' }}>
          q
        </Link>
        <Link href="/plain" className="c">
          plain
        </Link>
      </>
    )
    const hrefs = [...el.querySelectorAll('a')].map((a) =>
      a.getAttribute('href')
    )
    expect(hrefs).toEqual(['/p?id=1', '/q?a=1&b=x+y#h', '/plain'])
    expect(el.querySelectorAll('a')[2]!.className).toBe('c')
  })

  it('React 19: a ref on Link, or on its legacyBehavior child, reaches the <a> (no host router)', () => {
    const ref = createRef<HTMLAnchorElement>()
    const childRef = createRef<HTMLAnchorElement>()
    const el = mount(
      <>
        <Link
          href="/r"
          // No `ref` in the shim's props type (remotes type-check against
          // next/link's own types).
          {...({ ref } as object)}
          id="link"
        >
          r
        </Link>
        <Link href="/c" legacyBehavior>
          <a ref={childRef} id="child">
            c
          </a>
        </Link>
      </>
    )
    expect(ref.current).toBe(el.querySelector('#link'))
    expect(childRef.current).toBe(el.querySelector('#child'))
  })

  it('ignored props (locale, passHref, shallow, onNavigate) warn once each and still render an anchor', () => {
    const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
    const error = rs.spyOn(console, 'error').mockImplementation(() => {})
    const ignored = {
      locale: 'fr',
      passHref: true,
      shallow: true,
      onNavigate: () => {},
    }
    const el = mount(
      <>
        <Link href="/a" {...ignored}>
          a
        </Link>
        <Link href="/b" {...ignored}>
          b
        </Link>
      </>
    )
    const anchors = el.querySelectorAll('a')
    expect(anchors).toHaveLength(2)
    expect(anchors[0]!.getAttribute('href')).toBe('/a')
    for (const name of Object.keys(ignored)) {
      expect(anchors[0]!.hasAttribute(name.toLowerCase())).toBe(false)
      const lines = warn.mock.calls.filter((args: unknown[]) =>
        String(args[0]).includes(`"${name}"`)
      )
      expect(lines, name).toHaveLength(1)
    }
    // React would complain about unknown DOM props had any leaked through.
    expect(error).not.toHaveBeenCalled()
  })

  it('as is the rendered and navigated href (href="/post/[pid]" as="/post/1")', () => {
    const el = mount(
      <>
        <Link href="/post/[pid]" as="/post/1" id="s">
          s
        </Link>
        <Link
          href={{ pathname: '/post/[pid]', query: { pid: '2' } }}
          as={{ pathname: '/post/2', hash: 'c' }}
          id="o"
        >
          o
        </Link>
      </>
    )
    expect(el.querySelector('#s')!.getAttribute('href')).toBe('/post/1')
    expect(el.querySelector('#o')!.getAttribute('href')).toBe('/post/2#c')
  })

  it('legacyBehavior with an <a> child renders one anchor with the child props and children', () => {
    const error = rs.spyOn(console, 'error').mockImplementation(() => {})
    const onClick = rs.fn()
    const el = mount(
      <Link href="/legacy" legacyBehavior passHref>
        <a className="x" data-k="1" onClick={onClick}>
          <span>text</span>
        </a>
      </Link>
    )
    const anchors = el.querySelectorAll('a')
    expect(anchors).toHaveLength(1)
    expect(anchors[0]!.getAttribute('href')).toBe('/legacy')
    expect(anchors[0]!.className).toBe('x')
    expect(anchors[0]!.getAttribute('data-k')).toBe('1')
    expect(anchors[0]!.innerHTML).toBe('<span>text</span>')
    // No <a> in <a> (React's validateDOMNesting would report it).
    expect(error).not.toHaveBeenCalled()
    act(() => {
      anchors[0]!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      )
    })
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('next/link shim: script hrefs', () => {
  it('never renders a javascript:, vbscript: or data: href (href, as, legacyBehavior), with no host router', () => {
    for (const href of UNSAFE_LINKS) {
      const el = mount(
        <>
          <Link href={href}>a</Link>
          <Link href="/post/[pid]" as={href}>
            b
          </Link>
          <Link href={href} legacyBehavior>
            <a className="legacy">c</a>
          </Link>
        </>
      )
      const anchors = [...el.querySelectorAll('a')]
      expect(anchors, href).toHaveLength(3)
      for (const a of anchors) {
        expect(isScriptHref(a.getAttribute('href')), href).toBe(false)
      }
    }
  })
})

describe('next/navigation shim', () => {
  function Probe({ onRouter }: { onRouter: (r: unknown) => void }) {
    onRouter(useRouter())
    return (
      <p>
        {usePathname()}|{useSearchParams().get('q')}
      </p>
    )
  }

  it("useRouter().push and replace call the router's navigate; refresh and prefetch are no-ops", () => {
    const loc = stubLocation()
    try {
      let router: ReturnType<typeof useRouter> | null = null
      mount(<Probe onRouter={(r) => (router = r as typeof router)} />)
      router!.push('/next')
      router!.replace('/other', { scroll: false })
      router!.refresh()
      router!.prefetch('/x')
      expect(loc.assign.mock.calls).toEqual([['/next']])
      expect(loc.replace.mock.calls).toEqual([['/other']])
    } finally {
      loc.restore()
    }
  })

  it('push and replace drop hrefs that leave the origin (javascript:, //x, /\\t/x, \\\\x, https://x), with a warning', () => {
    const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
    const loc = stubLocation()
    try {
      let router: ReturnType<typeof useRouter> | null = null
      mount(<Probe onRouter={(r) => (router = r as typeof router)} />)
      for (const href of UNSAFE) {
        router!.push(href)
        router!.replace(href)
      }
      expect(loc.assign).not.toHaveBeenCalled()
      expect(loc.replace).not.toHaveBeenCalled()
      expect(
        warn.mock.calls.some((args: unknown[]) =>
          String(args[0]).includes('was dropped')
        )
      ).toBe(true)
      // Same origin still navigates (relative, query, absolute same origin).
      router!.push('?q=2')
      router!.replace(`${location.origin}/abs`)
      expect(loc.assign.mock.calls).toEqual([['?q=2']])
      expect(loc.replace.mock.calls).toEqual([[`${location.origin}/abs`]])
    } finally {
      loc.restore()
    }
  })

  it('back() calls history.back() and forward() history.forward()', () => {
    const back = rs.spyOn(history, 'back').mockImplementation(() => {})
    const forward = rs.spyOn(history, 'forward').mockImplementation(() => {})
    let router: ReturnType<typeof useRouter> | null = null
    mount(<Probe onRouter={(r) => (router = r as typeof router)} />)
    router!.back()
    router!.forward()
    expect(back).toHaveBeenCalledTimes(1)
    expect(forward).toHaveBeenCalledTimes(1)
  })

  it('usePathname and useSearchParams follow the document in the browser', () => {
    history.replaceState(null, '', '/here?q=1')
    const el = mount(<Probe onRouter={() => {}} />)
    expect(el.textContent).toBe('/here|1')
  })

  it("server render of usePathname gives the router's server snapshot, never a guess", () => {
    // The page's own location must not leak into server HTML.
    history.replaceState(null, '', '/guess?q=guess')
    const html = renderToString(<Probe onRouter={() => {}} />)
    expect(html.replace(/<!-- -->/g, '')).toBe('<p>|</p>')
  })
})
