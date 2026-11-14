import {
  islandRequest,
  parseEnvelope,
  type IslandEnvelope,
} from '@nf-spike/proto/protocol';
import { REMOTES, TIMEOUT_MS, type RemoteName } from './federation';

// Public islands without cacheComponents: fetch with revalidate + tags, so a static/ISR page stays static.
export async function getPublicEnvelope(
  remote: RemoteName,
  island: string,
  props: unknown,
): Promise<IslandEnvelope | null> {
  const { url, init } = islandRequest(REMOTES[remote], island, props);
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: {
        revalidate: 60,
        tags: [`nf:${remote}`, `nf:${remote}:${island}`],
      },
    });
    return res.ok ? parseEnvelope(await res.json()) : null;
  } catch {
    return null;
  }
}
