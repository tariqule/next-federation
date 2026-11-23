import * as React from 'react'
import * as ReactDOM from 'react-dom'
import type { Thenable } from './components/runtime.ts'

/**
 * React 18 / 19 differences the library bridges. React 19 takes the same
 * calls the library always made; React 18 takes the fallbacks below.
 */

const PRECEDENCE = 'next-federation'

/** React DOM 19 resource APIs (`preinit`, `preload`, `preloadModule`) exist. */
export function supportsResources(): boolean {
  return typeof (ReactDOM as { preinit?: unknown }).preinit === 'function'
}

/**
 * Make a stylesheet available in `<head>`: idempotent, safe during render,
 * client only. React 19 hoists it through `preinit`; React 18 has no
 * resources, so a `<link>` goes at the end of `<head>`. An inline link in
 * `<body>` does not count: it leaves with the component that rendered it.
 */
export function ensureStylesheet(href: string): void {
  if (supportsResources()) {
    ReactDOM.preinit(href, { as: 'style', precedence: PRECEDENCE })
    return
  }
  if (typeof document === 'undefined') return
  for (const link of document.head.querySelectorAll('link[data-nf-css]')) {
    if (link.getAttribute('href') === href) return
  }
  const link = document.createElement('link')
  link.setAttribute('rel', 'stylesheet')
  link.setAttribute('href', href)
  link.setAttribute('data-precedence', PRECEDENCE)
  link.setAttribute('data-nf-css', '')
  document.head.appendChild(link)
}

/** React 19: `use(thenable)`. React 18: the Suspense protocol by hand. */
export function readThenable<T>(thenable: Thenable<T>): T {
  const use = (React as { use?: <V>(value: Thenable<V>) => V }).use
  if (typeof use === 'function') return use(thenable)
  if (thenable.status === 'fulfilled') return thenable.value as T
  if (thenable.status === 'rejected') throw thenable.reason
  throw thenable
}

/** React 19: `preload(href, { as: 'style' })`. React 18: nothing. */
export function preloadStyle(href: string): void {
  if (supportsResources()) ReactDOM.preload(href, { as: 'style' })
}

/** React 19: `preloadModule(href)`. React 18: nothing. */
export function preloadModuleScript(href: string): void {
  if (supportsResources()) ReactDOM.preloadModule(href)
}

/** `useLayoutEffect` where there is a `document`; `useEffect` on the server. */
export const useIsomorphicLayoutEffect: typeof React.useLayoutEffect =
  typeof document === 'undefined' ? React.useEffect : React.useLayoutEffect
