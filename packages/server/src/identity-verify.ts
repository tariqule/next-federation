import {
  assertSecureUrl,
  parseAllowInsecureHttp,
} from '@next-federation/protocol'
import { NFError } from '@next-federation/sdk'
import type { NFErrorCode } from '@next-federation/sdk'
import { createRemoteJWKSet, decodeJwt, errors, jwtVerify } from 'jose'

export type IslandIdentity = { sub: string; [claim: string]: unknown }

/** Issuer (exact `iss` value) to JWKS URL. From configuration only. */
export type IssuerMap = Record<string, string>

export type IdentityOutcome =
  | { kind: 'anonymous' }
  | { kind: 'verified'; identity: IslandIdentity }
  | { kind: 'invalid'; code: Extract<NFErrorCode, 'NF-014' | 'NF-016'> }
  | { kind: 'unavailable' } // NF-015

const ALG = 'ES256'
const SKEW_SECONDS = 30
/** Core mints 300 s tokens by default; 900 s leaves room for a longer configured ttl. */
const DEFAULT_MAX_AGE_SECONDS = 900

function checkUrl(
  value: unknown,
  what: string,
  key: string,
  allowInsecureHttp: boolean
): URL {
  let url: URL | null = null
  try {
    const u = new URL(String(value))
    if (u.protocol === 'http:' || u.protocol === 'https:') url = u
  } catch {
    // falls through to the error below
  }
  if (!url) {
    throw new NFError('NF-002', `${what} must be an absolute http(s) URL.`)
  }
  assertSecureUrl(url, key, { allowInsecureHttp })
  return url
}
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)$/i

const invalid = (code: 'NF-014' | 'NF-016'): IdentityOutcome => ({
  kind: 'invalid',
  code,
})

/** Failures that mean "could not check the token", not "the token is bad". */
function isOutage(e: unknown): boolean {
  if (!(e instanceof errors.JOSEError)) return true // fetch/network failure
  return (
    e instanceof errors.JWKSTimeout ||
    e.code === 'ERR_JWKS_INVALID' ||
    e.code === 'ERR_JOSE_GENERIC' // JWKS endpoint answered with a non-200
  )
}

/**
 * Verifies island identity tokens against an explicit issuer map. The token's
 * unverified `iss` is only a lookup key into `issuers`; no URL is derived from
 * token content. Outcomes never carry the token.
 */
export function createIdentityVerifier(opts: {
  audience: string
  issuers: IssuerMap
  /** Reject tokens whose `iat` is older than this. Default 900. */
  maxAgeSeconds?: number
  /**
   * Accept plain-http issuers and JWKS URLs for non-loopback hosts outside
   * development (warned once per process). Default false.
   */
  allowInsecureHttp?: boolean
}): (req: Request) => Promise<IdentityOutcome> {
  const maxAge = opts.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS
  if (typeof opts.audience !== 'string' || opts.audience.length === 0) {
    throw new NFError('NF-002', '`audience` must be a non-empty string.')
  }
  if (!Number.isFinite(maxAge) || maxAge <= 0) {
    throw new NFError('NF-002', '`maxAgeSeconds` must be a number > 0.')
  }
  const issuers = new Map(Object.entries(opts.issuers))
  if (issuers.size === 0) {
    throw new NFError('NF-002', '`issuers` must name at least one issuer.')
  }
  const allowInsecureHttp = parseAllowInsecureHttp(opts.allowInsecureHttp)
  for (const [issuer, url] of issuers) {
    const origin = checkUrl(
      issuer,
      `Issuer "${issuer}"`,
      'issuers',
      allowInsecureHttp
    ).origin
    checkUrl(
      url,
      `The JWKS URL for issuer "${issuer}"`,
      `issuers[${origin}]`,
      allowInsecureHttp
    )
  }
  const sets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

  const jwksFor = (url: string) => {
    let set = sets.get(url)
    if (!set) {
      set = createRemoteJWKSet(new URL(url), { timeoutDuration: 2000 })
      sets.set(url, set)
    }
    return set
  }

  return async (req) => {
    const header = req.headers.get('authorization')
    if (header === null) return { kind: 'anonymous' }
    const match = BEARER.exec(header.trim())
    if (!match) return invalid('NF-014')
    const token = match[1]!

    let iss: unknown
    try {
      iss = decodeJwt(token).iss
    } catch {
      return invalid('NF-014')
    }
    const jwksUrl = typeof iss === 'string' ? issuers.get(iss) : undefined
    if (jwksUrl === undefined) return invalid('NF-016')

    try {
      const { payload } = await jwtVerify(token, jwksFor(jwksUrl), {
        algorithms: [ALG],
        audience: opts.audience,
        issuer: iss as string,
        requiredClaims: ['exp', 'iat', 'sub'],
        clockTolerance: SKEW_SECONDS,
        maxTokenAge: maxAge,
      })
      const now = Math.floor(Date.now() / 1000)
      if ((payload.iat as number) > now + SKEW_SECONDS) return invalid('NF-014')
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        return invalid('NF-014')
      }
      return { kind: 'verified', identity: payload as IslandIdentity }
    } catch (e) {
      return isOutage(e) ? { kind: 'unavailable' } : invalid('NF-014')
    }
  }
}
