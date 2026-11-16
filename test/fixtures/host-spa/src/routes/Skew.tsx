import type { IslandEnvelope } from '@next-federation/protocol'
import { IslandMount } from '@next-federation/react'
import { useCallback, useEffect, useState } from 'react'
import {
  ORIGINS,
  federation,
  loadIsland,
  pinnedTarget,
} from '../lib/islands.ts'

const A = ORIGINS.a

// `build` stands in for an envelope a host cached before the remote
// redeployed: it is fetched from that build's pinned path, `/b/<build>`.
async function fetchEnvelope(build: string | null): Promise<IslandEnvelope> {
  const target = build
    ? pinnedTarget('a', `${A}/b/${build}`)
    : federation.target('a')
  const result = await loadIsland(target, 'ProductPanel', { sku: 'A1' })
  if (!result.ok) throw new Error(`ProductPanel: ${result.code}`)
  return result.envelope
}

export function Skew() {
  const [envelope, setEnvelope] = useState<IslandEnvelope>()
  const [old, setOld] = useState<IslandEnvelope>()
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('both') === '1') {
      // One island from build v1 and one from the current build, live at once.
      void fetchEnvelope('v1').then(setOld)
      void fetchEnvelope(null).then(setEnvelope)
    } else void fetchEnvelope(params.get('build')).then(setEnvelope)
  }, [])
  const loadCurrent = useCallback(
    () => void fetchEnvelope(null).then(setEnvelope),
    []
  )
  return (
    <main>
      <button onClick={loadCurrent}>load current build</button>
      {old && <IslandMount envelope={old} />}
      {envelope && <IslandMount envelope={envelope} />}
    </main>
  )
}
