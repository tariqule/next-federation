import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * For App Router hosts: the host's own `next/link` and `next/navigation`
 * (host-provided shared modules), so the link navigates through the host's
 * router. Any other host renders its fallback (NF-036).
 */
export default function NavLink({
  href,
  label,
}: {
  href: string
  label: string
}) {
  const pathname = usePathname()
  return (
    <span data-testid="remote-nav">
      <Link href={href} data-testid="remote-link">
        {label}
      </Link>{' '}
      <span data-testid="remote-pathname">{pathname}</span>
    </span>
  )
}
