import { RemoteIsland } from './federation'

export type OrdersInlineSearch = Promise<{ case?: string }>

/**
 * A blocking private island (`/orders-inline`): rendered in place in the
 * first HTML, with no streamed fallback. `?case=down`: its remote is down;
 * `?case=slow`: the remote answers after the island timeout.
 */
export async function OrdersInline({
  searchParams,
}: {
  searchParams: OrdersInlineSearch
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
