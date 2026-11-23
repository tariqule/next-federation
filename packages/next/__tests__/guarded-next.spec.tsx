// What the Next entries of remote components share as `next/link`,
// `next/navigation` and `next/router` (remotes that list them in `shared`):
// Next's own modules, guarded like every router module. A link that leaves
// the page's origin is a plain anchor (a script URL gets no href); a
// navigation that leaves it is dropped. Internal links and navigations are
// Next's own.
import { act } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import * as NextLinkModule from 'next/link'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const h = rs.hoisted(() => ({
  registered: [] as Array<Record<string, { version: string; module: unknown }>>,
  linkProps: [] as Array<Record<string, unknown>>,
  appRouter: { push: rs.fn(), replace: rs.fn(), back: rs.fn() },
  pagesRouter: {
    asPath: '/',
    push: rs.fn(async () => true),
    replace: rs.fn(async () => true),
  },
  singleton: {
    push: rs.fn(async () => true),
    replace: rs.fn(async () => true),
    get pathname() {
      return '/current'
    },
  },
}))

rs.mock('@next-federation/react/components', () => ({
  registerSharedModules: (shared: (typeof h.registered)[number]) => {
    h.registered.push(shared)
  },
  createRemoteComponent: () => null,
  loadRemoteModule: () => null,
  preloadRemoteComponent: () => null,
  COMPONENT_EVENT: 'nf:component',
}))
rs.mock('next/link', () => ({
  default: (props: { href: unknown; children?: ReactNode }) => {
    h.linkProps.push(props)
    return (
      <a data-next-link="" href={String(props.href)}>
        {props.children}
      </a>
    )
  },
  useLinkStatus: () => ({ pending: false }),
}))
rs.mock('next/navigation', () => ({
  useRouter: () => h.appRouter,
  usePathname: () => '/app',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {},
}))
rs.mock('next/router', () => ({
  default: h.singleton,
  useRouter: () => h.pagesRouter,
}))

/** Hrefs that leave the page's origin or run script (as the browser reads them). */
const UNSAFE = [
  'java\tscript:alert(1)',
  'javascript:alert(1)',
  'data:text/html,x',
  '//evil.example',
  '/\t/evil.example',
  'https://evil.example/',
]
const SCRIPT = /^(?:java\t?script|data):/

type Shared = Record<string, { module: Record<string, unknown> }>
let app: Shared
let pages: Shared
beforeAll(async () => {
  rs.stubEnv('NF_NEXT_VERSION', '16.4.6')
  await import('../src/client/components.tsx')
  await import('../src/pages/components.tsx')
  ;[app, pages] = h.registered as unknown as [Shared, Shared]
  rs.unstubAllEnvs()
})

const roots: Array<{ unmount(): void }> = []
beforeEach(() => {
  h.linkProps.length = 0
  rs.clearAllMocks()
  history.replaceState(null, '', '/')
})
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount())
  document.body.innerHTML = ''
})

/** The value a hook returns, from a mounted component. */
function hookValue<T>(useHook: () => T): T {
  let value: T | undefined
  function Probe() {
    value = useHook()
    return null
  }
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  roots.push(root)
  act(() => root.render(<Probe />))
  return value!
}

const linkOf = (shared: Shared) =>
  shared['next/link']!.module.default as ComponentType<
    Record<string, unknown> & { children?: ReactNode }
  >

describe.each([
  ['App Router entry', () => app],
  ['Pages Router entry', () => pages],
])('%s: next/link', (_name, shared) => {
  test('the shared next/link is not Next’s own module; its other exports stay', () => {
    const module = shared()['next/link']!.module
    expect(module.default).toBeTruthy()
    expect(module.default).not.toBe(NextLinkModule.default)
    expect(module.useLinkStatus).toBe(NextLinkModule.useLinkStatus)
    expect((module as { __esModule?: unknown }).__esModule).toBe(true)
  })

  test.each(UNSAFE)(
    'href %j: a plain anchor, never Next’s Link; a script URL gets no href',
    (href) => {
      const Link = linkOf(shared())
      const html = renderToString(
        <Link href={href} prefetch={false} replace className="c">
          x
        </Link>
      )
      expect(h.linkProps).toHaveLength(0)
      expect(html).not.toContain('data-next-link')
      expect(html).toContain('class="c"')
      expect(html).not.toMatch(/prefetch|replace/)
      if (SCRIPT.test(href)) expect(html).not.toContain('href=')
      else expect(html).toContain(`href="${href}"`)
    }
  )

  test.each(UNSAFE)('as %j (with an internal href): a plain anchor', (as) => {
    const Link = linkOf(shared())
    renderToString(
      <Link href="/post/[id]" as={as}>
        x
      </Link>
    )
    expect(h.linkProps).toHaveLength(0)
  })

  test('a URL object with a script pathname or another host: a plain anchor', () => {
    const Link = linkOf(shared())
    const html = renderToString(
      <>
        <Link href={{ pathname: 'javascript:alert(1)' }}>a</Link>
        <Link href={{ pathname: '//evil.example', query: { a: '1' } }}>b</Link>
        <Link href={{ protocol: 'javascript:', pathname: 'alert(1)' }}>c</Link>
      </>
    )
    expect(h.linkProps).toHaveLength(0)
    expect(html).toBe('<a>a</a><a href="//evil.example?a=1">b</a><a>c</a>')
  })

  test('legacyBehavior with an unsafe href: the child anchor, without a script href', () => {
    const Link = linkOf(shared())
    const html = renderToString(
      <Link href="javascript:alert(1)" legacyBehavior>
        <a className="child">x</a>
      </Link>
    )
    expect(html).toBe('<a class="child">x</a>')
  })

  test('internal hrefs: Next’s Link with the props as given (client navigation stays Next’s)', () => {
    const Link = linkOf(shared())
    const object = { pathname: '/p', query: { id: '1' } }
    const html = renderToString(
      <>
        <Link href="/in" prefetch={false} scroll={false}>
          a
        </Link>
        <Link href={object}>b</Link>
        <Link href="/post/[id]" as="/post/1">
          c
        </Link>
        <Link href="?q=1">d</Link>
      </>
    )
    expect(html.match(/data-next-link/g)).toHaveLength(4)
    expect(h.linkProps).toEqual([
      { href: '/in', prefetch: false, scroll: false, children: 'a' },
      { href: object, children: 'b' },
      { href: '/post/[id]', as: '/post/1', children: 'c' },
      { href: '?q=1', children: 'd' },
    ])
    expect(h.linkProps[1]!.href).toBe(object)
  })
})

