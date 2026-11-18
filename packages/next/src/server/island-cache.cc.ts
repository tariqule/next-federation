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

/**
 * A failed fetch (island envelope or components descriptor): retried within
 * about 5 s, and still part of the static shell. Next leaves an entry whose
 * `expire` is under 300 s (or whose `revalidate` is 0) out of a static
 * prerender, as a dynamic hole. That is a trap for a failure on a static
 * page: the regenerated shell no longer holds the island's cache entry, so
 * it gets `revalidate: false` and Next never regenerates it again. The page
 * stays a partial prerender (`private, no-store`) after the remote recovers,
 * and across restarts, since Next keeps it in `.next/server/route-cache`
 * (where its RSC requests then answer 404). An `expire` well above 300 s
 * keeps the failure in the shell with a short `revalidate`: the page stays
 * static and is regenerated within seconds.
 * Inlined, not a named profile: a host may redefine those in next.config.
 */
const FAILURE_LIFE = { stale: 30, revalidate: 5, expire: 600 }

/**
 * NF-039 only: a render deliberately left out of the static shell (Next's
 * built-in 'seconds' values, inlined). The page's descriptor entries stay in
 * the shell, so the page keeps a finite revalidate and is regenerated. Never
 * applied to a host's own `'use cache'` scope (see
 * `skipStaticShellUntilReady`).
 */
const DEFER_LIFE = { stale: 30, revalidate: 1, expire: 60 }

/**
 * Public island envelope for hosts with `cacheComponents`: `'use cache'` with
 * `cacheLife` and the `nf:<remote>`, `nf:<remote>:<island>` tags.
 *
 * A failure is returned, not thrown: Next fails a build-time prerender on any
 * error raised inside `'use cache'`, even one caught outside. Instead a
 * failure switches to `FAILURE_LIFE` (the shorter profile wins): the page
 * stays static and is regenerated within seconds, while a working remote
 * stays cached for minutes. The caller (`loadIsland`) renders the island's
 * last good envelope in place of a failure when it has one (stale-if-error).
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
  // caller already took, so the hit is not reported as a new fetch. The time
  // is read here, in the cache scope (a prerender may not read it outside).
  return markFresh(result, Date.now())
}

/**
 * Called by `RemoteIsland` after a failed load (no last good envelope). When
 * the island renders inside the host's own `'use cache'` scope, an explicit
 * `cacheLife` there would keep the failure for that scope's whole lifetime
 * (Next does not let an inner, shorter lifetime override an explicit outer
 * one). `cacheLife()` keeps the shortest call made in a scope, so this gives
 * the enclosing entry the failure profile as well: still cached (and part of
 * a static shell), retried within seconds like the island's own entry.
 * Outside a `'use cache'` scope `cacheLife()` throws; that case is ignored.
 */
export function shortenEnclosingCache(): void {
  shortenTo(FAILURE_LIFE)
}

/** True when it ran inside a `'use cache'` scope (it throws outside one). */
function shortenTo(life: typeof FAILURE_LIFE): boolean {
  try {
    cacheLife(life)
    return true
  } catch (error) {
    unstable_rethrow(error)
    return false
  }
}

/**
 * Mode A: a components remote's verified build descriptor, for hosts with
 * `cacheComponents`: `'use cache'` with a `cacheLife` of at least minutes
 * (a shorter one makes the entry dynamic). A failure is returned with the
 * failure profile, like an island envelope: retried within seconds, without
 * turning a static page into a partial prerender. Verification runs inside
 * the cache scope (WebCrypto work outside it would make the prerender treat
 * it as uncached I/O). No in-process cache: Next must see this fetch.
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
 * of the static shell (a dynamic hole, rendered per request). The page's
 * descriptor entries stay in the shell, so it is regenerated.
 */
async function notServerReadyYet(base: string): Promise<string> {
  'use cache'
  cacheLife(DEFER_LIFE)
  return base
}

/**
 * Remote components on a static page (`cacheComponents`, after
 * `next start`): a regeneration in a process whose server loader has not
 * loaded the build yet would render the component's fallback (Next ends the
 * HTML prerender before the build has loaded) and keep it as the page for a
 * whole revalidate window. Such a render is kept out of the static shell
 * instead: the boundary renders per request (where the server waits for the
 * build) until a regeneration finds the build loaded or refused. Inside a
 * host's own `'use cache'` scope that scope gets the failure profile instead
 * (still static, regenerated within seconds). Not during `next build` (that
 * would turn a static route dynamic) or `next dev`.
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
  // Inside the host's own 'use cache' scope (a cached component that reads
  // the descriptor): a short-lived life there would make the whole scope a
  // hole, the descriptor entry with it, and a shell left without a
  // revalidating entry gets `revalidate: false` (stuck as a partial
  // prerender). The failure profile keeps the scope in the static shell, with
  // the fallback, and regenerates it within seconds, by when the build has
  // usually loaded.
  const inHostCache = shortenTo(FAILURE_LIFE)
  logger.warnOnce(
    'NF-039',
    `not-loaded:${descriptor.base}`,
    `Build "${descriptor.buildId}" of "${descriptor.remote}" is not loaded in this server process yet: ` +
      (inHostCache
        ? "this render runs inside a 'use cache' scope of the host, which keeps the remote components' fallback in the static page for a few seconds; the page regenerates within seconds."
        : 'this render leaves its remote components to request time (each request waits for the build) instead of keeping their fallback in the static page, and the page regenerates once it is loaded.')
  )
  if (inHostCache) return
  await notServerReadyYet(descriptor.base)
}
