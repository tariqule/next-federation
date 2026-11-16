import './shop.css'
import { getIdentity } from '@next-federation/island'
import { getOrders } from '../data'

// A private island (`private: true` in vite.config.ts): rendered per user
// from a token the host signed. The remote never renders it without one.
export default async function MyOrders() {
  const user = getIdentity()
  if (!user) throw new Error('MyOrders requires a signed-in user')
  const orders = await getOrders(user.sub)
  return (
    <section className="shop-panel">
      <h2>Orders for {user.sub}</h2>
      <ul>
        {orders.map((o) => (
          <li key={o.id}>
            #{o.id} {o.title}
          </li>
        ))}
      </ul>
    </section>
  )
}
