import {
  createRemoteComponent,
  fetchDescriptorInBrowser,
} from '@next-federation/react/components'
import { Suspense, use } from 'react'

// A client-only host has no Next router: remote components that import
// next/link render their fallback (NF-036). Versioned's shared library is
// provided at 1.0.0, outside the remote's ^2.0.0: the remote uses its own copy.
const origin =
  import.meta.env.VITE_NF_COMPONENTS_ORIGIN ?? 'http://127.0.0.1:4110'

type LinkProps = { href: string; label: string }
const RemoteNavLink = createRemoteComponent<LinkProps>({
  expose: './NavLink',
  fallback: <span data-testid="nav-fallback">nav unavailable</span>,
})
const RemotePagesNavLink = createRemoteComponent<LinkProps>({
  expose: './PagesNavLink',
  fallback: <span data-testid="pages-nav-fallback">pages nav unavailable</span>,
})
const RemoteVersioned = createRemoteComponent({
  expose: './Versioned',
  shared: {
    'components-fallback-lib': {
      version: '1.0.0',
      module: { copy: 'host', version: '1.0.0' },
    },
  },
  fallback: <span data-testid="versioned-fallback">versioned unavailable</span>,
})

const descriptor = fetchDescriptorInBrowser(`${origin}/_nf/components.json`, {
  remote: 'components',
})

function Section() {
  const d = use(descriptor)
  return (
    <>
      <p data-testid="rendered-build">{d?.buildId ?? 'none'}</p>
      <RemoteNavLink descriptor={d} href="/mode-a" label="to Mode A" />
      <RemotePagesNavLink descriptor={d} href="/mode-a" label="pages link" />
      <RemoteVersioned descriptor={d} />
    </>
  )
}

export function ModeANext() {
  return (
    <main>
      <h1>Mode A: Next modules (SPA)</h1>
      <Suspense fallback={<span data-testid="shell-fallback">loading</span>}>
        <Section />
      </Suspense>
    </main>
  )
}
