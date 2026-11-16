import { RemoteIsland } from '../../lib/federation'

// Only a public island: this page must stay static/ISR (gate i).
export default function StaticPage() {
  return (
    <main>
      <h1>Static page</h1>
      <RemoteIsland
        remote="b"
        island="Banner"
        props={{ text: 'static banner' }}
        fallback={<p>loading banner…</p>}
      />
    </main>
  )
}
