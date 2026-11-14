import Head from 'next/head';
import { useRouter } from 'next/router';
import { useMemo, type ReactNode } from 'react';
import { toPagesRouterHref } from '@nf-spike/proto/bridge';
import { IslandMount } from '@nf-spike/proto/island-mount';
import type { IslandEnvelope } from '@nf-spike/proto/protocol';

const BASE_PATH = process.env.NF_BASE ?? '';

// Pages Router island: CSS via next/head, links via next/router (design §6 navigation bridge).
export function PagesIsland({
  envelope,
  remote,
  fallback,
}: {
  envelope: IslandEnvelope | null;
  remote: string;
  fallback: ReactNode;
}) {
  const router = useRouter();
  const bridge = useMemo(
    () => ({
      basePath: BASE_PATH,
      locale: router.locale,
      navigate: (href: string) => {
        const target = toPagesRouterHref(href, BASE_PATH, router.locales ?? []);
        router.push(target.href, undefined, { locale: target.locale });
      },
      prefetch: (href: string) => {
        const target = toPagesRouterHref(href, BASE_PATH, router.locales ?? []);
        router.prefetch(target.href, undefined, { locale: target.locale });
      },
    }),
    [router],
  );
  if (!envelope) return <>{fallback}</>;
  return (
    <>
      <Head>
        {envelope.css.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
      </Head>
      <IslandMount
        envelope={envelope}
        bridge={bridge}
        tokenEndpoint={`${BASE_PATH}/api/nf/token?aud=${remote}`}
      />
    </>
  );
}
