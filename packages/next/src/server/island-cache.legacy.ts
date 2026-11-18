import { fetchIsland, islandTags } from '@next-federation/core'
import type {
  ComponentTarget,
  FetchIslandRequest,
  IslandTarget,
} from '@next-federation/core'
import { fetchVerifiedComponentDescriptor } from '@next-federation/core/components'
import type { VerifiedDescriptorResult } from '@next-federation/core/components'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import { markFresh } from './fresh-mark.ts'
import type { MarkedIslandResult } from './fresh-mark.ts'

/**
 * Public island envelope for hosts without `cacheComponents`: a fetch with
 * `next: { revalidate, tags }`, so a static or ISR page stays static. A
 * regeneration whose fetch fails renders the island's last good envelope
 * when `loadIsland` has one (stale-if-error), else the fallback, for
 * `revalidate` seconds.
 *
 * Next's fetch cache stores any 200 response, so a 200 whose body is not a
 * valid envelope (NF-004) is cached for `revalidate` seconds too; non-2xx
 * responses, timeouts and network errors are not.
 */
export async function getPublicEnvelope(
  target: IslandTarget,
  island: string,
  propsJson: string,
  hostJson: string,
  revalidate: number
): Promise<MarkedIslandResult> {
  let date: string | null = null
  const result = await fetchIsland(target, {
    island,
    props: JSON.parse(propsJson) as unknown,
    host: JSON.parse(hostJson) as FetchIslandRequest['host'],
    init: { next: { revalidate, tags: islandTags(target.remote, island) } },
    // Next's fetch, read at call time. Keeps the response's Date header.
    fetch: async (input, init) => {
      const response = await globalThis.fetch(input, init)
      date = response.headers.get('date')
      return response
    },
  })
  // This function runs on every render (only the fetch is cached), so every
  // result is marked fresh: a data-cache hit is reported with its own
  // measured duration. `at` bounds how long `loadIsland` may render this
  // envelope in place of a later failure (stale-if-error).
  const now = Date.now()
  return markFresh(result, result.ok ? fetchedAt(date, now) : now)
}

/**
 * When a good envelope was fetched: its response's Date header, which Next's
 * fetch cache replays with the stored response, so a cache hit keeps its
 * real age (and the stale-if-error window is not stretched by up to
 * `revalidate`). Now when the header is missing, invalid or in the future.
 */
function fetchedAt(date: string | null, now: number): number {
  const at = date === null ? Number.NaN : Date.parse(date)
  return Number.isFinite(at) && at <= now ? at : now
}

/** Legacy model: no `'use cache'` scopes exist, so there is nothing to shorten. */
export function shortenEnclosingCache(): void {}

/**
 * Mode A: a components remote's verified build descriptor, for hosts without
 * `cacheComponents`: a fetch with `next: { revalidate, tags }`.
 */
export function getDescriptorFile(
  target: ComponentTarget
): Promise<VerifiedDescriptorResult> {
  return fetchVerifiedComponentDescriptor(target, {
    init: {
      next: { revalidate: target.revalidate, tags: islandTags(target.remote) },
    },
  })
}

/**
 * Legacy model: a static render waits for every Suspense boundary, so a
 * remote component whose server build is still loading is never left as its
 * fallback. Nothing to do.
 */
export async function skipStaticShellUntilReady(
  descriptor: RemoteComponentDescriptor | null
): Promise<void> {
  void descriptor
}
