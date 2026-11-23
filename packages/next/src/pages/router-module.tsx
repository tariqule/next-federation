// `@next-federation/router` backed by the Pages Router: remote components that
// import it get the host's `next/link` and `next/router`, so links and
// `useNavigate` keep the host's basePath and locale.
//
// `usePathname` and `useSearchParams` read `asPath` (no basePath or locale).
// Before `router.isReady`, on a dynamic route or a fallback page, `asPath` can
// be the route pattern (`/item/[id]`) with no query; it updates once the
// router is ready.
import { useCallback, useMemo } from 'react'
import NextLink from 'next/link'
import { useRouter } from 'next/router'
import { createRouterModule } from '@next-federation/router'
import type {
  Navigate,
  ReadonlySearchParams,
  RouterModule,
} from '@next-federation/router'

function useNavigate(): Navigate {
  const router = useRouter()
  return useCallback(
    (href, options) => {
      const transitionOptions = { scroll: options?.scroll }
      if (options?.replace)
        void router.replace(href, undefined, transitionOptions)
      else void router.push(href, undefined, transitionOptions)
    },
    [router]
  )
}

// `asPath` without its hash, split at the first `?`.
function splitAsPath(asPath: string): [path: string, search: string] {
  const hash = asPath.indexOf('#')
  const url = hash === -1 ? asPath : asPath.slice(0, hash)
  const query = url.indexOf('?')
  return query === -1 ? [url, ''] : [url.slice(0, query), url.slice(query + 1)]
}

function usePathname(): string {
  return splitAsPath(useRouter().asPath)[0]
}

function useSearchParams(): ReadonlySearchParams {
  const search = splitAsPath(useRouter().asPath)[1]
  return useMemo(() => new URLSearchParams(search), [search])
}

export const nextPagesRouterModule: RouterModule = createRouterModule({
  Link: NextLink,
  useNavigate,
  usePathname,
  useSearchParams,
})
