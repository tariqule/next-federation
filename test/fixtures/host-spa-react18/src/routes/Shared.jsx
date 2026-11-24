import { IslandMount } from '@next-federation/react'
import { useEffect, useState } from 'react'
import { loadIsland } from '../islands.js'

// `?host=1`: main.jsx put this host's React into the island share scope
// before anything loads. The island's envelope names the React it needs.
export function Shared() {
  const [envelope, setEnvelope] = useState()
  useEffect(() => {
    void loadIsland('ProductPanel', { sku: 'A' }).then(
      (r) => r.ok && setEnvelope(r.envelope)
    )
  }, [])
  return (
    <main>
      <section data-remote="a" data-react-version={envelope?.reactVersion}>
        {envelope && <IslandMount envelope={envelope} />}
      </section>
    </main>
  )
}
