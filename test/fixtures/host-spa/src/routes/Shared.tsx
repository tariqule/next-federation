import type { IslandEnvelope } from '@next-federation/protocol'
import { IslandMount } from '@next-federation/react'
import type { IslandClientEvent } from '@next-federation/react'
import { useEffect, useState } from 'react'
import { federation, loadIsland } from '../lib/islands.ts'

// React sharing e2e: `?remotes=a,b` mounts one ProductPanel per remote.
// With `seq=1` each island is fetched only after the previous one hydrated,
// so the load order is the list order. `host=1`: main.tsx put this host's
// React into the island share scope (provideHostReact) before anything loads.
export function Shared() {
  const params = new URLSearchParams(location.search)
  const [remotes] = useState(() =>
    (params.get('remotes') ?? 'a,b').split(',').filter(Boolean)
  )
  const [sequential] = useState(() => params.get('seq') === '1')
  const [swapKey, setSwapKey] = useState(0)
  const [visible, setVisible] = useState(true)
  const [envelopes, setEnvelopes] = useState<
    Record<string, IslandEnvelope | undefined>
  >({})
  // Sequential mode: how many islands have hydrated so far.
  const [hydrated, setHydrated] = useState(0)

  useEffect(() => {
    const wanted = sequential ? remotes.slice(0, hydrated + 1) : remotes
    for (const remote of wanted) {
      if (envelopes[remote]) continue
      void loadIsland(federation.target(remote), 'ProductPanel', {
        sku: remote.toUpperCase(),
      }).then(
        (r) =>
          r.ok &&
          setEnvelopes((all) =>
            all[remote] ? all : { ...all, [remote]: r.envelope }
          )
      )
    }
  }, [remotes, sequential, hydrated, envelopes])

  const onEvent = (event: IslandClientEvent) => {
    if (event.type === 'island:hydrate') setHydrated((n) => n + 1)
  }

  return (
    <main>
      <button onClick={() => setSwapKey((k) => k + 1)}>swap</button>
      <button onClick={() => setVisible((v) => !v)}>toggle</button>
      {visible &&
        remotes.map((remote) => {
          const envelope = envelopes[remote]
          return (
            <section
              key={remote}
              data-remote={remote}
              data-react-version={envelope?.reactVersion}
            >
              {envelope && (
                <IslandMount
                  key={swapKey}
                  envelope={envelope}
                  onEvent={onEvent}
                />
              )}
            </section>
          )
        })}
    </main>
  )
}
