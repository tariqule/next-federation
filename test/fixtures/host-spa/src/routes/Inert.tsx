import type { IslandEnvelope } from '@next-federation/protocol'
import { IslandMount } from '@next-federation/react'
import { useEffect, useState } from 'react'
import { federation, loadIsland } from '../lib/islands.ts'

// A valid envelope whose bootstrap URL answers 404: the server HTML stays.
export function Inert() {
  const [envelope, setEnvelope] = useState<IslandEnvelope>()
  useEffect(() => {
    void loadIsland(federation.target('fake'), 'BrokenBootstrap').then(
      (r) => r.ok && setEnvelope(r.envelope)
    )
  }, [])
  return envelope ? <IslandMount envelope={envelope} /> : null
}
