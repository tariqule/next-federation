import { cookies } from 'next/headers';
import { Suspense, type ReactNode } from 'react';
import { getPublicEnvelope } from '@nf/island-cache';
import {
  islandRequest,
  parseEnvelope,
  type IslandEnvelope,
} from '@nf-spike/proto/protocol';
import {
  BASE_PATH,
  REMOTES,
  TIMEOUT_MS,
  mintFor,
  type RemoteName,
} from './federation';
import { NextIslandMount } from './NextIslandMount';

type Props = {
  remote: RemoteName;
  island: string;
  props?: object;
  private?: boolean;
  fallback: ReactNode;
};

// Every island sits in its own Suspense boundary (design §6, maintainer review B2).
export function RemoteIsland(p: Props) {
  return (
    <Suspense fallback={p.fallback}>
      <IslandLoader {...p} />
    </Suspense>
  );
}

async function getPrivateEnvelope(
  remote: RemoteName,
  island: string,
  props: unknown,
): Promise<IslandEnvelope | null> {
  const jar = await cookies();
  const sub = jar.get('nf-user')?.value;
  // Spike-only hook so e2e can force an expired token.
  const testTtl = jar.get('nf-test-ttl')?.value;
  if (!sub) return null;
  const token = await mintFor(
    remote,
    sub,
    testTtl === undefined ? undefined : Number(testTtl),
  ); // minted server-side; never passed to the client
  const { url, init } = islandRequest(REMOTES[remote], island, props, {
    token,
  });
  try {
    const res = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? parseEnvelope(await res.json()) : null;
  } catch {
    return null;
  }
}

async function IslandLoader({
  remote,
  island,
  props = {},
  private: isPrivate,
  fallback,
}: Props) {
  const envelope = isPrivate
    ? await getPrivateEnvelope(remote, island, props)
    : await getPublicEnvelope(remote, island, props);
  if (!envelope) return <>{fallback}</>;
  return (
    <>
      {envelope.css.map((href) => (
        <link
          key={href}
          rel="stylesheet"
          href={href}
          precedence="next-federation"
        />
      ))}
      <NextIslandMount
        envelope={envelope}
        basePath={BASE_PATH}
        tokenEndpoint={`${BASE_PATH}/api/nf/token?aud=${remote}`}
      />
    </>
  );
}
