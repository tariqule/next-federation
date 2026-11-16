import { NFError } from '@next-federation/sdk'
import { SignJWT } from 'jose'
import type { Federation } from '../config.ts'
import { ALG, signingKeys } from './keys.ts'

export type HostIdentity = { sub: string; claims?: Record<string, unknown> }

const RESERVED = ['iss', 'aud', 'sub', 'exp', 'iat', 'nbf', 'jti']

/** Mints a short-lived ES256 token for one remote (aud = remote), signed with the first key. */
export async function mintIslandToken(
  federation: Federation,
  opts: { remote: string; identity: HostIdentity; ttlSeconds?: number }
): Promise<{ token: string; expiresAt: number }> {
  const keys = await signingKeys(federation) // NF-013 / NF-002
  const config = federation.identity!
  federation.target(opts.remote) // NF-001
  const { sub, claims } = opts.identity
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new NFError('NF-002', '`identity.sub` must be a non-empty string.')
  }
  for (const name of Object.keys(claims ?? {})) {
    if (RESERVED.includes(name)) {
      throw new NFError(
        'NF-002',
        `\`identity.claims\` may not set the reserved claim "${name}".`
      )
    }
  }
  const ttl = opts.ttlSeconds ?? config.ttlSeconds
  if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0) {
    throw new NFError('NF-002', '`ttlSeconds` must be a finite number > 0.')
  }
  const signing = keys[0]!
  const iat = Math.floor(Date.now() / 1000)
  const expiresAt = iat + Math.ceil(ttl)
  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALG, kid: signing.kid })
    .setIssuer(config.issuer)
    .setAudience(opts.remote)
    .setSubject(sub)
    .setIssuedAt(iat)
    .setExpirationTime(expiresAt)
    .sign(signing.signer)
  return { token, expiresAt }
}
