import { RemoteIsland } from '../../lib/RemoteIsland';

export default function Orders() {
  return (
    <main>
      <h1>My orders</h1>
      <RemoteIsland
        remote="a"
        island="MyOrders"
        private
        fallback={<p>orders unavailable</p>}
      />
    </main>
  );
}
