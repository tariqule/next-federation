import { RemoteIsland } from '../../lib/federation'

// A public island whose content changes on the remote (fake remote `/_rev`):
// cached until `POST /api/revalidate?remote=fake` (revalidateIsland).
export default function Reval() {
  return (
    <main>
      <h1>Revalidate</h1>
      <RemoteIsland
        remote="fake"
        island="Echo"
        props={{ id: 'reval' }}
        fallback={<p>loading echo…</p>}
        errorFallback={<p>echo unavailable</p>}
      />
    </main>
  )
}
