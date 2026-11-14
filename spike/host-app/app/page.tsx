import { RefreshButton } from '../lib/RefreshButton';
import { RemoteIsland } from '../lib/RemoteIsland';

export default function Home() {
  return (
    <main>
      <h1>App Router host</h1>
      <RefreshButton />
      <RemoteIsland
        remote="a"
        island="ProductPanel"
        props={{ sku: 'A1' }}
        fallback={<p>loading product…</p>}
      />
    </main>
  );
}
