import { IslandMount } from '@next-federation/react'
import { useEffect, useState } from 'react'
import { loadIsland } from '../islands.js'

// A public island: the envelope is fetched in the browser (CORS) and mounted
// client-side.
export function Islands() {
  const [envelope, setEnvelope] = useState()
  useEffect(() => {
    void loadIsland('ProductPanel', { sku: 'A1' }).then(
      (r) => r.ok && setEnvelope(r.envelope)
    )
  }, [])
  return <main>{envelope && <IslandMount envelope={envelope} />}</main>
}
