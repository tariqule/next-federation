import { RemoteIsland } from '../../lib/federation'

// A blocking private island on Next 15 (legacy caching): rendered in place
// in the first HTML, with no streamed fallback; the route is dynamic (ƒ).
// `?case=down`: its remote is down; `?case=slow`: the remote answers after
// the island timeout.
export default async function OrdersInline({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>
}) {
  const { case: which } = await searchParams
  return (
    <main>
      <h1>My orders, inline</h1>
      <RemoteIsland
        remote={which === 'down' ? 'down' : 'a'}
        island={which === 'slow' ? 'Slow' : 'MyOrders'}
        props={which === 'slow' ? { ms: 10_000 } : {}}
        private
        blocking
        fallback={<p>loading orders…</p>}
        errorFallback={<p>orders unavailable</p>}
      />
    </main>
  )
}