describe('App Router entry: next/navigation', () => {
  test('its other exports stay', () => {
    const module = app['next/navigation']!.module
    expect(typeof module.usePathname).toBe('function')
    expect(typeof module.notFound).toBe('function')
  })

  test.each(UNSAFE)('useRouter().push and replace(%j) are dropped', (href) => {
    const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
    const useRouter = app['next/navigation']!.module.useRouter as () => {
      push(href: string, options?: object): void
      replace(href: string, options?: object): void
    }
    const router = hookValue(useRouter)
    router.push(href)
    router.replace(href, { scroll: false })
    expect(h.appRouter.push).not.toHaveBeenCalled()
    expect(h.appRouter.replace).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  test('internal navigations are Next’s own; the rest of the router stays', () => {
    const useRouter = app['next/navigation']!.module.useRouter as () => {
      push(href: string, options?: object): void
      replace(href: string, options?: object): void
      back(): void
    }
    const router = hookValue(useRouter)
    router.push('/a', { scroll: false })
    router.replace('/b?x=1')
    router.back()
    expect(h.appRouter.push).toHaveBeenCalledWith('/a', { scroll: false })
    expect(h.appRouter.replace).toHaveBeenCalledWith('/b?x=1', undefined)
    expect(h.appRouter.back).toHaveBeenCalledTimes(1)
  })
})

describe('Pages Router entry: next/router', () => {
  type PagesRouter = {
    push(url: unknown, as?: unknown, options?: object): Promise<boolean>
    replace(url: unknown, as?: unknown, options?: object): Promise<boolean>
  }
  const routerModule = () => pages['next/router']!.module

  test.each(UNSAFE)(
    'useRouter().push and replace(%j), as url or as `as`: dropped (false)',
    async (href) => {
      const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
      const router = hookValue(routerModule().useRouter as () => PagesRouter)
      expect(await router.push(href)).toBe(false)
      expect(await router.replace(href, undefined, { scroll: false })).toBe(
        false
      )
      expect(await router.push('/post/[id]', href)).toBe(false)
      expect(await router.push({ pathname: href })).toBe(false)
      expect(h.pagesRouter.push).not.toHaveBeenCalled()
      expect(h.pagesRouter.replace).not.toHaveBeenCalled()
      warn.mockRestore()
    }
  )

  test.each(UNSAFE)(
    'the Router singleton (default export): push and replace(%j) dropped',
    async (href) => {
      const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
      const Router = routerModule().default as PagesRouter
      expect(await Router.push(href)).toBe(false)
      expect(await Router.replace(href)).toBe(false)
      expect(h.singleton.push).not.toHaveBeenCalled()
      expect(h.singleton.replace).not.toHaveBeenCalled()
      warn.mockRestore()
    }
  )

  test('withRouter gives the guarded router', async () => {
    const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
    const withRouter = routerModule().withRouter as (
      c: ComponentType<{ router: PagesRouter }>
    ) => ComponentType
    let router: PagesRouter | undefined
    const Wrapped = withRouter(({ router: r }) => {
      router = r
      return null
    })
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    roots.push(root)
    act(() => root.render(<Wrapped />))
    expect(await router!.push('//evil.example')).toBe(false)
    expect(h.pagesRouter.push).not.toHaveBeenCalled()
    await router!.push('/ok')
    expect(h.pagesRouter.push).toHaveBeenCalledWith('/ok', undefined, undefined)
    warn.mockRestore()
  })

  test('internal navigations are Next’s own (url, as and options as given)', async () => {
    const router = hookValue(routerModule().useRouter as () => PagesRouter)
    const object = { pathname: '/p', query: { id: '1' } }
    expect(await router.push('/a', undefined, { scroll: false })).toBe(true)
    await router.push('/post/[id]', '/post/1', { shallow: true })
    await router.push(object)
    await router.replace('/b')
    expect(h.pagesRouter.push.mock.calls).toEqual([
      ['/a', undefined, { scroll: false }],
      ['/post/[id]', '/post/1', { shallow: true }],
      [object, undefined, undefined],
    ])
    expect(h.pagesRouter.replace).toHaveBeenCalledWith(
      '/b',
      undefined,
      undefined
    )
    const Router = routerModule().default as PagesRouter & {
      pathname: string
    }
    await Router.push('/s')
    expect(h.singleton.push).toHaveBeenCalledWith('/s', undefined, undefined)
    // The singleton's other fields still read the current router.
    expect(Router.pathname).toBe('/current')
  })
})
