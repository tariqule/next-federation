import { RemoteIsland } from './federation'
import { RemoteCartButton } from './RemoteCartButton'

// One product page: two islands from the `shop` remote and a client
// component from the `cart` remote.
export function ProductPage({ sku }: { sku: string }) {
  return (
    <main>
      <h1>Product {sku}</h1>
      {/* Server-rendered by the remote; fetched and cached by this host. */}
      <RemoteIsland
        remote="shop"
        island="ProductPanel"
        props={{ sku }}
        fallback={<p>loading product…</p>}
        errorFallback={<p>product unavailable (is the remote running?)</p>}
      />
      <RemoteCartButton sku={sku} />
      <h2>More products</h2>
      {/* Island links navigate this host without a full page reload. */}
      <RemoteIsland
        key={sku}
        remote="shop"
        island="Links"
        props={{ current: sku }}
        fallback={<p>loading links…</p>}
      />
    </main>
  )
}
