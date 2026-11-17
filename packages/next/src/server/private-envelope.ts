import { fetchIsland } from '@next-federation/core'
import type {
  Federation,
  IslandResult,
  IslandTarget,
} from '@next-federation/core'
import { identityKey, mintIslandToken } from '@next-federation/core/identity'
import type { HostIdentity } from '@next-federation/core/identity'
import type { HostContext } from '@next-federation/protocol'
import { NFError, logger } from '@next-federation/sdk'
import { cookies, headers } from 'next/headers'
import { devDebugInfoCause } from './dev-debug-info.ts'
import type { DevDebugInfoCause } from './dev-debug-info.ts'

const LIMITS =
  'https://github.com/tariqule/next-federation/blob/main/docs/guides/limits.md#next-dev-and-linked-installs'

const VALUES =
  "the request's cookies and headers, your getIdentity result, the island token"

const CAUSES: Record<DevDebugInfoCause, string> = {
  linked: `@next-federation/next is loaded from outside node_modules (a workspace link or \`npm link\`), so \`next dev\` treats it as your own code: React's development debug info then carries what it awaits for private islands (${VALUES}) to the browser, in the HTML on Next.js 15 and over the dev server's websocket on Next.js 16. Installed from node_modules, and in production builds, this does not happen.`,
  'source-maps-off': `\`next dev\` runs without Node's source maps (\`--disable-source-maps\`), so Next's dev tooling may not tell this library from your own code: React's development debug info could then carry what it awaits for private islands (${VALUES}) to the browser. Run \`next dev\` with source maps (the default); production builds are not affected.`,
}

/**
 * The token's clock. A render with `partialPrefetching` (create-next-app's
 * default) flags `Date.now()` before the render's first uncached I/O, which
 * the token comes before. `performance.timeOrigin + performance.now()` is
 * not flagged (Next reserves it for measurements), but it is monotonic: it
 * stops while the machine sleeps and ignores clock steps. So it is
 * corrected by `clockOffset`, re-measured with `Date.now()` once the remote
 * request has returned, when the render is past those stages.
 */
let clockOffset = 0
const monotonicWallMs = (): number => performance.timeOrigin + performance.now()
const tokenNow = (): number => (monotonicWallMs() + clockOffset) / 1000
/** Re-measures the offset; returns how far it moved, in ms. */
function syncTokenClock(): number {
  const previous = clockOffset
  clockOffset = Date.now() - monotonicWallMs()
  return Math.abs(clockOffset - previous)
}
/** An offset that moved this much may have made the token look expired. */
const CLOCK_JUMP_MS = 5_000

/**
 * The host's session lookup for App Router. It receives the request's
 * `cookies()` and `headers()` values and returns the signed-in user, or null
 * for an anonymous visitor. Used by `createIslands` and `createFederationRoutes`.
 */
export type AppIdentity = (ctx: {
  cookies: Awaited<ReturnType<typeof cookies>>
  headers: Awaited<ReturnType<typeof headers>>
}) => HostIdentity | null | Promise<HostIdentity | null>

export type PrivateEnvelope =
  | { kind: 'anonymous' }
  | { kind: 'fetched'; result: IslandResult; identityKey: string }

/**
 * Fetches a per-user island. The identity is read with `cookies()` and
 * `headers()` here, outside any cache scope, and the token is minted on the
 * server for this one request (without `Date.now()`, see `tokenNow`): it
 * goes only into the request's `Authorization` header and is never returned. Host cookies are not
 * forwarded (`fetchIsland` sends `credentials: 'omit'`). An anonymous visitor
 * makes no remote request. Under `next dev`, warns once (NF-037) when
 * React's debug info may carry these values to the browser: this library
 * linked from outside node_modules, or Node's source maps off.
 */
export async function getPrivateEnvelope(
  federation: Federation,
  getIdentity: AppIdentity | undefined,
  target: IslandTarget,
  request: { island: string; props: Record<string, unknown>; host: HostContext }
): Promise<PrivateEnvelope> {
  if (!getIdentity || federation.identity === null) {
    throw new NFError(
      'NF-013',
      `Island "${request.island}" from remote "${target.remote}" is private: pass \`getIdentity\` to createIslands() and set \`identity\` in defineFederation().`
    )
  }
  const cause =
    process.env.NODE_ENV === 'development' ? devDebugInfoCause() : null
  if (cause !== null) {
    logger.warnOnce(
      'NF-037',
      cause,
      `${CAUSES[cause]} Keep the dev server on your machine (\`next dev -H 127.0.0.1\`). See ${LIMITS}`
    )
  }
  const identity = await getIdentity({
    cookies: await cookies(),
    headers: await headers(),
  })
  if (!identity) return { kind: 'anonymous' }
  const fetchWithToken = async (): Promise<IslandResult> => {
    const { token } = await mintIslandToken(federation, {
      remote: target.remote,
      identity,
      now: tokenNow(),
    })
    return fetchIsland(target, {
      ...request,
      token,
      init: { cache: 'no-store' },
    })
  }
  let result = await fetchWithToken()
  // A remote that refused a token minted on a clock that had fallen behind
  // (the host slept) gets one more, minted on the corrected clock.
  if (syncTokenClock() > CLOCK_JUMP_MS && !result.ok && result.status === 401) {
    result = await fetchWithToken()
  }
  return {
    kind: 'fetched',
    result,
    identityKey: await identityKey(federation, identity.sub),
  }
}
