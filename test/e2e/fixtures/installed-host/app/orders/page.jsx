import { RemoteIsland } from '../../lib/federation'

// Private island, rendered on the server in dev as in production.
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
