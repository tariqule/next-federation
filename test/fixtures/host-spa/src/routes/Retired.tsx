import type { IslandResult } from '@next-federation/core'
import { IslandMount } from '@next-federation/react'
import { useEffect, useState } from 'react'
import { ORIGINS, loadIsland, pinnedTarget } from '../lib/islands.ts'

// Remote `a` served with `--max-builds 1` there: build v1 is retired there.
const RETIRED_V1 = `${ORIGINS.retired}/b/v1`

export function Retired() {
  const [result, setResult] = useState<IslandResult>()
  useEffect(() => {
    void loadIsland(pinnedTarget('a', RETIRED_V1), 'ProductPanel', {
      sku: 'A1',
    }).then(setResult)
  }, [])
  if (!result) return <p>loading</p>
  if (!result.ok) {
    return (
      <p data-testid="island-fallback" data-code={result.code}>
        Product panel unavailable (status {result.status ?? 'none'})
      </p>
    )
  }
  return <IslandMount envelope={result.envelope} />
}
