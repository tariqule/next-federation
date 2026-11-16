import { fetchIsland } from '@next-federation/core'
import type {
  Federation,
  IslandResult,
  IslandTarget,
} from '@next-federation/core'
import { identityKey, mintIslandToken } from '@next-federation/core/identity'
import type { HostIdentity } from '@next-federation/core/identity'
import type { HostContext } from '@next-federation/protocol'
import { NFError } from '@next-federation/sdk'
import { cookies, headers } from 'next/headers'

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
 * server for this one request: it goes only into the request's
 * `Authorization` header and is never returned. Host cookies are not
 * forwarded (`fetchIsland` sends `credentials: 'omit'`). An anonymous visitor
 * makes no remote request.
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
  const identity = await getIdentity({
    cookies: await cookies(),
    headers: await headers(),
  })
  if (!identity) return { kind: 'anonymous' }
  const { token } = await mintIslandToken(federation, {
    remote: target.remote,
    identity,
  })
  const result = await fetchIsland(target, {
    ...request,
    token,
    init: { cache: 'no-store' },
  })
  return {
    kind: 'fetched',
    result,
    identityKey: await identityKey(federation, identity.sub),
  }
}
