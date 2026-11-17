import { fetchIsland, islandTags } from '@next-federation/core'
import type {
  ComponentTarget,
  FetchIslandRequest,
  IslandTarget,
} from '@next-federation/core'
import { fetchVerifiedComponentDescriptor } from '@next-federation/core/components'
import type { VerifiedDescriptorResult } from '@next-federation/core/components'
import { componentTrustRegistry } from '@next-federation/protocol'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import { logger } from '@next-federation/sdk'
import { cacheLife, cacheTag } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { markFresh } from './fresh-mark.ts'
import type { MarkedIslandResult } from './fresh-mark.ts'

// Next 16's built-in 'seconds' profile values (stale 30, revalidate 1,
// expire 60), inlined: a host may redefine the named profile in next.config
// `cacheLife`, which would freeze failures again.
const FAILURE_LIFE = { stale: 30, revalidate: 1, expire: 60 }

/**
 * Public island envelope for hosts with `cacheComponents`: `'use cache'` with
 * `cacheLife` and the `nf:<remote>`, `nf:<remote>:<island>` tags.
 *
 * A failure is returned, not thrown: Next fails a build-time prerender on any
 * error raised inside `'use cache'`, even one caught outside. Instead a failure
 * switches to a short inline profile (the shorter profile wins). Next
 * keeps short-lived entries out of the static shell and renders them as
 * dynamic holes, so a failed remote is never frozen into a static page and is
 * retried within about a second (a failure may be served stale once while the
 * background refresh runs), while a working remote stays cached for minutes.
 *
 * There is no `catch` here, so Next's control-flow errors always propagate.
 * Every argument is plain data, because it is part of the cache key.
 */
export async function getPublicEnvelope(
  target: IslandTarget,
  island: string,
  propsJson: string,
  hostJson: string,
  revalidate: number
): Promise<MarkedIslandResult> {
  'use cache'
  cacheLife({
    stale: 300,
    revalidate,
    expire: Math.max(3600, revalidate * 2),
  })
  cacheTag(...islandTags(target.remote, island))
  const result = await fetchIsland(target, {
    island,
    props: JSON.parse(propsJson) as unknown,
    host: JSON.parse(hostJson) as FetchIslandRequest['host'],
  })
  if (!result.ok) cacheLife(FAILURE_LIFE)
  // Stored with the entry: a cache hit returns the mark of this run, which the
  // caller already took, so the hit is not reported as a new fetch.
  return markFresh(result)
}

/**
 * Called by `RemoteIsland` after a failed load. When the island renders
 * inside the host's own `'use cache'` scope, an explicit `cacheLife` there
 * would keep the failure for that scope's whole lifetime (Next does not let an
 * inner, shorter lifetime override an explicit outer one). `cacheLife()` keeps
 * the shortest call made in a scope, so this makes the enclosing entry
 * short-lived as well: a dynamic hole, retried like the island's own entry.
 * Outside a `'use cache'` scope `cacheLife()` throws; that case is ignored.
 */
export function shortenEnclosingCache(): void {
  try {
    cacheLife(FAILURE_LIFE)
  } catch (error) {
    unstable_rethrow(error)
  }
}

/**
 * Mode A: a components remote's verified build descriptor, for hosts with
 * `cacheComponents`: `'use cache'` with a `cacheLife` of at least minutes
 * (a shorter one makes the entry dynamic). A failure is returned with the
 * short failure profile, like an island envelope, so it is never frozen
 * into a static page. Verification runs inside the cache scope (WebCrypto
 * work outside it would make the prerender treat it as uncached I/O). No
 * in-process cache: Next must see this fetch.
 */
export async function getDescriptorFile(
  target: ComponentTarget
): Promise<VerifiedDescriptorResult> {
  'use cache'
  cacheLife({
    stale: 300,
    revalidate: target.revalidate,
    expire: Math.max(3600, target.revalidate * 2),
  })
  cacheTag(...islandTags(target.remote))
  const result = await fetchVerifiedComponentDescriptor(target)
  if (!result.ok) cacheLife(FAILURE_LIFE)
  return result
}

/**
 * A short-lived cache entry: an App Router render that uses it is left out
 * of the static shell (a dynamic hole, rendered per request) and the page
 * is regenerated soon, as for a failed island.
 */
async function notServerReadyYet(base: string): Promise<string> {
  'use cache'
  cacheLife(FAILURE_LIFE)
  return base
}

/**
 * Remote components on a static page (`cacheComponents`, after
 * `next start`): a regeneration in a process whose server loader has not
 * loaded the build yet would render the component's fallback (Next ends the
 * HTML prerender before the build has loaded) and keep it as the page for a
 * whole revalidate window. Such a render is kept out of the static shell
 * instead: the boundary renders per request (where the server waits for the
 * build) until a regeneration finds the build loaded or refused. Not during
 * `next build` (that would turn a static route dynamic) or `next dev`.
 */
export async function skipStaticShellUntilReady(
  descriptor: RemoteComponentDescriptor | null
): Promise<void> {
  if (!descriptor?.ssr) return
  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_PHASE === 'phase-production-build'
  ) {
    return
  }
  if (componentTrustRegistry().serverReady?.has(descriptor.base)) return
  logger.warnOnce(
    'NF-039',
    `not-loaded:${descriptor.base}`,
    `Build "${descriptor.buildId}" of "${descriptor.remote}" is not loaded in this server process yet: this render leaves its remote components to request time (each request waits for the build) instead of keeping their fallback in the static page, and the page regenerates once it is loaded.`
  )
  shortenEnclosingCache()
  await notServerReadyYet(descriptor.base)
}
