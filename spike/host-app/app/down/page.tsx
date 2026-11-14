import { RemoteIsland } from '../../lib/RemoteIsland';

export default function Down() {
  return (
    <main>
      <h1>Remote down</h1>
      <RemoteIsland
        remote="down"
        island="Banner"
        props={{ text: 'never' }}
        fallback={<p>remote unavailable</p>}
      />
    </main>
  );
}
