// What a remote build gives code that imports `next/navigation` (the build
// aliases it here): the hooks on `@next-federation/router`, so they follow
// whichever host renders the remote. On the server the pathname and search
// params come from the router's server snapshot (the host's router, or `''`
// with no host router): never a guess from the request.
import { useMemo } from 'react'
import {
  useNavigate,
  usePathname as useRouterPathname,
  useSearchParams as useRouterSearchParams,
} from '@next-federation/router'
import type { ReadonlySearchParams } from '@next-federation/router'

export type { ReadonlySearchParams }

export type NavigateOptions = { scroll?: boolean }

export type AppRouterInstance = {
  push(href: string, options?: NavigateOptions): void
  replace(href: string, options?: NavigateOptions): void
  back(): void
  forward(): void
  /** No-op in a remote component. */
  refresh(): void
  /** No-op in a remote component. */
  prefetch(href: string): void
}

export function usePathname(): string {
  return useRouterPathname()
}

export function useSearchParams(): ReadonlySearchParams {
  return useRouterSearchParams()
}

const noop = (): void => {}

export function useRouter(): AppRouterInstance {
  const navigate = useNavigate()
  return useMemo<AppRouterInstance>(
    () => ({
      push: (href, options) => navigate(href, { scroll: options?.scroll }),
      replace: (href, options) =>
        navigate(href, { replace: true, scroll: options?.scroll }),
      back: () => history.back(),
      forward: () => history.forward(),
      refresh: noop,
      prefetch: noop,
    }),
    [navigate]
  )
}
