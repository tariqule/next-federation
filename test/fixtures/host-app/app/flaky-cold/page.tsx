import { RemoteIsland } from '../../lib/federation'

// Like /flaky-static, but static.spec.ts switches the remote down before
// this server process ever fetched this island: a regeneration then has no
// last good envelope to keep, and must stay static with the fallback.
export default function FlakyCold() {
  return (
    <main>
      <h1>Flaky cold</h1>
      <RemoteIsland
        remote="fake"
        island="Flaky"
        props={{ id: 'cold' }}
        revalidate={2}
        fallback={<p>loading flaky…</p>}
        errorFallback={<p>flaky unavailable</p>}
      />
    </main>
  )
}
