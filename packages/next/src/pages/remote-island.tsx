import { IslandMount } from '@next-federation/react'
import { useRouter } from 'next/router'
import { useMemo } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { toPagesRouterHref } from '../bridge.ts'
import type { IslandProps } from './create-pages-islands.ts'

export type RemoteIslandProps = IslandProps & {
  /** Shown when `envelope` is null (when `errorFallback` is not given). */
  fallback?: ReactNode
  /**
   * Shown when the remote failed or the visitor is anonymous on a private
   * island (`envelope: null`), and after an uncaught island error. Defaults
   * to `fallback`.
   */
  errorFallback?: ReactNode
}

/**
 * Pages Router island mount: spread the result of `getIslandProps` into it.
 * `IslandMount` renders the island's CSS: React stylesheet resources, in the
 * server HTML ahead of the island, not `next/head` (which Next warns about).
 * Island links navigate through `next/router`, whose `push()` adds `basePath`
 * and the locale itself, so the bridge hands it a bare path plus the locale
 * found in the island's href.
 */
export function RemoteIsland(props: RemoteIslandProps): ReactElement {
  const { envelope, host, token, fallback, errorFallback } = props
  const onError = errorFallback ?? fallback ?? null
  const router = useRouter()
  const { basePath, locale } = host
  const bridge = useMemo(() => {
    const target = (href: string) =>
      toPagesRouterHref(
        href,
        router.basePath,
        router.locales ?? [],
        router.defaultLocale
      )
    return {
      basePath,
      locale,
      navigate: (href: string) => {
        const to = target(href)
        void router.push(to.href, undefined, { locale: to.locale })
      },
      prefetch: (href: string) => {
        const to = target(href)
        void router.prefetch(to.href, undefined, { locale: to.locale })
      },
    }
  }, [router, basePath, locale])
  if (!envelope) return <>{onError}</>
  return (
    <IslandMount
      envelope={envelope}
      bridge={bridge}
      token={token}
      errorFallback={onError}
      // Without its own errorFallback, an island whose code cannot load in
      // the browser keeps its server HTML (inert) rather than `fallback`.
      inertOnLoadFailure={errorFallback === undefined}
    />
  )
}
