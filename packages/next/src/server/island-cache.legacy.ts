import { fetchIsland, islandTags } from '@next-federation/core'
import type {
  ComponentTarget,
  FetchIslandRequest,
  IslandTarget,
} from '@next-federation/core'
import { fetchVerifiedComponentDescriptor } from '@next-federation/core/components'
import type { VerifiedDescriptorResult } from '@next-federation/core/components'
import { markFresh } from './fresh-mark.ts'
import type { MarkedIslandResult } from './fresh-mark.ts'

/**
 * Public island envelope for hosts without `cacheComponents`: a fetch with
 * `next: { revalidate, tags }`, so a static or ISR page stays static.
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
  const result = await fetchIsland(target, {
    island,
    props: JSON.parse(propsJson) as unknown,
    host: JSON.parse(hostJson) as FetchIslandRequest['host'],
    init: { next: { revalidate, tags: islandTags(target.remote, island) } },
  })
  // This function runs on every render (only the fetch is cached), so every
  // result is marked fresh: a data-cache hit is reported with its own
  // measured duration.
  return markFresh(result)
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
