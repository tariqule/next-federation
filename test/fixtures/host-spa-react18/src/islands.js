import { defineFederation, fetchIsland } from '@next-federation/core'
import { ISLAND_EVENT, getLiveIslandCount } from '@next-federation/react'
import { useEffect, useState } from 'react'

// The harness sets VITE_NF_ORIGIN_A (per lane, see test/e2e/servers.ts).
export const federation = defineFederation({
  remotes: {
    a: { origin: import.meta.env.VITE_NF_ORIGIN_A ?? 'http://127.0.0.1:4100' },
  },
})

/** Fetches an island envelope from the browser (CORS); never cached. */
export function loadIsland(island, props) {
  return fetchIsland(federation.target('a'), {
    island,
    props,
    init: { cache: 'no-store' },
  })
}

/** Live island roots on the page, refreshed on every island event and every 100 ms. */
export function useLiveIslandCount() {
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
