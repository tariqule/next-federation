import { getIdentity } from '@nf-spike/proto/identity';
import { getOrders } from '../data';

// Private island: rendered per user from verified token claims (design §9a).
export default async function MyOrders() {
  const user = getIdentity();
  if (!user) throw new Error('MyOrders requires identity'); // the handler rejects tokenless requests before rendering
  const orders = await getOrders(user.sub);
  return (
    <section data-island="MyOrders">
      <h2>Orders for {user.sub}</h2>
      <ul>
        {orders.map((o) => (
          <li key={o.id}>{o.title}</li>
        ))}
      </ul>
    </section>
  );
}

// One loadCss() per module: plugin-rsc 0.5.39 only wires the first call in a module in builds.
export const islandCss = () => import.meta.viteRsc.loadCss();
