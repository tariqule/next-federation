import type { Federation } from '@next-federation/core'
import {
  identityKey,
  mintIslandToken,
  publicJwks,
  validateIdentity,
} from '@next-federation/core/identity'
import type { HostIdentity } from '@next-federation/core/identity'
import { isNFError, logger } from '@next-federation/sdk'

export type RouteRequest = {
  method: string
  /** Path segments after the routes path, e.g. `['token']`. */
  segments: string[]
  /** The `aud` query parameter, or null when absent. */
  aud: string | null
  /** The `Sec-Fetch-Site` request header, or null when absent. */
  secFetchSite: string | null
  /** Resolves the host's own session. Called only for an allowed token request. */
  identity: () => Promise<HostIdentity | null>
}

export type RouteResult = {
  status: number
  headers: Record<string, string>
  body?: unknown
}

const NO_STORE = { 'Cache-Control': 'no-store' }

function empty(status: number): RouteResult {
  return { status, headers: {} }
}

/**
 * Framework-free JWKS and token routes. The library never reads or sets a
 * cookie: the session comes from the host's own `identity()` callback.
 */
export async function handleFederationRoute(
  federation: Federation,
  req: RouteRequest
): Promise<RouteResult> {
  if (federation.identity === null) return empty(404)
  const [route, ...rest] = req.segments
  if (rest.length > 0) return empty(404)

  if (req.method === 'GET' && route === 'jwks') {
    return {
      status: 200,
      headers: { 'Cache-Control': 'public, max-age=300' },
      body: await publicJwks(federation),
    }
  }

  if (req.method === 'POST' && route === 'token') {
    // Browsers set Sec-Fetch-Site; when present, only same-origin may mint.
    if (req.secFetchSite !== null && req.secFetchSite !== 'same-origin') {
      return { status: 403, headers: NO_STORE }
    }
    const aud = req.aud
    if (aud === null || !federation.remotes.includes(aud)) {
      return { status: 400, headers: NO_STORE }
    }
    const identity = await req.identity()
    // An anonymous visitor is not an error: no token, so island requests and
    // Server Actions go without `Authorization` (and the browser logs no 401).
    if (!identity)
      return { status: 200, headers: NO_STORE, body: { token: null } }
    const { token, expiresAt } = await mintIslandToken(federation, {
      remote: aud,
      identity,
    })
    return {
      status: 200,
      headers: NO_STORE,
      body: {
        token,
        expiresAt,
        identityKey: await identityKey(federation, identity.sub),
      },
    }
  }

  return empty(404)
}

const started = new WeakMap<Federation, Promise<void>>()

/**
 * Validates the signing keys once per Federation, at the time the route
 * module is created, so a bad key fails at startup (logged with its NF code)
 * rather than on the first signed-in request. A no-op without `identity`.
 * Requests await the same promise and then fail with the same error.
 */
export function startFederationRoutes(federation: Federation): Promise<void> {
  let ready = started.get(federation)
  if (!ready) {
    ready =
      federation.identity === null
        ? Promise.resolve()
        : validateIdentity(federation)
    started.set(federation, ready)
    ready.catch((error: unknown) => {
      if (isNFError(error)) logger.error(error.code, error.message)
      else logger.error('NF-002', 'identity validation failed.')
    })
  }
  return ready
}
