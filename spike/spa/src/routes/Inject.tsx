import { IslandMount } from '@nf-spike/proto/island-mount';
import {
  islandRequest,
  parseEnvelope,
  type IslandEnvelope,
} from '@nf-spike/proto/protocol';
import { useEffect, useState } from 'react';

export function Inject() {
  const [envelope, setEnvelope] = useState<IslandEnvelope>();
  useEffect(() => {
    const { url, init } = islandRequest('http://127.0.0.1:4101', 'Banner', {
      text: '</script><script>window.pwned=1</script><!--',
    });
    fetch(url, init)
      .then((r) => r.json())
      .then((json) => setEnvelope(parseEnvelope(json)));
  }, []);
  return envelope ? <IslandMount envelope={envelope} /> : null;
}
