import type { IslandEnvelope } from '@next-federation/protocol'
import { IslandMount } from '@next-federation/react'
import { useEffect, useState } from 'react'
import { federation, loadIsland } from '../lib/islands.ts'

// Props that try to break out of the island markup.
export function Inject() {
  const [envelope, setEnvelope] = useState<IslandEnvelope>()
  useEffect(() => {
    void loadIsland(federation.target('b'), 'Banner', {
      text: '</script><script>window.pwned=1</script><!--',
    }).then((r) => r.ok && setEnvelope(r.envelope))
  }, [])
  return envelope ? <IslandMount envelope={envelope} /> : null
}
