import Link from 'next/link'
import { useRouter } from 'next/router'

/**
 * For Pages Router hosts: the host's own `next/link` and `next/router`, so
 * the link keeps the host's basePath and locale. Any other host renders its
 * fallback (NF-036).
 */
export default function PagesNavLink({
  href,
  label,
}: {
  href: string
  label: string
}) {
  const router = useRouter()
  return (
    <span data-testid="remote-pages-nav">
      <Link href={href} data-testid="remote-pages-link">
        {label}
      </Link>{' '}
      <span data-testid="remote-router">
        {router.pathname} {router.locale ?? 'no-locale'}
      </span>
    </span>
  )
}
