import { fetchIsland } from '@next-federation/core'
import type { Federation, IslandResult } from '@next-federation/core'
import { identityKey, mintIslandToken } from '@next-federation/core/identity'
import type { HostContext, IslandEnvelope } from '@next-federation/protocol'
import { NFError } from '@next-federation/sdk'
import type { GetServerSidePropsContext, GetStaticPropsContext } from 'next'
import { hostBasePath } from '../server/assert-wrapped.ts'
import { reportIsland } from '../server/report-island.ts'
import type { PagesIdentity } from './api-handler.ts'

/**
 * What `getIslandProps` returns, to spread into `<RemoteIsland>` from
 * `@next-federation/next/pages`. JSON-serialisable (no `undefined`), as Next
 * requires for page props. Never holds a token: private islands carry only
 * the token endpoint and an opaque per-user key.
 */
export type IslandProps = {
  remote: string
  /** null: the remote failed, or the visitor is anonymous on a private island. */
  envelope: IslandEnvelope | null
  host: HostContext
  token: { endpoint: string; identityKey: string } | null
}

export type PagesIslandSpec = {
  remote: string
  island: string
  props?: Record<string, unknown>
  /** Per-user island: `getServerSideProps` only, and needs `getIdentity`. */
  private?: boolean
}

type PagesContext = GetServerSidePropsContext | GetStaticPropsContext

/** `''` for the default locale or no i18n, else the URL prefix segment. */
function localeOf(ctx: PagesContext): string {
  return ctx.locale && ctx.locale !== ctx.defaultLocale ? ctx.locale : ''
}

/**
 * The Pages Router API (design §6):
 *
 * ```ts
 * export const { getIslandProps } = createPagesIslands(federation, { getIdentity })
 *
 * export const getServerSideProps = async (ctx) => ({
 *   props: { cart: await getIslandProps(ctx, { remote: 'shop', island: 'Cart' }) },
 * })
 * ```
 *
 * Public islands fetch on every call; in `getStaticProps` the page's own
 * `revalidate` is the cache. Private islands read the identity from `ctx.req`
 * and mint the token on the server, where it is used for the one remote
 * request and never returned. Remote failures and anonymous visitors give
 * `envelope: null` (the fallback); caller mistakes throw (NF-001, NF-002,
 * NF-009, NF-013, NF-017).
 */
export function createPagesIslands(
  federation: Federation,
  options: { getIdentity?: PagesIdentity } = {}
): {
  getIslandProps(ctx: PagesContext, spec: PagesIslandSpec): Promise<IslandProps>
} {
  return {
    async getIslandProps(ctx, spec) {
      const host: HostContext = {
        basePath: hostBasePath(),
        locale: localeOf(ctx),
      }
      const target = federation.target(spec.remote)
      const { remote, island } = spec
      const props = spec.props ?? {}
      const empty: IslandProps = { remote, envelope: null, host, token: null }

      if (!spec.private) {
        const result = await fetchIsland(target, { island, props, host })
        reportIsland(federation, target, island, result)
        return result.ok ? { ...empty, envelope: result.envelope } : empty
      }

      const req = 'req' in ctx ? ctx.req : undefined
      if (!req) {
        throw new NFError(
          'NF-002',
          `Island "${island}" from remote "${remote}" is private: call getIslandProps() from getServerSideProps, not getStaticProps.`
        )
      }
      const { getIdentity } = options
      if (!getIdentity || federation.identity === null) {
        throw new NFError(
          'NF-013',
          `Island "${island}" from remote "${remote}" is private: pass \`getIdentity\` to createPagesIslands() and set \`identity\` in defineFederation().`
        )
      }
      const identity = await getIdentity(req)
      if (!identity) return empty
      const { token } = await mintIslandToken(federation, { remote, identity })
      const result: IslandResult = await fetchIsland(target, {
        island,
        props,
        host,
        token,
        init: { cache: 'no-store' },
      })
      reportIsland(federation, target, island, result)
      if (!result.ok) return empty
      return {
        ...empty,
        envelope: result.envelope,
        token: {
          endpoint: `${host.basePath}${federation.routesPath}/token?aud=${encodeURIComponent(remote)}`,
          identityKey: await identityKey(federation, identity.sub),
        },
      }
    },
  }
}
