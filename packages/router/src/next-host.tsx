// What a Next.js host shares as `next/link`, `next/navigation` and
// `next/router` with remotes that list them in `shared` (builds made before
// the rewiring, or a remote that opts out of it): Next's own modules with the
// same guards as every router module. Internal: `@next-federation/next`
// passes in Next's modules (this package imports no framework).
//
// - `Link` (`default` of next/link): an href (and `as`) that is not a path,
//   query or fragment on this origin is a plain anchor, and a script URL gets
//   no href at all (createRouterModule's rule); anything else is Next's Link
//   with the props as given.
// - `useRouter().push` and `replace` (both routers), the Pages Router's
//   `Router` singleton (`default`) and `withRouter`: only a same-origin
//   http(s) URL is followed (the navigate guard), anything else is dropped.
import {
  cloneElement,
  createElement,
  forwardRef,
  isValidElement,
  useMemo,
} from 'react'
import type { ComponentType, ReactElement, ReactNode, Ref } from 'react'
import { anchorHref, checkedHref, localHref } from './safe-href.ts'
import { formatHref } from './shims/next-link.tsx'
import type { UrlObject } from './shims/next-link.tsx'

/** Fields that give a URL object its own scheme or host. */
const AUTHORITY = ['protocol', 'slashes', 'auth', 'host', 'hostname', 'port']

/**
 * A Next.js URL (a string, or `{ pathname, query, hash }`) as a string;
 * undefined for a URL object that names a scheme or host, or anything else.
 */
function urlString(url: unknown): string | undefined {
  if (typeof url === 'string') return url
  if (typeof url !== 'object' || url === null) return undefined
  const fields = url as Record<string, unknown>
  if (AUTHORITY.some((key) => fields[key] != null && fields[key] !== '')) {
    return undefined
  }
  if (fields.pathname != null && typeof fields.pathname !== 'string') {
    return undefined
  }
  return formatHref(url as UrlObject)
}

/**
 * A module object like the one given, with some exports replaced. The other
 * exports are copied as they are defined, never read: Next's `next/router`
 * module object is its Router singleton, whose fields are getters that throw
 * where there is no router (the server).
 */
function withExports<T extends object>(
  module: T,
  exports: Record<string, unknown>
): T {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(module)) {
    if (Object.hasOwn(exports, key)) continue
    const descriptor = Object.getOwnPropertyDescriptor(module, key)!
    Object.defineProperty(out, key, { ...descriptor, configurable: true })
  }
  for (const [key, value] of Object.entries(exports)) {
    Object.defineProperty(out, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return Object.defineProperty(out, '__esModule', { value: true }) as T
}

type NextLinkProps = {
  href: unknown
  as?: unknown
  legacyBehavior?: boolean
  children?: ReactNode
  [prop: string]: unknown
}

/** `next/link` with its default export (the Link) guarded. */
export function guardNextLink<T extends object>(module: T): T {
  const NextLink = (module as { default: ComponentType<NextLinkProps> }).default
  // A ref reaches Next's Link or the anchor (React 18 passes no `ref` prop).
  const Link = forwardRef(function Link(
    received: Omit<NextLinkProps, 'ref'>,
    ref: Ref<HTMLAnchorElement>
  ): ReactElement {
    // `Omit` over the index signature drops `href`: the props are these.
    const props = received as NextLinkProps
    const href = urlString(props.href)
    const shown = props.as === undefined ? href : urlString(props.as)
    if (
      href !== undefined &&
      shown !== undefined &&
      localHref(href) !== null &&
      localHref(shown) !== null
    ) {
      return createElement(NextLink, ref === null ? props : { ...props, ref })
    }
    const {
      /* eslint-disable @typescript-eslint/no-unused-vars */
      href: _href,
      as: _as,
      replace,
      scroll,
      prefetch,
      shallow,
      passHref,
      locale,
      onNavigate,
      /* eslint-enable @typescript-eslint/no-unused-vars */
      legacyBehavior,
      children,
      ...anchor
    } = props
    const attribute = anchorHref(shown)
    // Legacy behaviour: the child `<a>` is the anchor, never an <a> in an <a>.
    if (legacyBehavior && isValidElement(children)) {
      return cloneElement(children as ReactElement<{ href?: string }>, {
        href: attribute,
      })
    }
    return createElement('a', { ...anchor, href: attribute, ref }, children)
  })
  return withExports(module, { default: Link })
}

type AppRouter = {
  push(href: string, options?: unknown): void
  replace(href: string, options?: unknown): void
}

/** `next/navigation` with `useRouter().push` and `replace` guarded. */
export function guardNextNavigation<T extends object>(module: T): T {
  const useNextRouter = (module as { useRouter: () => AppRouter }).useRouter
  function useRouter(): AppRouter {
    const router = useNextRouter()
    return useMemo(() => {
      const guard =
        (method: AppRouter['push']): AppRouter['push'] =>
        (href, options) => {
          const safe = checkedHref(href)
          if (safe !== null) method(safe, options)
        }
      return {
        ...router,
        push: guard(router.push),
        replace: guard(router.replace),
      }
    }, [router])
  }
  return withExports(module, { useRouter })
}

type PagesNavigate = (
  url: unknown,
  as?: unknown,
  options?: unknown
) => Promise<boolean>
type PagesRouter = { push: PagesNavigate; replace: PagesNavigate }

/** Same origin, both the route (`url`) and the URL shown (`as`). */
function guardPages(method: PagesNavigate): PagesNavigate {
  return (url, as, options) => {
    const target = urlString(url)
    const shown = as === undefined ? target : urlString(as)
    const safeTarget = target === undefined ? null : checkedHref(target)
    const safeShown =
      as === undefined || shown === undefined ? safeTarget : checkedHref(shown)
    if (safeTarget === null || safeShown === null) {
      return Promise.resolve(false)
    }
    // A string as the browser reads it; a URL object as given.
    return method(
      typeof url === 'string' ? safeTarget : url,
      typeof as === 'string' ? safeShown : as,
      options
    )
  }
}

/**
 * `next/router` with `useRouter().push` and `replace`, the `Router`
 * singleton (`default`) and `withRouter`'s router guarded.
 */
export function guardNextRouter<T extends object>(module: T): T {
  const next = module as {
    default: PagesRouter
    useRouter: () => PagesRouter | null
  }
  function useRouter(): PagesRouter | null {
    const router = next.useRouter()
    return useMemo(
      () =>
        router && {
          ...router,
          push: guardPages(router.push),
          replace: guardPages(router.replace),
        },
      [router]
    )
  }
  function withRouter<P extends object>(
    Composed: ComponentType<P & { router: PagesRouter | null }>
  ): ComponentType<P> {
    function WithRouter(props: P): ReactElement {
      return createElement(Composed, { router: useRouter(), ...props })
    }
    return WithRouter
  }
  // The singleton reads the current router on every access: keep it, with
  // its two navigations guarded.
  const singleton = next.default
  const exports: Record<string, unknown> = { useRouter, withRouter }
  if (typeof singleton === 'object' && singleton !== null) {
    exports.default = Object.create(singleton, {
      push: { value: guardPages((...args) => singleton.push(...args)) },
      replace: { value: guardPages((...args) => singleton.replace(...args)) },
    }) as PagesRouter
  }
  return withExports(module, exports)
}
