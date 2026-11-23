// The router module a host builds from its own router's hooks
// (`provideNavigation` in `@next-federation/react/components`). Internal: no
// application imports it.
import { useCallback, useMemo } from 'react'
import type { MouseEvent, ReactElement } from 'react'
import { createRouterModule } from './create-router-module.tsx'
import type {
  LinkProps,
  Navigate,
  ReadonlySearchParams,
  RouterModule,
} from './create-router-module.tsx'
import { sameOriginHref } from './safe-href.ts'
import {
  usePathname as useDocumentPathname,
  useSearchParams as useDocumentSearchParams,
} from './document-router.tsx'

/**
 * What a host's router gives remote components: React Router's own hooks
 * fit as they are (`provideNavigation({ useNavigate, useHref, useLocation })`).
 * - `useNavigate()`: returns the function that navigates to an href.
 * - `useHref(href)`: the href to render (with the host's basename). Default:
 *   the href unchanged.
 * - `useLocation()`: the current pathname and search, without the basename.
 *   Default: the document's location.
 */
export type NavigationHooks = {
  useNavigate(): (
    href: string,
    options?: { replace?: boolean; scroll?: boolean }
  ) => void
  useHref?(href: string): string
  useLocation?(): { pathname: string; search: string }
}

/** A click the browser should handle itself (new tab, download, ...). */
function isBrowserClick(
  event: MouseEvent<HTMLAnchorElement>,
  target: string | undefined,
  download: unknown
): boolean {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    (target !== undefined && target !== '' && target !== '_self') ||
    download !== undefined
  )
}

/**
 * Builds the `@next-federation/router` module from a host's hooks. Each
 * optional hook is present or absent for the module's lifetime, so the hooks
 * a component calls never change between renders.
 */
export function navigationModule(hooks: NavigationHooks): RouterModule {
  const useHostHref = hooks.useHref
  const useHostLocation = hooks.useLocation

  function useNavigate(): Navigate {
    const navigate = hooks.useNavigate()
    return useCallback<Navigate>(
      (href, options) => navigate(href, options),
      [navigate]
    )
  }

  function Link(props: LinkProps): ReactElement {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { href, replace, scroll, prefetch, onClick, ...anchor } = props
    const navigate = hooks.useNavigate()
    const rendered = useHostHref ? useHostHref(href) : href
    return (
      <a
        {...anchor}
        href={rendered}
        onClick={(event) => {
          onClick?.(event)
          if (isBrowserClick(event, anchor.target, anchor.download)) return
          // Not on this origin (e.g. `/\t/x`): the browser follows the anchor.
          const safe = sameOriginHref(href)
          if (safe === null) return
          event.preventDefault()
          navigate(safe, { replace, scroll })
        }}
      />
    )
  }

  const usePathname = useHostLocation
    ? (): string => useHostLocation().pathname
    : useDocumentPathname

  const useSearchParams = useHostLocation
    ? (): ReadonlySearchParams => {
        const search = useHostLocation().search
        return useMemo(() => new URLSearchParams(search), [search])
      }
    : useDocumentSearchParams

  return createRouterModule({ Link, useNavigate, usePathname, useSearchParams })
}
