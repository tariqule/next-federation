'use client'
import { createRemoteComponent } from '@next-federation/next/components'

// Remote components on the App Router host's own next/link and
// next/navigation (@next-federation/next/components provides them).
// mode-a-next.spec.ts: PagesNavLink needs next/router, which an App Router
// host does not provide, so it renders its fallback (NF-036); Versioned's
// shared library is not provided here, so the remote uses its own copy.
type LinkProps = { href: string; label: string }

export const RemoteNavLink = createRemoteComponent<LinkProps>({
  expose: './NavLink',
  fallback: <span data-testid="nav-fallback">nav unavailable</span>,
})

export const RemotePagesNavLink = createRemoteComponent<LinkProps>({
  expose: './PagesNavLink',
  fallback: <span data-testid="pages-nav-fallback">pages nav unavailable</span>,
})

export const RemoteVersioned = createRemoteComponent({
  expose: './Versioned',
  fallback: <span data-testid="versioned-fallback">versioned unavailable</span>,
})
