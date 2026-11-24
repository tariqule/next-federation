import { useMemo, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { anchorHref, checkedHref } from './safe-href.ts'
import type {
  LinkProps,
  Navigate,
  ReadonlySearchParams,
} from './create-router-module.tsx'

type NavigationLike = EventTarget | undefined

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange)
  const nav = (globalThis as { navigation?: NavigationLike }).navigation
  nav?.addEventListener('currententrychange', onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    nav?.removeEventListener('currententrychange', onChange)
  }
}

const serverSnapshot = (): string => ''

export function Link(props: LinkProps): ReactElement {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { replace, scroll, prefetch, href, ...anchor } = props
  // Never a `javascript:`, `vbscript:` or `data:` href.
  return <a {...anchor} href={anchorHref(href)} />
}

const navigate: Navigate = (href, options) => {
  // Same origin only: never a `javascript:` URL or another site.
  const safe = checkedHref(href)
  if (safe === null) return
  if (options?.replace) location.replace(safe)
  else location.assign(safe)
}

export function useNavigate(): Navigate {
  return navigate
}

export function usePathname(): string {
  return useSyncExternalStore(
    subscribe,
    () => location.pathname,
    serverSnapshot
  )
}

export function useSearchParams(): ReadonlySearchParams {
  const search = useSyncExternalStore(
    subscribe,
    () => location.search,
    serverSnapshot
  )
  return useMemo(() => new URLSearchParams(search), [search])
}
