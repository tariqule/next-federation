import {
  createRemoteComponent,
  fetchDescriptorInBrowser,
  provideNavigation,
} from '@next-federation/react/components'
import { Suspense, use } from 'react'
import type { ComponentType } from 'react'
import {
  BrowserRouter,
  Route,
  Routes,
  useHref,
  useLocation,
  useNavigate,
} from 'react-router'

// Remote components written with their own router (router.spec.ts), from
// the links build: their next/link, next/navigation and react-router imports
// are rewired by the build. `/rr/*` gives them this host's React Router
// (BrowserRouter, basename /rr) through provideNavigation; `/router-none*`
// and `/router/next` give them nothing, so their links do full page loads.
const origin =
  import.meta.env.VITE_NF_COMPONENTS_ORIGIN ?? 'http://127.0.0.1:4110'
const linksOrigin =
  import.meta.env.VITE_NF_COMPONENTS_LINKS ?? 'http://127.0.0.1:4121'
/** An absolute URL (another origin): a plain anchor in every host. */
const EXTERNAL_HREF = `${origin}/_nf/components.json`

/** Called once, before the first remote component loads, on `/rr/*` only. */
export function provideReactRouterNavigation(): void {
  provideNavigation({ useNavigate, useHref, useLocation })
}

const RemoteRouterLink = createRemoteComponent<{ external?: string }>({
  expose: './RouterLink',
  fallback: <span data-testid="router-link-fallback">link loading</span>,
})

const RemoteRouterReactRouter = createRemoteComponent({
  expose: './RouterReactRouter',
  fallback: <span data-testid="rr-link-fallback">rr loading</span>,
})

const RemoteRouterInternal = createRemoteComponent({
  expose: './RouterInternal',
  fallback: <span data-testid="internal-fallback">internal loading</span>,
})

const descriptor = fetchDescriptorInBrowser(
  `${linksOrigin}/_nf/components.json`,
  {
    remote: 'links',
  }
)

type Show = 'link' | 'react-router' | 'internal'

function Remote({ show, external }: { show: Show; external: boolean }) {
  const d = use(descriptor)
  return (
    <>
      <p data-testid="rendered-build">{d?.buildId ?? 'none'}</p>
      {show === 'link' ? (
        <RemoteRouterLink
          descriptor={d}
          external={external ? EXTERNAL_HREF : undefined}
        />
      ) : null}
      {show === 'react-router' ? (
        <RemoteRouterReactRouter descriptor={d} />
      ) : null}
      {show === 'internal' ? <RemoteRouterInternal descriptor={d} /> : null}
    </>
  )
}

function RemoteSection({
  show = 'link',
  external = false,
}: {
  show?: Show
  external?: boolean
}) {
  return (
    <Suspense fallback={<span data-testid="shell-fallback">loading</span>}>
      <Remote show={show} external={external} />
    </Suspense>
  )
}

const title = (text: string): ComponentType =>
  function Title() {
    return <h1 data-testid="router-page">{text}</h1>
  }
const NextTitle = title('router next')
const ReactRouterTitle = title('router react-router')
const InternalTitle = title('router internal')
const LinkTitle = title('router link')

/**
 * `/rr/*`: the RouterLink stays mounted while React Router changes pages;
 * `/rr/router/react-router` and `/rr/router/internal` add one more remote.
 */
export function ReactRouterHost() {
  return (
    <BrowserRouter basename="/rr">
      <main>
        <Routes>
          <Route path="/router/next" element={<NextTitle />} />
          <Route
            path="/router/react-router"
            element={
              <>
                <ReactRouterTitle />
                <RemoteSection show="react-router" />
              </>
            }
          />
          <Route
            path="/router/internal"
            element={
              <>
                <InternalTitle />
                <RemoteSection show="internal" />
              </>
            }
          />
          <Route path="*" element={<LinkTitle />} />
        </Routes>
        <RemoteSection external />
      </main>
    </BrowserRouter>
  )
}

/** No navigation provided: `/router-none`, `/router/next` and the others. */
export function NoRouterHost({
  title: text,
  show = 'link',
}: {
  title: string
  show?: Show
}) {
  return (
    <main>
      <h1 data-testid="router-page">{text}</h1>
      <RemoteSection show={show} external={text === 'router none'} />
    </main>
  )
}
