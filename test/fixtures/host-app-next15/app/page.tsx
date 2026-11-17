import { RemoteIsland } from '../lib/federation'

export default function Home() {
  return (
    <main>
      <h1>App Router host (Next 15)</h1>
      <RemoteIsland
        remote="a"
        island="ProductPanel"
        props={{ sku: 'A1' }}
        fallback={<p>loading product…</p>}
      />
    </main>
  )
}
