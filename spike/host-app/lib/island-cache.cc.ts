import { cacheLife, cacheTag } from 'next/cache';
import {
  islandRequest,
  parseEnvelope,
  type IslandEnvelope,
} from '@nf-spike/proto/protocol';
import { REMOTES, TIMEOUT_MS, type RemoteName } from './federation';

// Public islands with cacheComponents: 'use cache' + cacheLife + cacheTag (design §6 table).
// It throws on failure so a failed or timed-out fetch is never cached; the wrapper below turns that into null.
async function getCachedEnvelope(
  remote: RemoteName,
  island: string,
  props: unknown,
): Promise<IslandEnvelope> {
  'use cache';
  cacheLife('minutes');
  cacheTag(`nf:${remote}`, `nf:${remote}:${island}`);
  const { url, init } = islandRequest(REMOTES[remote], island, props);
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`island fetch failed: ${res.status}`);
  return parseEnvelope(await res.json());
}

export async function getPublicEnvelope(
  remote: RemoteName,
  island: string,
  props: unknown,
): Promise<IslandEnvelope | null> {
  try {
    return await getCachedEnvelope(remote, island, props);
  } catch {
    return null;
  }
}
