import { RemoteIsland } from '../../lib/federation'

export default function Two() {
  return (
    <main>
      <h1>Two remotes, three islands</h1>
      <RemoteIsland
        remote="a"
        island="ProductPanel"
        props={{ sku: 'A1' }}
        fallback={<p>loading…</p>}
      />
      <RemoteIsland
        remote="a"
        island="ProductPanel"
        props={{ sku: 'B2' }}
        fallback={<p>loading…</p>}
      />
      <RemoteIsland
        remote="b"
        island="Banner"
        props={{ text: 'Hello B' }}
        fallback={<p>loading…</p>}
      />
    </main>
  )
}
