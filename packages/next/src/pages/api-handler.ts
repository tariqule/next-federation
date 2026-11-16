import type { IncomingMessage } from 'node:http'
import type { Federation } from '@next-federation/core'
import type { HostIdentity } from '@next-federation/core/identity'
import type { NextApiHandler } from 'next'
import { handleFederationRoute, startFederationRoutes } from '../route-core.ts'

/** The host's session lookup for Pages Router: it receives the request. */
export type PagesIdentity = (
  req: IncomingMessage & { cookies: Partial<Record<string, string>> }
) => HostIdentity | null | Promise<HostIdentity | null>

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null
}

/**
 * User file: `pages/api/next-federation/[...nf].ts`
 *
 * ```ts
 * export default createFederationApiHandler(federation, { getIdentity })
 * ```
 */
export function createFederationApiHandler(
  federation: Federation,
  options: { getIdentity: PagesIdentity }
): NextApiHandler {
  const ready = startFederationRoutes(federation)

  return async (req, res) => {
    // A bad signing key fails every request with its NF error (logged once).
    await ready
    const nf = req.query.nf
    const result = await handleFederationRoute(federation, {
      method: req.method ?? 'GET',
      segments: Array.isArray(nf) ? nf : nf ? [nf] : [],
      aud: first(req.query.aud),
      secFetchSite: first(req.headers['sec-fetch-site']),
      identity: async () => (await options.getIdentity(req)) ?? null,
    })
    for (const [name, value] of Object.entries(result.headers)) {
      res.setHeader(name, value)
    }
    if (result.body === undefined) {
      res.status(result.status).end()
      return
    }
    res.status(result.status).json(result.body)
  }
}
