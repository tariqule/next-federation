'use client'
import * as HostContextModule from 'components-context'
import { createRemoteComponent } from '@next-federation/next/pages/components'

// Remote components written with their own router (router.spec.ts): the
// build rewires their next/link, next/navigation and react-router imports,
// and this entry gives them the Pages Router's next/link and next/router, so
// a remote link keeps the host's basePath and locale.
// The Rspack build's descriptor has no per-expose usage: it lists
// components-context (Counter's) as needed by every expose.
export const RemoteRouterLink = createRemoteComponent<{ external?: string }>({
  expose: './RouterLink',
  shared: {
    'components-context': { version: '1.0.0', module: HostContextModule },
  },
  fallback: <span data-testid="router-link-fallback">link loading</span>,
})

/** React Router's `Link` with no router in the remote: this host's router. */
export const RemoteRouterReactRouter = createRemoteComponent({
  expose: './RouterReactRouter',
  fallback: <span data-testid="rr-link-fallback">rr loading</span>,
})

/** The remote's own MemoryRouter: its internal link never reaches the host. */
export const RemoteRouterInternal = createRemoteComponent({
  expose: './RouterInternal',
  fallback: <span data-testid="internal-fallback">internal loading</span>,
})
