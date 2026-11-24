// What a remote build gives code that imports `next/link` (the build aliases
// it here): the same component on `@next-federation/router`, so the link
// navigates through whichever host renders the remote.
import { isValidElement } from 'react'
import type { AnchorHTMLAttributes, ReactElement, ReactNode } from 'react'
import { Link as RouterLink } from '@next-federation/router'
import { warnOnceInDevelopment } from '../dev-warning.ts'

/** A query value as Next.js accepts it: arrays repeat the key. */
export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<string | number | boolean | null | undefined>

export type UrlObject = {
  pathname?: string
  query?: Record<string, QueryValue>
  hash?: string
}

export type LinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
> & {
  href: string | UrlObject
  replace?: boolean
  scroll?: boolean
  prefetch?: boolean | 'auto' | null
  children?: ReactNode
  /**
   * The URL shown and navigated to, when given (Pages-era
   * `href="/post/[pid]" as="/post/1"`).
   */
  as?: string | UrlObject
  /** Ignored (one development warning). */
  locale?: string | false
  /**
   * The single element child (an `<a>`) gives its props and children to the
   * rendered anchor, as Next.js's legacy behaviour does.
   */
  legacyBehavior?: boolean
  /** Ignored (one development warning): the anchor always has the href. */
  passHref?: boolean
  /** Ignored (one development warning). */
  shallow?: boolean
  /** Ignored (one development warning). */
  onNavigate?: (event: { preventDefault(): void }) => void
}

const IGNORED = ['locale', 'passHref', 'shallow', 'onNavigate'] as const

/** One query value as Next.js writes it: numbers and booleans as strings. */
function queryParam(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && !Number.isNaN(value)) return String(value)
  return typeof value === 'boolean' ? String(value) : ''
}

/**
 * `{ pathname, query, hash }` as an href, the query as Next.js writes it
 * (`{ a: ['1', '2'] }` is `a=1&a=2`); a string stays as it is.
 */
export function formatHref(href: string | UrlObject): string {
  if (typeof href === 'string') return href
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(href.query ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value as unknown[]) {
        params.append(key, queryParam(item))
      }
    } else {
      params.set(key, queryParam(value))
    }
  }
  const query = params.toString()
  const hash = href.hash ? (href.hash.startsWith('#') ? '' : '#') : ''
  return `${href.pathname ?? ''}${query ? `?${query}` : ''}${hash}${href.hash ?? ''}`
}

export default function Link(props: LinkProps): ReactElement {
  const { href, as, prefetch, legacyBehavior, children, ...rest } = props
  const anchor: Record<string, unknown> = rest
  for (const name of IGNORED) {
    if (anchor[name] === undefined) continue
    warnOnceInDevelopment(
      `next/link:${name}`,
      `next/link's "${name}" is ignored in a remote component: the link navigates through the host's router.`
    )
    delete anchor[name]
  }
  // Legacy behaviour: `<Link legacyBehavior><a className="x">text</a></Link>`
  // renders one anchor with the child's props, never an <a> in an <a>.
  const child =
    legacyBehavior && isValidElement<Record<string, unknown>>(children)
      ? children
      : null
  const { children: childChildren, ...childProps } = child?.props ?? {}
  return (
    <RouterLink
      {...(anchor as Omit<
        LinkProps,
        'href' | 'as' | 'legacyBehavior' | (typeof IGNORED)[number]
      >)}
      {...childProps}
      href={formatHref(as ?? href)}
      // true or false as given; anything else (unset, 'auto', null) is the
      // host Link's own default (Next.js prefetches).
      prefetch={typeof prefetch === 'boolean' ? prefetch : undefined}
    >
      {child ? (childChildren as ReactNode) : children}
    </RouterLink>
  )
}
