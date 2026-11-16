import { RemoteIsland } from '../../lib/federation'

// Static at build (the fake remote is up then), revalidated every 2 s: the
// remote going down at a revalidation must not freeze the failure.
export default function FlakyStatic() {
  return (
    <main>
      <h1>Flaky static</h1>
      <RemoteIsland
        remote="fake"
        island="Flaky"
        props={{ id: 'isr' }}
        revalidate={2}
        fallback={<p>loading flaky…</p>}
        errorFallback={<p>flaky unavailable</p>}
      />
    </main>
  )
}
