import type { IslandEnvelope } from '@next-federation/protocol'
import { IslandMount } from '@next-federation/react'
import { useEffect, useState } from 'react'
import { loadIsland } from './federation'

// An island in a client-only app: the browser fetches the envelope, then
// mounts it. There is no server render, so the panel appears once it arrives.
export function ProductPanel({ sku }: { sku: string }) {
  const [envelope, setEnvelope] = useState<IslandEnvelope>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    void loadIsland('ProductPanel', { sku }).then((result) =>
      result.ok ? setEnvelope(result.envelope) : setFailed(true)
    )
  }, [sku])
  if (failed) return <p>product unavailable (is the remote running?)</p>
  if (!envelope) return <p>loading…</p>
  // IslandMount also loads the island's stylesheets.
  return <IslandMount envelope={envelope} />
}
