'use client'
import { createRemoteComponent } from '@next-federation/next/pages/components'

// Remote components on the Pages Router host's own next/link and
// next/router (@next-federation/next/pages/components provides them).
// mode-a-next.spec.ts: NavLink needs next/navigation, which this host does
// not provide, so it renders its fallback (NF-036). Versioned gets this
// host's copy of its shared library: 2.1.0 satisfies the remote's ^2.0.0.
type LinkProps = { href: string; label: string }

export const RemotePagesNavLink = createRemoteComponent<LinkProps>({
  expose: './PagesNavLink',
  fallback: <span data-testid="pages-nav-fallback">pages nav unavailable</span>,
})

export const RemoteNavLink = createRemoteComponent<LinkProps>({
  expose: './NavLink',
  fallback: <span data-testid="nav-fallback">nav unavailable</span>,
})

export const RemoteVersioned = createRemoteComponent({
  expose: './Versioned',
  shared: {
    'components-fallback-lib': {
      version: '2.1.0',
      module: { copy: 'host', version: '2.1.0' },
    },
  },
  fallback: <span data-testid="versioned-fallback">versioned unavailable</span>,
})
