import { RemoteIsland } from '../../lib/federation'

// Review Focus 1: the same island with the same props, twice. Each mount gets
// its own id prefix, so the islands' `useId` ids never collide.
export default function Twins() {
  return (
    <main>
      <h1>Twins</h1>
      <RemoteIsland
        remote="a"
        island="ProductPanel"
        props={{ sku: 'A1' }}
        fallback={<p>loading…</p>}
      />
      <RemoteIsland
        remote="a"
        island="ProductPanel"
        props={{ sku: 'A1' }}
        fallback={<p>loading…</p>}
      />
    </main>
  )
}
