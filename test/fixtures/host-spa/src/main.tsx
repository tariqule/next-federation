import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { provideHostReact } from '@next-federation/react/share'
import { useLiveIslandCount } from './lib/islands.ts'
import { Inert } from './routes/Inert.tsx'
import { Inject } from './routes/Inject.tsx'
import { Islands } from './routes/Islands.tsx'
import { ModeA } from './routes/ModeA.tsx'
import { Retired } from './routes/Retired.tsx'
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

const routes: Record<string, () => ReactNode> = {
  '/islands': Islands,
  '/inject': Inject,
  '/skew': Skew,
  '/inert': Inert,
  '/retired': Retired,
  '/shared': Shared,
  '/mode-a': ModeA,
}
const Page =
  routes[location.pathname] ?? (() => <p>next-federation SPA host</p>)

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
