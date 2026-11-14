// Server-side only: imported from getServerSideProps / getStaticProps / API routes,
// which Next strips from the client bundle.
import { generateHostKeys, mintIslandToken } from '@nf-spike/proto/identity';
import {
  islandRequest,
  parseEnvelope,
  type IslandEnvelope,
} from '@nf-spike/proto/protocol';

export const REMOTES = {
  a: 'http://127.0.0.1:4100',
  b: 'http://127.0.0.1:4101',
} as const;
export type RemoteName = keyof typeof REMOTES;
export const BASE_PATH = process.env.NF_BASE ?? '';
// The issuer is the host origin; remotes fetch `${iss}/api/nf/jwks`, so with a basePath the
// JWKS route lives under it.
export const ISSUER = `http://localhost:${process.env.NF_PORT ?? 3101}${BASE_PATH}`;
const TIMEOUT_MS = 3000;

type Keys = Awaited<ReturnType<typeof generateHostKeys>>;
const g = globalThis as { __nfHostKeys?: Promise<Keys> };
export const hostKeys = () => (g.__nfHostKeys ??= generateHostKeys('host-1'));

export async function mintFor(remote: RemoteName, sub: string) {
  const { privateJwk } = await hostKeys();
  return mintIslandToken({
    privateJwk,
    kid: 'host-1',
    iss: ISSUER,
    aud: remote,
    sub,
    ttlSeconds: Number(process.env.NF_TOKEN_TTL ?? 300),
  });
}

// For getServerSideProps (dynamic or private islands) and getStaticProps (public islands with
// revalidate). Returns null on any failure so the page shows its fallback (design §9).
export async function getIslandProps(opts: {
  remote: RemoteName;
  island: string;
  props?: object;
  sub?: string;
}): Promise<IslandEnvelope | null> {
  const token = opts.sub ? await mintFor(opts.remote, opts.sub) : undefined;
  const { url, init } = islandRequest(
    REMOTES[opts.remote],
    opts.island,
    opts.props ?? {},
    { token },
  );
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
