import { useCallback } from 'react'
import type { AnchorHTMLAttributes, ComponentType, ReactElement } from 'react'
import { anchorHref, checkedHref, localHref } from './safe-href.ts'
import { ROUTER_VERSION } from './version.ts'

export type NavigateOptions = { replace?: boolean; scroll?: boolean }
export type Navigate = (href: string, options?: NavigateOptions) => void
export type ReadonlySearchParams = Omit<
  URLSearchParams,
  'append' | 'delete' | 'set' | 'sort'
>
export type LinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
> & {
  href: string
  replace?: boolean
  scroll?: boolean
  /** Unset (undefined): the host Link's own default. */
  prefetch?: boolean | undefined
}
export type RouterImpl = {
  Link: ComponentType<LinkProps>
  useNavigate(): Navigate
  usePathname(): string
  useSearchParams(): ReadonlySearchParams
}

export type RouterModule = {
  Link: ComponentType<LinkProps>
  useNavigate: () => Navigate
  usePathname: () => string
  useSearchParams: () => ReadonlySearchParams
  createRouterModule: (impl: RouterImpl) => RouterModule
  provideRouter: typeof provideRouter
  ROUTER_SHARE_NAME: string
  ROUTER_VERSION: string
}

export const ROUTER_SHARE_NAME = '@next-federation/router'

export function createRouterModule(impl: RouterImpl): RouterModule {
  const ImplLink = impl.Link
  function RouterLink(props: LinkProps): ReactElement {
    // Anything but a path, query or fragment on this origin, as the browser
    // reads it (tabs and newlines removed, leading controls stripped), is a
    // plain anchor, never the host's Link; a script URL gets no href at all.
    if (localHref(props.href) === null) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { replace, scroll, prefetch, href, ...anchor } = props
      return <a {...anchor} href={anchorHref(href)} />
    }
    return <ImplLink {...props} />
  }
  const useImplNavigate = impl.useNavigate
  // Every navigation a remote asks for goes through the same-origin check,
  // whatever router the host has.
  function useNavigate(): Navigate {
    const navigate = useImplNavigate()
    return useCallback<Navigate>(
      (href, options) => {
        const safe = checkedHref(href)
        if (safe !== null) navigate(safe, options)
      },
      [navigate]
    )
  }
  return {
    Link: RouterLink,
    useNavigate,
    usePathname: impl.usePathname,
    useSearchParams: impl.useSearchParams,
    createRouterModule,
    provideRouter,
    ROUTER_SHARE_NAME,
    ROUTER_VERSION,
  }
}

export function provideRouter(
  module: RouterModule,
  register: (
    shared: Record<string, { version: string; module: unknown }>
  ) => void
): void {
  register({ [ROUTER_SHARE_NAME]: { version: ROUTER_VERSION, module } })
}
