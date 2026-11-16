import { getIdentity } from '@next-federation/island'
import { getOrders } from '../data'

// Private island: rendered per user from verified token claims (design §9a).
export default async function MyOrders() {
  const user = getIdentity()
  // The handler rejects tokenless requests before rendering.
  if (!user) throw new Error('MyOrders requires identity')
  const orders = await getOrders(user.sub)
  return (
    <section data-island="MyOrders">
      <h2>Orders for {user.sub}</h2>
      <ul>
        {orders.map((o) => (
          <li key={o.id}>{o.title}</li>
        ))}
      </ul>
    </section>
  )
}
