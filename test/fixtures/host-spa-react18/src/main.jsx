import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { provideHostReact } from '@next-federation/react/share'
import { useLiveIslandCount } from './islands.js'
import { Components, Nineteen } from './routes/Components.jsx'
import { Islands } from './routes/Islands.jsx'
import { Shared } from './routes/Shared.jsx'

// `/shared?host=1`: this host's React (18.3.1) goes into the island share
// scope; islands, which need their exact React 19, keep their own copy.
// Module scope, before the first island bootstraps.
if (
  location.pathname === '/shared' &&
  new URLSearchParams(location.search).get('host') === '1'
) {
  window.__hostProvidedReact = provideHostReact()
}

const routes = {
  '/islands': Islands,
  '/components': Components,
  '/nineteen': Nineteen,
  '/shared': Shared,
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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
