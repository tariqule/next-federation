import type { ComponentType, ReactNode } from 'react'
import { useSession } from 'example-session-context'

type LinkProps = { href: string; className?: string; children: ReactNode }

/**
 * The site header's navigation, a remote component. It runs on the host's
 * React, so the host passes its own router's link component as a prop
 * (`next/link` in a Next.js host, a client router's link in an SPA): links
 * then navigate with the host's router. It reads who is signed in from the
 * host's session context (a host-provided shared module).
 */
export default function Header({
  Link,
  links,
}: {
  Link: ComponentType<LinkProps>
  links: { href: string; label: string }[]
}) {
  const { user, role } = useSession()
  return (
    <nav aria-label="Site" data-build={__BUILD_ID__}>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="header-link">
          {l.label}
        </Link>
      ))}
      <span className="header-user">
        {user ? `${user}${role === 'admin' ? ' (admin)' : ''}` : 'guest'}
      </span>
    </nav>
  )
}
