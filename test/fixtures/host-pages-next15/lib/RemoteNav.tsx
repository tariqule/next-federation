'use client'
import { createRemoteComponent } from '@next-federation/next/pages/components'

// A remote component on this host's own next/link and next/router
// (@next-federation/next/pages/components provides them).
export const RemotePagesNavLink = createRemoteComponent<{
  href: string
  label: string
}>({
  expose: './PagesNavLink',
  fallback: <span data-testid="pages-nav-fallback">pages nav unavailable</span>,
})
