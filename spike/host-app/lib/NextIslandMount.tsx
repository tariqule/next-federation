'use client';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { stripBasePath } from '@nf-spike/proto/bridge';
import { IslandMount } from '@nf-spike/proto/island-mount';
import type { IslandEnvelope } from '@nf-spike/proto/protocol';

// App Router bridge: island links navigate through next/navigation (design §6 navigation bridge).
export function NextIslandMount({
  envelope,
  basePath,
  tokenEndpoint,
}: {
  envelope: IslandEnvelope;
  basePath: string;
  tokenEndpoint: string;
}) {
  const router = useRouter();
  const bridge = useMemo(
    () => ({
      basePath,
      navigate: (href: string) => router.push(stripBasePath(href, basePath)),
      prefetch: (href: string) =>
        router.prefetch(stripBasePath(href, basePath)),
    }),
    [router, basePath],
  );
  return (
    <IslandMount
      envelope={envelope}
      bridge={bridge}
      tokenEndpoint={tokenEndpoint}
    />
  );
}
