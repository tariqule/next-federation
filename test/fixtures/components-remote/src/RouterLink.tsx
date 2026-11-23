import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * A remote written with its own router: `next/link` and `next/navigation`,
 * unchanged. The components build rewires both imports, so the one build
 * navigates through whichever host renders it (Next.js App or Pages Router,
 * a host that calls `provideNavigation`), else with full page loads. Also
 * built by the Rspack fixture (components-remote-rspack exposes this file).
 * `external`: an absolute URL, always a plain anchor in every host.
 */
export default function RouterLink({ external }: { external?: string }) {
  const pathname = usePathname()
  return (
    <span data-testid="router-link-root">
      <Link href="/router/next" data-testid="router-link">
        to router next
      </Link>{' '}
      <span data-testid="router-pathname">{pathname}</span>
      {external ? (
        <>
          {' '}
          <Link href={external} data-testid="router-external">
            external
          </Link>
        </>
      ) : null}
    </span>
  )
}
