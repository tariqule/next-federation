import { NFError } from '@next-federation/sdk'
import { exportJWK, generateKeyPair, importJWK } from 'jose'
import type { JWK } from 'jose'
import type { Federation } from '../config.ts'

export const ALG = 'ES256'

export type ParsedKey = {
  kid: string
  /** Signing key, imported once. */
  signer: CryptoKey
  /** Public half only: kty, crv, x, y, kid, alg, use. */
  publicJwk: JWK
  /** Raw base64url private scalar; only used to derive the identity-key secret. */
  d: string
}

const cache = new WeakMap<Federation, Promise<ParsedKey[]>>()

/** Messages name the key's position, never its content. */
function badKey(index: number, why: string): NFError {
  return new NFError(
    'NF-002',
    `\`identity.signingKeys[${index}]\` ${why} (expected a private ES256 JWK as a JSON string, with a "kid").`
  )
}

async function parseKey(raw: string, index: number): Promise<ParsedKey> {
  let jwk: unknown
  try {
    jwk = JSON.parse(raw)
  } catch {
    throw badKey(index, 'is not valid JSON')
  }
  if (typeof jwk !== 'object' || jwk === null || Array.isArray(jwk)) {
    throw badKey(index, 'is not a JSON object')
  }
  const k = jwk as Record<string, unknown>
  if (k.kty !== 'EC' || k.crv !== 'P-256') {
    throw badKey(index, 'is not an EC P-256 key')
  }
  if (typeof k.d !== 'string' || k.d.length === 0) {
    throw badKey(index, 'has no private member')
  }
  if (typeof k.kid !== 'string' || k.kid.length === 0) {
    throw badKey(index, 'has no "kid"')
  }
  if (k.alg !== undefined && k.alg !== ALG) {
    throw badKey(index, 'has an "alg" other than ES256')
  }
  if (typeof k.x !== 'string' || typeof k.y !== 'string') {
    throw badKey(index, 'is missing its public coordinates')
  }
  let signer: CryptoKey
  try {
    signer = (await importJWK(jwk as JWK, ALG)) as CryptoKey
  } catch {
    throw badKey(index, 'could not be imported')
  }
  return {
    kid: k.kid,
    signer,
    d: k.d,
    publicJwk: {
      kty: 'EC',
      crv: 'P-256',
      x: k.x,
      y: k.y,
      kid: k.kid,
      alg: ALG,
      use: 'sig',
    },
  }
}

/** Parses and validates every signing key once per Federation. NF-013 when identity is off. */
export function signingKeys(federation: Federation): Promise<ParsedKey[]> {
  const identity = federation.identity
  if (!identity) {
    return Promise.reject(
      new NFError(
        'NF-013',
        '`identity` is not configured in defineFederation(); add `identity: { issuer, signingKeys }`.'
      )
    )
  }
  let parsed = cache.get(federation)
  if (!parsed) {
    parsed = (async () => {
      const keys: ParsedKey[] = []
      for (const [i, raw] of identity.signingKeys.entries()) {
        const key = await parseKey(raw, i)
        if (keys.some((other) => other.kid === key.kid)) {
          throw new NFError(
            'NF-002',
            `\`identity.signingKeys\` contains a duplicate "kid" ("${key.kid}").`
          )
        }
        keys.push(key)
      }
      return keys
    })()
    cache.set(federation, parsed)
    // A bad config must not be remembered as a poisoned promise forever.
    parsed.catch(() => cache.delete(federation))
  }
  return parsed
}

/** A private ES256 JWK as a JSON string, ready for `identity.signingKeys`. */
export async function generateSigningKey(kid?: string): Promise<string> {
  const id =
    kid ??
    Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('')
  const { privateKey } = await generateKeyPair(ALG, { extractable: true })
  const jwk = await exportJWK(privateKey)
  return JSON.stringify({ ...jwk, kid: id, alg: ALG })
}

/** Public parts of every signing key (rotation: all of them are published). */
export async function publicJwks(
  federation: Federation
): Promise<{ keys: JWK[] }> {
  const keys = await signingKeys(federation)
  return { keys: keys.map((k) => ({ ...k.publicJwk })) }
}

/**
 * Eagerly parses and validates every signing key and warms the cache, so a bad
 * key fails at startup instead of on the first per-user request. Same errors
 * as lazy use: NF-002 for a bad key, NF-013 when identity is not configured.
 */
export async function validateIdentity(federation: Federation): Promise<void> {
  await signingKeys(federation)
}
