import { defineFederation, fetchIsland } from '@next-federation/core'
import type { IslandResult, IslandTarget } from '@next-federation/core'
import { ISLAND_EVENT, getLiveIslandCount } from '@next-federation/react'
import { useEffect, useState } from 'react'

// The harness sets VITE_NF_ORIGIN_* (per lane, see test/e2e/servers.ts).
const env = import.meta.env
export const ORIGINS = {
  a: env.VITE_NF_ORIGIN_A ?? 'http://127.0.0.1:4100',
  b: env.VITE_NF_ORIGIN_B ?? 'http://127.0.0.1:4101',
  fake: env.VITE_NF_ORIGIN_FAKE ?? 'http://127.0.0.1:4102',
  // The island remote built against the previous React patch.
  c: env.VITE_NF_ORIGIN_C ?? 'http://127.0.0.1:4104',
  // Remote `a` served with `--max-builds 1`: build v1 is retired there.
  retired: env.VITE_NF_ORIGIN_RETIRED ?? 'http://127.0.0.1:4103',
}

export const federation = defineFederation({
  remotes: {
    a: { origin: ORIGINS.a },
    b: { origin: ORIGINS.b },
    fake: { origin: ORIGINS.fake },
    c: { origin: ORIGINS.c },
  },
})

/** Fetches an island envelope from the browser (CORS); never cached. */
export function loadIsland(
  target: IslandTarget,
  island: string,
  props?: unknown
): Promise<IslandResult> {
  return fetchIsland(target, {
    island,
    props,
    init: { cache: 'no-store' },
  })
}

/** `target` with requests sent to one build-pinned path, e.g. `/b/v1`. */
export function pinnedTarget(remote: string, origin: string): IslandTarget {
  return { ...federation.target(remote), origin }
}

/** Live island roots on the page, refreshed on every island event and every 100 ms. */
export function useLiveIslandCount(): number {
  const [count, setCount] = useState(() => getLiveIslandCount())
  useEffect(() => {
    const refresh = () => setCount(getLiveIslandCount())
    document.addEventListener(ISLAND_EVENT, refresh)
    const timer = setInterval(refresh, 100)
    refresh()
    return () => {
      document.removeEventListener(ISLAND_EVENT, refresh)
      clearInterval(timer)
    }
  }, [])
  return count
}
