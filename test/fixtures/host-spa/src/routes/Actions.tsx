import type { IslandEnvelope } from '@next-federation/protocol'
import { IslandMount } from '@next-federation/react'
import type { IslandClientEvent } from '@next-federation/react'
import { useEffect, useState } from 'react'
import {
  ORIGINS,
  federation,
  loadIsland,
  pinnedTarget,
} from '../lib/islands.ts'

const ISSUER = import.meta.env.VITE_NF_ISSUER ?? 'http://localhost:3999'

// Every island event, for the e2e (island:action reports included). Set only
// on this route, and outside `__nf*` (the page-globals checks).
const events: IslandClientEvent[] = []

type Mount = { key: string; remote: 'a' | 'b'; envelope: IslandEnvelope }

/**
 * `/actions?sub=<user>`: Cart islands whose actions carry a token for `sub`,
 * minted by the test issuer (no `sub`: no token).
 * `&aud=<x>`: tokens for another audience (refused by the remote: NF-014).
 * `&skew=1`: remote `a` only, one mount from build v1 and one from v2.
 */
export function Actions() {
  const params = new URLSearchParams(location.search)
  const sub = params.get('sub')
  const aud = params.get('aud')
  const skew = params.get('skew') === '1'
  const [mounts, setMounts] = useState<Mount[]>([])
  useEffect(() => {
    ;(window as { testIslandEvents?: IslandClientEvent[] }).testIslandEvents =
      events
  }, [])
  useEffect(() => {
    const load = async (
      key: string,
      remote: 'a' | 'b',
      origin?: string
    ): Promise<Mount> => {
      const target = origin
        ? pinnedTarget(remote, origin)
        : federation.target(remote)
      const skus: Record<string, string> = { a1: 'A1', a2: 'A2', b: 'B1' }
      const sku = skus[key] ?? 'A1'
      const result = await loadIsland(target, 'Cart', { sku })
      if (!result.ok) throw new Error(`Cart: ${result.code}`)
      return { key, remote, envelope: result.envelope }
    }
    void Promise.all(
      skew
        ? [
            load('v1', 'a', `${ORIGINS.a}/b/v1`),
            load('v2', 'a', `${ORIGINS.a}/b/v2`),
          ]
        : [load('a1', 'a'), load('a2', 'a'), load('b', 'b')]
    ).then(setMounts)
  }, [skew])
  return (
    <main>
      {mounts.map((m) => (
        <div key={m.key} data-testid={`mount-${m.key}`}>
          <IslandMount
            envelope={m.envelope}
            token={
              sub
                ? {
                    endpoint: `${ISSUER}/token?aud=${encodeURIComponent(aud ?? m.remote)}&sub=${encodeURIComponent(sub)}`,
                    identityKey: null,
                  }
                : null
            }
            onEvent={(e) => events.push(e)}
          />
        </div>
      ))}
    </main>
  )
}
