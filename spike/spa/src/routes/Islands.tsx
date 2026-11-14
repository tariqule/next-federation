import { IslandMount } from '@nf-spike/proto/island-mount';
import {
  islandRequest,
  parseEnvelope,
  type IslandEnvelope,
} from '@nf-spike/proto/protocol';
import { useEffect, useState } from 'react';

const A = 'http://127.0.0.1:4100';
const B = 'http://127.0.0.1:4101';

async function fetchIsland(
  origin: string,
  island: string,
  props: unknown,
): Promise<IslandEnvelope> {
  const { url, init } = islandRequest(origin, island, props);
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`island ${island}: ${res.status}`);
  return parseEnvelope(await res.json());
}

// CSR host: envelopes are fetched in the browser (CORS) and mounted client-side.
export function Islands() {
  const [a, setA] = useState<IslandEnvelope>();
  const [b, setB] = useState<IslandEnvelope>();
  const [bannerText, setBannerText] = useState('Hello B');
  const [swapKey, setSwapKey] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    fetchIsland(A, 'ProductPanel', { sku: 'A1' }).then(setA);
  }, []);
  useEffect(() => {
    fetchIsland(B, 'Banner', { text: bannerText }).then(setB);
  }, [bannerText]);

  return (
    <main>
      <button onClick={() => setBannerText('Hello B2')}>bump</button>
      <button onClick={() => setSwapKey((k) => k + 1)}>swap</button>
      <button onClick={() => setVisible((v) => !v)}>toggle</button>
      {visible && (
        <div key={swapKey}>
          {a && (
            <IslandMount
              envelope={a}
              tokenEndpoint="http://localhost:3999/mint?aud=a&sub=user-1"
            />
          )}
          {b && <IslandMount envelope={b} />}
        </div>
      )}
    </main>
  );
}
