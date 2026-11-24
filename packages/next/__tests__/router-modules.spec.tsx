// The Next entries of remote components also provide `@next-federation/router`,
// backed by the host's own Next router: `next/link` plus `next/navigation`
// (App Router) or `next/router` (Pages Router).
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { ROUTER_SHARE_NAME, ROUTER_VERSION } from '@next-federation/router'
import type {
  Navigate,
  ReadonlySearchParams,
  RouterModule,
} from '@next-federation/router'
import { nextAppRouterModule } from '../src/client/router-module.tsx'
import { nextPagesRouterModule } from '../src/pages/router-module.tsx'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const h = rs.hoisted(() => ({
  registered: [] as Array<Record<string, { version: string; module: unknown }>>,
  appRouter: { push: rs.fn(), replace: rs.fn() },
  pagesRouter: { asPath: '/', push: rs.fn(), replace: rs.fn() },
  usePathname: rs.fn(() => '/app/path'),
  useSearchParams: rs.fn(() => new URLSearchParams('q=1')),
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
  default: ({
    href,
    children,
    scroll,
    replace,
  }: {
    href: string
    children?: ReactNode
    scroll?: boolean
    replace?: boolean
  }) => (
    <a
      data-next-link=""
      data-scroll={String(scroll)}
      data-replace={String(replace)}
      href={href}
    >
      {children}
    </a>
  ),
}))
rs.mock('next/navigation', () => ({
  useRouter: () => h.appRouter,
  usePathname: h.usePathname,
  useSearchParams: h.useSearchParams,
}))
rs.mock('next/router', () => ({
  useRouter: () => h.pagesRouter,
}))

const roots: Array<{ unmount(): void }> = []
beforeEach(() => {
  h.registered.length = 0
  h.pagesRouter.asPath = '/'
  rs.clearAllMocks()
  rs.stubEnv('NF_NEXT_VERSION', '16.4.6')
})
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount())
  document.body.innerHTML = ''
  rs.unstubAllEnvs()
})

function mount(node: ReactNode): { rerender(node: ReactNode): void } {
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  roots.push(root)
  act(() => root.render(node))
  return { rerender: (next) => act(() => root.render(next)) }
}

function navigateWith(mod: RouterModule): Navigate {
  let navigate: Navigate | undefined
  function Probe() {
    navigate = mod.useNavigate()
    return null
  }
  mount(<Probe />)
  return navigate!
}

test('App entry registers @next-federation/router at ROUTER_VERSION; its Link renders next/link', async () => {
  // Each entry is imported once in this file: importing registers.
  await import('../src/client/components.tsx')
  expect(h.registered).toHaveLength(1)
  const shared = h.registered[0]!
  expect(Object.keys(shared).sort()).toEqual([
    ROUTER_SHARE_NAME,
    'next/link',
    'next/navigation',
  ])
  expect(ROUTER_SHARE_NAME).toBe('@next-federation/router')
  expect(ROUTER_VERSION).not.toBe('16.4.6')
  expect(shared[ROUTER_SHARE_NAME]).toEqual({
    version: ROUTER_VERSION,
    module: nextAppRouterModule,
  })
  expect(shared[ROUTER_SHARE_NAME]!.module).toBe(nextAppRouterModule)

  const { Link } = nextAppRouterModule
  const html = renderToString(
    <Link href="/router/next" scroll={false}>
      go
    </Link>
  )
  expect(html).toContain('data-next-link=""')
  expect(html).toContain('data-scroll="false"')
  expect(html).toContain('href="/router/next"')
  // External hrefs stay plain anchors (createRouterModule).
  expect(renderToString(<Link href="https://e.example.com">x</Link>)).toBe(
    '<a href="https://e.example.com">x</a>'
  )
})

test('App useNavigate calls router.push(href, { scroll }) and replace with { replace: true }', () => {
  const navigate = navigateWith(nextAppRouterModule)

  navigate('/a', { scroll: false })
  expect(h.appRouter.push).toHaveBeenCalledTimes(1)
  expect(h.appRouter.push).toHaveBeenCalledWith('/a', { scroll: false })
  expect(h.appRouter.replace).not.toHaveBeenCalled()

  navigate('/b', { replace: true })
  expect(h.appRouter.replace).toHaveBeenCalledTimes(1)
  expect(h.appRouter.replace).toHaveBeenCalledWith('/b', { scroll: undefined })
  expect(h.appRouter.push).toHaveBeenCalledTimes(1)

  navigate('/c')
  expect(h.appRouter.push).toHaveBeenLastCalledWith('/c', {
    scroll: undefined,
  })
})

