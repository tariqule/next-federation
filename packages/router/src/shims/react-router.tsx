// What a remote build gives code that imports `react-router` or
// `react-router-dom` (the build aliases both here): every export of the real
// package, with Link, NavLink, useNavigate, useLocation, useSearchParams and
// useHref replaced.
//
// Each replacement asks `useInRouterContext()` first. Inside a router (a
// `MemoryRouter` the remote renders for its own routes, or a React Router
// host) it is the real export, unchanged. Outside any router it goes through
// `@next-federation/router`, so the remote navigates with the host's router.
// Whether a component is inside a router depends only on its ancestors: it
// cannot change without the component remounting, so the hooks each
// replacement calls are the same on every render of one mount.
//
// The real package is imported as `@next-federation/router/real-react-router`,
// which the build aliases to the remote's own `react-router` directory: an
// import of `react-router` here would be aliased back to this file.
import { useCallback, useMemo } from 'react'
import type { ReactElement, ReactNode } from 'react'
import {
  Link as RealLink,
  NavLink as RealNavLink,
  createPath,
  createSearchParams,
  useHref as useRealHref,
  useInRouterContext,
  useLocation as useRealLocation,
  useNavigate as useRealNavigate,
  useSearchParams as useRealSearchParams,
} from '@next-federation/router/real-react-router'
import type {
  LinkProps,
  Location,
  NavLinkProps,
  NavLinkRenderProps,
  NavigateFunction,
  NavigateOptions,
  SetURLSearchParams,
  To,
  URLSearchParamsInit,
} from '@next-federation/router/real-react-router'
import {
  Link as HostLink,
  useNavigate as useHostNavigate,
  usePathname as useHostPathname,
  useSearchParams as useHostSearchParams,
} from '@next-federation/router'
import { anchorHref, localHref } from '../safe-href.ts'

export * from '@next-federation/router/real-react-router'

const toHref = (to: To): string =>
  typeof to === 'string' ? to : createPath(to)

/** React Router-only props an `<a>` must not get. */
function anchorProps<P extends LinkProps>(
  props: P
): Omit<
  P,
  | 'to'
  | 'replace'
  | 'state'
  | 'preventScrollReset'
  | 'relative'
  | 'reloadDocument'
  | 'viewTransition'
  | 'discover'
  | 'prefetch'
> {
  const {
    /* eslint-disable @typescript-eslint/no-unused-vars */
    to,
    replace,
    state,
    preventScrollReset,
    relative,
    reloadDocument,
    viewTransition,
    discover,
    prefetch,
    /* eslint-enable @typescript-eslint/no-unused-vars */
    ...anchor
  } = props
  return anchor
}

function OutsideLink(props: LinkProps): ReactElement {
  const href = toHref(props.to)
  const anchor = anchorProps(props)
  // A full page load was asked for: the browser follows the link.
  // Never a `javascript:`, `vbscript:` or `data:` href.
  if (props.reloadDocument) return <a {...anchor} href={anchorHref(href)} />
  return (
    <HostLink
      {...anchor}
      href={href}
      replace={props.replace}
      scroll={!props.preventScrollReset}
    />
  )
}

export function Link(props: LinkProps): ReactElement {
  return useInRouterContext() ? (
    <RealLink {...props} />
  ) : (
    <OutsideLink {...props} />
  )
}

/** React Router's rule: the path itself or one below it (`end`: itself only). */
function isActivePath(
  pathname: string,
  to: string,
  end: boolean | undefined,
  caseSensitive: boolean | undefined
): boolean {
  const toPath = to.split(/[?#]/)[0]!
  const target = caseSensitive ? toPath : toPath.toLowerCase()
  const current = caseSensitive ? pathname : pathname.toLowerCase()
  const base = target.length > 1 ? target.replace(/\/+$/, '') : target
  if (current === base) return true
  if (end || base === '' || base === '/') return false
  return current.startsWith(`${base}/`)
}

function OutsideNavLink(props: NavLinkProps): ReactElement {
  const {
    caseSensitive,
    end,
    'aria-current': ariaCurrent = 'page',
    className,
    style,
    children,
    ...link
  } = props
  const pathname = useHostPathname()
  const href = toHref(props.to)
  const isActive = isActivePath(pathname, href, end, caseSensitive)
  const render: NavLinkRenderProps = {
    isActive,
    isPending: false,
    isTransitioning: false,
  }
  return (
    <OutsideLink
      {...link}
      aria-current={isActive ? ariaCurrent : undefined}
      className={
        typeof className === 'function' ? className(render) : className
      }
      style={typeof style === 'function' ? style(render) : style}
    >
      {
        (typeof children === 'function'
          ? children(render)
          : children) as ReactNode
      }
    </OutsideLink>
  )
}

export function NavLink(props: NavLinkProps): ReactElement {
  return useInRouterContext() ? (
    <RealNavLink {...props} />
  ) : (
    <OutsideNavLink {...props} />
  )
}

function useOutsideNavigate(): NavigateFunction {
  const navigate = useHostNavigate()
  return useCallback(
    (to: To | number, options?: NavigateOptions) => {
      if (typeof to === 'number') {
        history.go(to)
        return
      }
      navigate(toHref(to), {
        replace: options?.replace,
        scroll: !options?.preventScrollReset,
      })
    },
    [navigate]
  ) as NavigateFunction
}

export function useNavigate(): NavigateFunction {
  // See the file comment: the same branch on every render of one mount.
  return useInRouterContext() ? useRealNavigate() : useOutsideNavigate()
}

function useOutsideLocation(): Location {
  const pathname = useHostPathname()
  const params = useHostSearchParams()
  const query = params.toString()
  return useMemo(
    () => ({
      pathname,
      search: query ? `?${query}` : '',
      hash: '',
      state: null,
      key: 'default',
    }),
    [pathname, query]
  )
}

export function useLocation(): Location {
  return useInRouterContext() ? useRealLocation() : useOutsideLocation()
}

function useOutsideSearchParams(): [URLSearchParams, SetURLSearchParams] {
  // The host's object can be read-only (Next.js): React Router gives a
  // URLSearchParams the remote may change, so this is a copy.
  const query = useHostSearchParams().toString()
  const params = useMemo(() => new URLSearchParams(query), [query])
  const navigate = useHostNavigate()
  const setParams = useCallback<SetURLSearchParams>(
    (next, options) => {
      const value =
        typeof next === 'function' ? next(new URLSearchParams(query)) : next
      navigate(`?${createSearchParams(value as URLSearchParamsInit)}`, {
        replace: options?.replace,
        scroll: !options?.preventScrollReset,
      })
    },
    [navigate, query]
  )
  return [params, setParams]
}

export function useSearchParams(
  defaultInit?: URLSearchParamsInit
): [URLSearchParams, SetURLSearchParams] {
  return useInRouterContext()
    ? useRealSearchParams(defaultInit)
    : useOutsideSearchParams()
}

export function useHref(
  to: To,
  options?: { relative?: 'route' | 'path' }
): string {
  if (useInRouterContext()) return useRealHref(to, options)
  // Outside a router there is no basename to add (the host's Link adds its
  // own when it renders). A value that would leave this origin (another
  // site, `javascript:`) becomes a path on it, as React Router does.
  const href = toHref(to)
  return localHref(href) ?? outsideOrigin(href)
}

/** `/` + the value, its leading slashes and controls removed: always this origin. */
function outsideOrigin(href: string): string {
  return `/${href.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020\\/]+/, '')}`
}
