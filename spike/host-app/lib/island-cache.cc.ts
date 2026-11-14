import { cacheLife, cacheTag } from 'next/cache';
import {
  islandRequest,
  parseEnvelope,
  type IslandEnvelope,
} from '@nf-spike/proto/protocol';
import { REMOTES, TIMEOUT_MS, type RemoteName } from './federation';

// Public islands with cacheComponents: 'use cache' + cacheLife + cacheTag (design §6 table).
export async function getPublicEnvelope(
  remote: RemoteName,
  island: string,
  props: unknown,
): Promise<IslandEnvelope | null> {
  'use cache';
  cacheLife('minutes');
  cacheTag(`nf:${remote}`, `nf:${remote}:${island}`);
  const { url, init } = islandRequest(REMOTES[remote], island, props);
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? parseEnvelope(await res.json()) : null;
  } catch {
    return null;
  }
}
