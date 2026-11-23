import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { provideHostReact } from '@next-federation/react/share'
import { useLiveIslandCount } from './lib/islands.ts'
import { Inert } from './routes/Inert.tsx'
import { Inject } from './routes/Inject.tsx'
import { Actions } from './routes/Actions.tsx'
import { Islands } from './routes/Islands.tsx'
import { ModeA } from './routes/ModeA.tsx'
import { ModeANext } from './routes/ModeANext.tsx'
import { Retired } from './routes/Retired.tsx'
import {
  NoRouterHost,
  ReactRouterHost,
  provideReactRouterNavigation,
} from './routes/Router.tsx'
import { Shared } from './routes/Shared.tsx'
import { Skew } from './routes/Skew.tsx'

// `/shared?host=1`: islands on this host's exact React version run on it.
// Module scope, before the first island bootstraps.
if (
  location.pathname === '/shared' &&
  new URLSearchParams(location.search).get('host') === '1'
) {
  ;(window as { __hostProvidedReact?: boolean }).__hostProvidedReact =
    provideHostReact()
}

// `/rr/*`: remote components navigate with this host's React Router
// (provideNavigation). Module scope, before the first remote component loads.
const reactRouter =
  location.pathname === '/rr' || location.pathname.startsWith('/rr/')
if (reactRouter) provideReactRouterNavigation()

const routes: Record<string, () => ReactNode> = {
  '/islands': Islands,
  '/actions': Actions,
  '/inject': Inject,
  '/skew': Skew,
  '/inert': Inert,
  '/retired': Retired,
  '/shared': Shared,
  '/mode-a': ModeA,
  '/mode-a-next': ModeANext,
  '/router-none': () => <NoRouterHost title="router none" />,
  '/router/next': () => <NoRouterHost title="router next" />,
  '/router-none/react-router': () => (
    <NoRouterHost title="router none react-router" show="react-router" />
  ),
  '/router-none/internal': () => (
    <NoRouterHost title="router none internal" show="internal" />
  ),
}
const Page = reactRouter
  ? ReactRouterHost
  : (routes[location.pathname] ?? (() => <p>next-federation SPA host</p>))

function App() {
  const live = useLiveIslandCount()
  return (
    <>
      <output data-testid="live-roots">{live}</output>
      <Page />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
