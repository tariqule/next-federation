import { RemoteIsland } from '../../lib/federation'

// Private island: per user, so this route is dynamic (a dynamic hole with
// cacheComponents).
export default function Orders() {
  return (
    <main>
      <h1>My orders</h1>
      <RemoteIsland
        remote="a"
        island="MyOrders"
        private
        fallback={<p>loading orders…</p>}
        errorFallback={<p>orders unavailable</p>}
      />
    </main>
  )
}
