'use client'

import { useRef } from 'react'
import type { ComponentProps, MouseEvent, ReactElement } from 'react'
import { useIslandBridge } from './bridge-context.tsx'

export type LinkProps = { href: string; prefetch?: boolean } & Omit<
  ComponentProps<'a'>,
  'href'
>

const isInternal = (href: string): boolean => /^\/(?![/\\])/.test(href)

/**
 * A real `<a href>` (works before hydration, with modifier clicks and in a new
 * tab). Plain left clicks go through the host bridge so the host router
 * navigates client-side. Internal hrefs get the host's basePath and locale.
 */
export function Link({
  href,
  prefetch,
  onClick,
  onMouseEnter,
  onFocus,
  target,
  download,
  ...rest
}: LinkProps): ReactElement {
  const bridge = useIslandBridge()
  const prefetched = useRef<string | null>(null)
  const internal = isInternal(href)
  const fullHref = internal
    ? bridge.basePath + (bridge.locale ? '/' + bridge.locale : '') + href
    : href

  const warm = (): void => {
    if (!internal || prefetch === false || prefetched.current === fullHref) {
      return
    }
    prefetched.current = fullHref
    bridge.prefetch(fullHref)
  }

  return (
    <a
      {...rest}
      href={fullHref}
      target={target}
      download={download}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e)
        if (
          !internal ||
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey ||
          (target !== undefined && target !== '_self') ||
          download !== undefined
        ) {
          return
        }
        e.preventDefault()
        bridge.navigate(fullHref)
      }}
      onMouseEnter={(e) => {
        onMouseEnter?.(e)
        warm()
      }}
      onFocus={(e) => {
        onFocus?.(e)
        warm()
      }}
    />
  )
}
