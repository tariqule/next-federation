import { fetchIsland } from '@next-federation/core'
import type { Federation, IslandResult } from '@next-federation/core'
import type { IslandEnvelope } from '@next-federation/protocol'
import { canonicalJson } from '@next-federation/protocol'
import { getPublicEnvelope } from '@next-federation/next/island-cache'
import { cache } from 'react'
import { hostBasePath } from './assert-wrapped.ts'
import { getPrivateEnvelope } from './private-envelope.ts'
import type { AppIdentity } from './private-envelope.ts'
import { reportIsland } from './report-island.ts'
import { takeFresh } from './fresh-mark.ts'

export type { AppIdentity } from './private-envelope.ts'

export type IslandSpec = {
  remote: string
  island: string
  props?: Record<string, unknown>
  /** Per-user island: needs `getIdentity`; the route becomes dynamic. */
  private?: boolean
  /** Public island fetched on every request (`cache: 'no-store'`). */
  dynamic?: boolean
  /** Seconds; defaults to `islands.revalidate` from defineFederation(). */
  revalidate?: number
  /** URL prefix segment passed to the remote; '' for none. */
  locale?: string
}

/**
 * The browser's token source for an island. `identityKey: null` (public islands on a
 * host with `getIdentity`): the island's Server Actions fetch a token for whoever is
 * signed in when they run, so the page stays static.
 */
export type IslandToken = { endpoint: string; identityKey: string | null }

export type LoadedIsland =
  | {
      kind: 'ok'
      envelope: IslandEnvelope
      token: IslandToken | null
    }
  | { kind: 'failed' }
  | { kind: 'anonymous' }

const FAILED: LoadedIsland = { kind: 'failed' }

/**
 * Loads one island for App Router (design §6).
 * - Public: through the island cache selected by `withNextFederation`.
 * - Public `dynamic`: `fetchIsland` with `cache: 'no-store'`.
 * - Private: identity read outside any cache scope, token minted per request.
 *
 * Every load is reported (`reportIsland`) after it returns, outside the
 * cached function. A public result is reported only when its fetch ran for
 * this call (`takeFresh`); with cacheComponents a cache hit is not reported.
 * No wall-clock reads here: Next aborts cacheComponents prerenders on them.
 * There is no `catch`: Next's control-flow errors (from `cookies()`, for
 * example) always propagate, and caller mistakes (NF-001, NF-009, NF-013,
 * NF-017) throw.
 */
export async function loadIsland(
  federation: Federation,
  options: { getIdentity?: AppIdentity },
  spec: IslandSpec
): Promise<LoadedIsland> {
  const host = { basePath: hostBasePath(), locale: spec.locale ?? '' }
  const target = federation.target(spec.remote)
  const { island } = spec
  const props = spec.props ?? {}
  const endpoint = `${host.basePath}${federation.routesPath}/token?aud=${encodeURIComponent(spec.remote)}`

  if (spec.private) {
    const loaded = await getPrivateEnvelope(
      federation,
      options.getIdentity,
      target,
      { island, props, host }
    )
    if (loaded.kind === 'anonymous') return loaded
    reportIsland(federation, target, island, loaded.result)
    if (!loaded.result.ok) return FAILED
    return {
      kind: 'ok',
      envelope: loaded.result.envelope,
      token: { endpoint, identityKey: loaded.identityKey },
    }
  }

  let result: IslandResult
  if (spec.dynamic) {
    result = await fetchIsland(target, {
      island,
      props,
      host,
      init: { cache: 'no-store' },
    })
    reportIsland(federation, target, island, result)
  } else {
    const cached = await getPublicEnvelope(
      target,
      island,
      canonicalJson(props),
      canonicalJson(host),
      spec.revalidate ?? federation.islands.revalidate
    )
    // Reported only when the fetch ran for this call, not for a cache hit
    // (whose meta belongs to the fetch that filled the entry).
    if (takeFresh(cached)) reportIsland(federation, target, island, cached)
    result = cached
  }
  if (!result.ok) return FAILED
  // D2: no identity is read here (the island stays cacheable and the route static).
  const actsAsUser =
    options.getIdentity !== undefined && federation.identity !== null
  return {
    kind: 'ok',
    envelope: result.envelope,
    token: actsAsUser ? { endpoint, identityKey: null } : null,
  }
}

/** Only the spec fields, with `false` flags dropped, so equal specs share a key. */
function specKey(spec: IslandSpec): string {
  return canonicalJson({
    remote: spec.remote,
    island: spec.island,
    props: spec.props ?? {},
    private: spec.private === true ? true : undefined,
    dynamic: spec.dynamic === true ? true : undefined,
    revalidate: spec.revalidate,
    locale: spec.locale,
  })
}

/**
 * `loadIsland` memoised per request with React `cache()`. `cache()` compares
 * arguments by identity, so the only argument is the canonical JSON of the
 * spec: specs that differ only in key order share one load, which lets
 * `preloadIsland` and the later render share one fetch.
 */
export function createIslandLoader(
  federation: Federation,
  options: { getIdentity?: AppIdentity }
): (spec: IslandSpec) => Promise<LoadedIsland> {
  const cachedLoad = cache(
    (specJson: string): Promise<LoadedIsland> =>
      loadIsland(federation, options, JSON.parse(specJson) as IslandSpec)
  )
  return (spec) => cachedLoad(specKey(spec))
}