test('Pages entry registers it; useNavigate calls router.push(href, undefined, { scroll })', async () => {
  await import('../src/pages/components.tsx')
  const shared = h.registered[0]!
  expect(Object.keys(shared).sort()).toEqual([
    ROUTER_SHARE_NAME,
    'next/link',
    'next/router',
  ])
  expect(shared[ROUTER_SHARE_NAME]!.version).toBe(ROUTER_VERSION)
  expect(shared[ROUTER_SHARE_NAME]!.module).toBe(nextPagesRouterModule)

  expect(
    renderToString(
      <nextPagesRouterModule.Link href="/p">p</nextPagesRouterModule.Link>
    )
  ).toContain('data-next-link=""')

  const navigate = navigateWith(nextPagesRouterModule)
  navigate('/p', { scroll: false })
  expect(h.pagesRouter.push).toHaveBeenCalledWith('/p', undefined, {
    scroll: false,
  })
  navigate('/q', { replace: true, scroll: true })
  expect(h.pagesRouter.replace).toHaveBeenCalledWith('/q', undefined, {
    scroll: true,
  })
  expect(h.pagesRouter.push).toHaveBeenCalledTimes(1)

  // No options: scroll stays undefined (Next's own default applies).
  navigate('/r')
  expect(h.pagesRouter.push).toHaveBeenCalledTimes(2)
  expect(h.pagesRouter.push).toHaveBeenLastCalledWith('/r', undefined, {
    scroll: undefined,
  })
})

test('Pages usePathname strips query and hash from asPath', () => {
  const mod = nextPagesRouterModule
  const seen: Array<{
    n: number
    path: string
    params: ReadonlySearchParams
  }> = []
  // `n` changes on every render, so each rerender runs the hooks again.
  function Probe({ n }: { n: number }) {
    seen.push({ n, path: mod.usePathname(), params: mod.useSearchParams() })
    return null
  }

  h.pagesRouter.asPath = '/router/next?x=1&y=2#top'
  const view = mount(<Probe n={0} />)
  expect(seen.at(-1)!.path).toBe('/router/next')
  expect(seen.at(-1)!.params.get('x')).toBe('1')
  expect(seen.at(-1)!.params.get('y')).toBe('2')

  // Same asPath: the same params object (memoised).
  view.rerender(<Probe n={1} />)
  expect(seen.at(-1)!.n).toBe(1)
  expect(seen.at(-1)!.params).toBe(seen.at(-2)!.params)

  // A `?` inside the hash is not a query.
  h.pagesRouter.asPath = '/a#b?c=1'
  view.rerender(<Probe n={2} />)
  expect(seen.at(-1)!.path).toBe('/a')
  expect(seen.at(-1)!.params.has('c')).toBe(false)

  h.pagesRouter.asPath = '/plain'
  view.rerender(<Probe n={3} />)
  expect(seen.at(-1)!.path).toBe('/plain')
  expect([...seen.at(-1)!.params.keys()]).toEqual([])
})

test('Pages useSearchParams is the same object when only the hash changes', () => {
  const mod = nextPagesRouterModule
  const seen: ReadonlySearchParams[] = []
  function Probe({ n }: { n: number }) {
    seen.push(mod.useSearchParams())
    return <i data-n={n} />
  }
  h.pagesRouter.asPath = '/list?page=2#top'
  const view = mount(<Probe n={0} />)
  h.pagesRouter.asPath = '/list?page=2#item-7'
  view.rerender(<Probe n={1} />)
  h.pagesRouter.asPath = '/list?page=2'
  view.rerender(<Probe n={2} />)
  expect(seen).toHaveLength(3)
  expect(seen[1]).toBe(seen[0])
  expect(seen[2]).toBe(seen[0])
  expect(seen[0]!.get('page')).toBe('2')
  // A query change is a new object.
  h.pagesRouter.asPath = '/list?page=3#top'
  view.rerender(<Probe n={3} />)
  expect(seen[3]).not.toBe(seen[0])
  expect(seen[3]!.get('page')).toBe('3')
})

test('App usePathname never calls useSearchParams', () => {
  const mod = nextAppRouterModule
  let path = ''
  function Probe() {
    path = mod.usePathname()
    return null
  }
  mount(<Probe />)
  expect(path).toBe('/app/path')
  expect(h.usePathname).toHaveBeenCalled()
  expect(h.useSearchParams).not.toHaveBeenCalled()
  // useSearchParams is next/navigation's own hook.
  expect(mod.useSearchParams).toBe(h.useSearchParams)
})
