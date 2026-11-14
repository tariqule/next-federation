import { RemoteIsland } from '../../lib/RemoteIsland';

export default function Slow() {
  return (
    <main>
      <h1>Remote slow</h1>
      <RemoteIsland
        remote="a"
        island="Slow"
        props={{ ms: 10_000 }}
        fallback={<p>remote too slow</p>}
      />
    </main>
  );
}
