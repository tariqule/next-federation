import { fetchIsland } from '@next-federation/core'
import type { Federation, IslandResult } from '@next-federation/core'
import { identityKey, mintIslandToken } from '@next-federation/core/identity'
import type { HostContext, IslandEnvelope } from '@next-federation/protocol'
import { canonicalJson } from '@next-federation/protocol'
import { NFError } from '@next-federation/sdk'
import type { GetServerSidePropsContext, GetStaticPropsContext } from 'next'
import { hostBasePath } from '../server/assert-wrapped.ts'
import {
  keepSeconds,
  lastGood,
  lastGoodKey,
  rememberGood,
} from '../server/last-good.ts'
import { reportIsland } from '../server/report-island.ts'
import type { PagesIdentity } from './api-handler.ts'

/**
 * What `getIslandProps` returns, to spread into `<RemoteIsland>` from
 * `@next-federation/next/pages`. JSON-serialisable (no `undefined`), as Next
 * requires for page props. Never holds a token: private islands carry only
 * the token endpoint and an opaque per-user key. Public islands on a host with
 * `getIdentity` carry the endpoint with `identityKey: null`, so their Server
 * Actions act as whoever is signed in when they run.
 */
export type IslandProps = {
  remote: string
  /** null: the remote failed, or the visitor is anonymous on a private island. */
  envelope: IslandEnvelope | null
  host: HostContext
  token: { endpoint: string; identityKey: string | null } | null
  /**
   * Set when the remote failed and `envelope` is this public island's last
   * good envelope from this server process (stale-if-error, kept at most an
   * hour or twice `islands.revalidate`). Retry soon, e.g. `revalidate:
   * banner.envelope && !banner.stale ? 60 : 5` in `getStaticProps`.
   */
  stale?: true
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
 * `revalidate` is the cache. A failed public fetch returns the island's last
 * good envelope from this process with `stale: true` when there is one.
 * Private islands read the identity from `ctx.req` and mint the token on the
 * server, where it is used for the one remote request and never returned.
 * Remote failures and anonymous visitors give `envelope: null` (the
 * fallback); caller mistakes throw (NF-001, NF-002, NF-009, NF-013, NF-017).
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
      const endpoint = `${host.basePath}${federation.routesPath}/token?aud=${encodeURIComponent(remote)}`

      if (!spec.private) {
        const result = await fetchIsland(target, { island, props, host })
        const at = Date.now()
        const key = lastGoodKey(
          target,
          island,
          canonicalJson(props),
          canonicalJson(host)
        )
        const kept = result.ok
          ? null
          : lastGood(key, at, keepSeconds(federation.islands.revalidate))
        if (result.ok) rememberGood(key, result, at)
        reportIsland(federation, target, island, result, kept?.ageSeconds)
        const good = result.ok ? result : kept?.result
        if (!good) return empty
        // D2: no identity is read (getStaticProps works, nothing per-user is rendered).
        const actsAsUser =
          options.getIdentity !== undefined && federation.identity !== null
        return {
          ...empty,
          envelope: good.envelope,
          token: actsAsUser ? { endpoint, identityKey: null } : null,
          ...(kept ? { stale: true as const } : {}),
        }
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
          endpoint,
          identityKey: await identityKey(federation, identity.sub),
        },
      }
    },
  }
}
