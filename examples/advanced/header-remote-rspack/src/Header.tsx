import Link from 'next/link'
import { useSession } from 'example-session-context'

/**
 * The site header's navigation, a remote component. Its links are plain
 * `next/link`: the build rewires that import (rspack.config.ts), so they
 * navigate with whatever router the host has (the storefront's App or Pages
 * Router, with its `/store` basePath; an SPA's router through
 * `provideNavigation`), and do full page loads in a host with none. It reads
 * who is signed in from the host's session context (a host-provided shared
 * module).
 */
export default function Header({
  links,
}: {
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
