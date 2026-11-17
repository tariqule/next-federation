'use client'
import { createRemoteComponent } from '@next-federation/next/components'

// A remote component on this host's own next/link and next/navigation
// (@next-federation/next/components provides them).
export const RemoteNavLink = createRemoteComponent<{
  href: string
  label: string
}>({
  expose: './NavLink',
  fallback: <span data-testid="nav-fallback">nav unavailable</span>,
})
