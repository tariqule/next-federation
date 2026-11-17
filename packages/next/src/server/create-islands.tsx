import { islandTags } from '@next-federation/core'
import { shortenEnclosingCache } from '@next-federation/next/island-cache'
import type { Federation } from '@next-federation/core'
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
}

type LoaderProps = {
  spec: IslandSpec
  fallback: ReactNode
  errorFallback: ReactNode
  inertOnLoadFailure: boolean | undefined
}

/**
 * The App Router API (design §6):
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
    // A failure must not be kept by a host 'use cache' around this island.
    if (loaded.kind === 'failed') shortenEnclosingCache()
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
     * Sync Server Component. It always renders its own `<Suspense>`: with
     * `cacheComponents` a failed or private island becomes a dynamic hole
     * there, and a hydration error elsewhere in the host cannot client-render
     * the island's DOM away.
     */
    RemoteIsland({ fallback, errorFallback, inertOnLoadFailure, ...spec }) {
      return (
        <Suspense fallback={fallback}>
          <IslandLoader
            spec={spec}
            fallback={fallback}
            errorFallback={errorFallback}
            inertOnLoadFailure={inertOnLoadFailure}
          />
        </Suspense>
      )
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
