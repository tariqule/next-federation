// Island identity tokens (design §9a): host-minted, per-remote (aud), short-lived ES256 JWTs.
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  SignJWT,
  createRemoteJWKSet,
  errors,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  type JWK,
} from 'jose';

export type IslandIdentity = { sub: string; [claim: string]: unknown };

export class IdentityError extends Error {
  override name = 'IdentityError';
}

/** The token could not be checked (JWKS unreachable or timed out): not the caller's fault. */
export class IdentityUnavailableError extends IdentityError {
  override name = 'IdentityUnavailableError';
}

const ALG = 'ES256';

export async function generateHostKeys(
  kid: string,
): Promise<{ privateJwk: JWK; publicJwks: { keys: JWK[] } }> {
  const { privateKey, publicKey } = await generateKeyPair(ALG, {
    extractable: true,
  });
  const privateJwk = { ...(await exportJWK(privateKey)), kid, alg: ALG };
  const publicJwk = {
    ...(await exportJWK(publicKey)),
    kid,
    alg: ALG,
    use: 'sig',
  };
  return { privateJwk, publicJwks: { keys: [publicJwk] } };
}

export async function mintIslandToken(opts: {
  privateJwk: JWK;
  kid: string;
  iss: string;
  aud: string;
  sub: string;
  claims?: Record<string, unknown>;
  ttlSeconds?: number;
}): Promise<string> {
  const key = await importJWK(opts.privateJwk, ALG);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...opts.claims })
    .setProtectedHeader({ alg: ALG, kid: opts.kid })
    .setIssuer(opts.iss)
    .setAudience(opts.aud)
    .setSubject(opts.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.ttlSeconds ?? 300))
    .sign(key);
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifyIslandToken(
  token: string,
  opts: { jwksUrl: string; aud: string; issuers: string[] },
): Promise<IslandIdentity> {
  let jwks = jwksCache.get(opts.jwksUrl);
  if (!jwks)
    jwksCache.set(
      opts.jwksUrl,
      (jwks = createRemoteJWKSet(new URL(opts.jwksUrl))),
    );
  try {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: [ALG],
      audience: opts.aud,
      issuer: opts.issuers,
    });
    if (typeof payload.sub !== 'string')
      throw new IdentityError('token has no sub');
    return payload as IslandIdentity;
  } catch (e) {
    if (e instanceof IdentityError) throw e;
    // Network failures (fetch TypeError) and JWKS timeouts mean "can't check", not "invalid".
    if (!(e instanceof errors.JOSEError) || e instanceof errors.JWKSTimeout) {
      throw new IdentityUnavailableError((e as Error).message);
    }
    throw new IdentityError((e as Error).message);
  }
}

// Request-scoped identity for remote server components (design §9a getIdentity()).
const store = new AsyncLocalStorage<IslandIdentity>();
export const runWithIdentity = <T>(
  identity: IslandIdentity,
  fn: () => Promise<T>,
): Promise<T> => store.run(identity, fn);
export const getIdentity = (): IslandIdentity | undefined => store.getStore();
