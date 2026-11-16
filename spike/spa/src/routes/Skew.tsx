import { IslandMount } from '@nf-spike/proto/island-mount';
import {
  islandRequest,
  parseEnvelope,
  type IslandEnvelope,
} from '@nf-spike/proto/protocol';
import { useCallback, useEffect, useState } from 'react';

const A = 'http://127.0.0.1:4100';

async function fetchEnvelope(build: string | null): Promise<IslandEnvelope> {
  const { url, init } = islandRequest(A, 'ProductPanel', { sku: 'A1' });
  // `build` stands in for an island response a host cached before the remote redeployed.
  const res = await fetch(build ? `${url}&build=${build}` : url, init);
  return parseEnvelope(await res.json());
}

export function Skew() {
  const params = new URLSearchParams(location.search);
  const both = params.get('both') === '1';
  const [envelope, setEnvelope] = useState<IslandEnvelope>();
  const [old, setOld] = useState<IslandEnvelope>();
  useEffect(() => {
    if (both) {
      // One island from build v1 and one from the current build, live at the same time.
      fetchEnvelope('v1').then(setOld);
      fetchEnvelope(null).then(setEnvelope);
    } else fetchEnvelope(params.get('build')).then(setEnvelope);
  }, []);
  const loadCurrent = useCallback(
    () => fetchEnvelope(null).then(setEnvelope),
    [],
  );
  return (
    <main>
      <button onClick={loadCurrent}>load current build</button>
      {old && <IslandMount envelope={old} />}
      {envelope && <IslandMount envelope={envelope} />}
    </main>
  );
}
