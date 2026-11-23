import { useCallback } from 'react'
import type { ReactElement } from 'react'
import {
  Link as RouterLink,
  useLocation,
  useNavigate as useRouterNavigate,
  useSearchParams as useRouterSearchParams,
} from 'react-router'
import { createRouterModule } from './create-router-module.tsx'
import type {
  LinkProps,
  Navigate,
  ReadonlySearchParams,
  RouterModule,
} from './create-router-module.tsx'

function Link(props: LinkProps): ReactElement {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { href, replace, scroll, prefetch, ...anchor } = props
  return (
    <RouterLink
      {...anchor}
      to={href}
      replace={replace}
      preventScrollReset={scroll === false}
    />
  )
}

function useNavigate(): Navigate {
  const navigate = useRouterNavigate()
  return useCallback(
    (href, options) =>
      void navigate(href, {
        replace: options?.replace,
        preventScrollReset: options?.scroll === false,
      }),
    [navigate]
  )
}

function usePathname(): string {
  return useLocation().pathname
}

function useSearchParams(): ReadonlySearchParams {
  return useRouterSearchParams()[0]
}

export function reactRouterModule(): RouterModule {
  return createRouterModule({ Link, useNavigate, usePathname, useSearchParams })
}
