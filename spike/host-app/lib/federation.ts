import 'server-only';
import { generateHostKeys, mintIslandToken } from '@nf-spike/proto/identity';

export const REMOTES = {
  a: 'http://127.0.0.1:4100',
  b: 'http://127.0.0.1:4101',
  // Nothing listens here: used by the remote-down test.
  down: 'http://127.0.0.1:4199',
} as const;
export type RemoteName = keyof typeof REMOTES;
export const BASE_PATH = process.env.NF_BASE ?? '';
export const ISSUER = `http://localhost:${process.env.NF_PORT ?? 3100}${BASE_PATH}`;
export const TIMEOUT_MS = 3000;

// One key pair per process, shared by the JWKS route and server components (which Next may
// compile into separate module instances), hence globalThis.
type Keys = Awaited<ReturnType<typeof generateHostKeys>>;
const g = globalThis as { __nfHostKeys?: Promise<Keys> };
export const hostKeys = () => (g.__nfHostKeys ??= generateHostKeys('host-1'));

export async function mintFor(
  remote: RemoteName,
  sub: string,
  ttlSeconds = Number(process.env.NF_TOKEN_TTL ?? 300),
) {
  const { privateJwk } = await hostKeys();
  return mintIslandToken({
    privateJwk,
    kid: 'host-1',
    iss: ISSUER,
    aud: remote,
    sub,
    ttlSeconds,
  });
}
