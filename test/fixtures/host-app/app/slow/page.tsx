import { RemoteIsland } from '../../lib/federation'

export default function Slow() {
  return (
    <main>
      <h1>Remote slow</h1>
      <RemoteIsland
        remote="a"
        island="Slow"
        props={{ ms: 10_000 }}
        fallback={<p>loading…</p>}
        errorFallback={<p>remote too slow</p>}
      />
    </main>
  )
}
