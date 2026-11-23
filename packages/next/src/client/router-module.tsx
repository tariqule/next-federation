// `@next-federation/router` backed by the App Router: remote components that
// import it get the host's `next/link` and `next/navigation`. The hooks are
// Next's own (no wrapper), so `usePathname` never reads the search params and
// a static page stays static.
import { useCallback } from 'react'
import NextLink from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { createRouterModule } from '@next-federation/router'
import type { Navigate, RouterModule } from '@next-federation/router'

function useNavigate(): Navigate {
  const router = useRouter()
  return useCallback(
    (href, options) => {
      const navigateOptions = { scroll: options?.scroll }
      if (options?.replace) router.replace(href, navigateOptions)
      else router.push(href, navigateOptions)
    },
    [router]
  )
}

export const nextAppRouterModule: RouterModule = createRouterModule({
  Link: NextLink,
  useNavigate,
  usePathname,
  useSearchParams,
})
