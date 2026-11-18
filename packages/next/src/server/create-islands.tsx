import { islandTags } from '@next-federation/core'
import { shortenEnclosingCache } from '@next-federation/next/island-cache'
import type { Federation } from '@next-federation/core'
import { NFError } from '@next-federation/sdk'
import { revalidateTag } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { Suspense } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { NextIslandMount } from '../client/next-island-mount.tsx'
import { hostBasePath } from './assert-wrapped.ts'
import { createIslandLoader } from './load-island.ts'
import type { AppIdentity, IslandSpec, LoadedIsland } from './load-island.ts'

export type RemoteIslandProps = IslandSpec & {
  /** Loading state, shown while the island loads. */
  fallback?: ReactNode
  /**
   * Shown when the remote is down, slow or invalid, when the visitor is
   * anonymous on a private island, and after an uncaught island error.
   * Defaults to `fallback`.
   */
  errorFallback?: ReactNode
  /**
   * When the island's code cannot load in the browser (its bootstrap,
   * `NF-011`: the remote is down or the build was retired), keep the server
   * HTML in place, not interactive (`inert`), instead of `errorFallback`.
   * Default: true without `errorFallback`, false with one. Set it with an
   * `errorFallback` to keep the HTML across a retired build (skew) while
   * still showing `errorFallback` after an island error.
   */
  inertOnLoadFailure?: boolean
  /**
   * Private islands only (`NF-002` on a public one). Renders the island
   * without its own `<Suspense>`, so its HTML is in the first flush, in
   * place: no `fallback` is streamed and swapped. The page's response waits
   * for the remote, up to the island timeout, and the route renders per
   * request (no static shell: `ƒ` in `next build`). With `cacheComponents`
   * the page must allow blocking with `export const instant = false`, or
   * Next fails the build. A `loading.tsx` or `<Suspense>` above the island
   * streams it again. Default: false.
   */
  blocking?: boolean
}

type LoaderProps = {
  spec: IslandSpec
  fallback: ReactNode
  errorFallback: ReactNode
  inertOnLoadFailure: boolean | undefined
}

/**
 * The App Router API:
 *
 * ```ts
 * export const { RemoteIsland, preloadIsland, revalidateIsland } =
 *   createIslands(federation, { getIdentity })
 * ```
 */
export function createIslands(
  federation: Federation,
  options: { getIdentity?: AppIdentity } = {}
): {
  RemoteIsland(props: RemoteIslandProps): ReactElement
  preloadIsland(spec: IslandSpec): void
  revalidateIsland(remote: string, island?: string): void
} {
  const load = createIslandLoader(federation, options)

  async function IslandLoader({
    spec,
    fallback,
    errorFallback,
    inertOnLoadFailure,
  }: LoaderProps): Promise<ReactElement> {
    const loaded: LoadedIsland = await load(spec)
    const onError = errorFallback ?? fallback ?? null
    // A failure (or the last good envelope standing in for one) must not be
    // kept by a host 'use cache' around this island.
    if (loaded.kind === 'failed' || (loaded.kind === 'ok' && loaded.stale)) {
      shortenEnclosingCache()
    }
    if (loaded.kind !== 'ok') return <>{onError}</>
    const { envelope, token } = loaded
    // The island's CSS links are rendered by `IslandMount`, as in every host.
    return (
      <NextIslandMount
        envelope={envelope}
        host={{ basePath: hostBasePath(), locale: spec.locale ?? '' }}
        token={token}
        errorFallback={onError}
        // Without its own errorFallback (unless the page says otherwise), an
        // island whose code cannot load in the browser keeps its server HTML
        // (inert) rather than `fallback`.
        inertOnLoadFailure={inertOnLoadFailure ?? errorFallback === undefined}
      />
    )
  }

  return {
    /**
     * Sync Server Component. It renders its own `<Suspense>`: with
     * `cacheComponents` a private island becomes a dynamic hole there (a
     * failed public one stays in the static shell, retried within seconds),
     * and a hydration error elsewhere in the host cannot client-render the
     * island's DOM away. `blocking` (private islands only) leaves the
     * boundary out, so the island renders in the shell: the nearest boundary
     * above it is the page's own (`loading.tsx`, a `<Suspense>`), if any,
     * which also takes the place of the island's for hydration errors.
     */
    RemoteIsland({
      fallback,
      errorFallback,
      inertOnLoadFailure,
      blocking,
      ...spec
    }) {
      if (blocking && !spec.private) {
        throw new NFError(
          'NF-002',
          `RemoteIsland "${spec.island}" from remote "${spec.remote}": \`blocking\` applies to private islands only. A public island is cached and already renders in place; remove \`blocking\` or add \`private\`.`
        )
      }
      const loader = (
        <IslandLoader
          spec={spec}
          fallback={fallback}
          errorFallback={errorFallback}
          inertOnLoadFailure={inertOnLoadFailure}
        />
      )
      if (blocking) return loader
      return <Suspense fallback={fallback}>{loader}</Suspense>
    },

    /**
     * Starts the island load early (e.g. in a layout). The later
     * `<RemoteIsland>` with an equal spec reuses the same request-scoped load.
     */
    preloadIsland(spec) {
      let pending: Promise<LoadedIsland>
      try {
        pending = load(spec)
      } catch (error) {
        unstable_rethrow(error)
        // NF-009 and the like: the render throws the same error.
        return
      }
      // Fire and forget: the render awaits this same promise and surfaces any
      // error there (Next's control-flow errors included), so it is not
      // rethrown here, where it would only become an unhandled rejection.
      pending.catch(() => {})
    },

    /** Expires the island's cache tag immediately (deploy webhooks). NF-001 for an unknown remote. */
    revalidateIsland(remote, island) {
      federation.target(remote)
      const tag = islandTags(remote, island).at(-1)!
      revalidateTag(tag, { expire: 0 })
    },
  }
}
