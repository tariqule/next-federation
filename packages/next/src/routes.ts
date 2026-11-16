import type { Federation } from '@next-federation/core'
import { cookies, headers } from 'next/headers'
import { handleFederationRoute, startFederationRoutes } from './route-core.ts'
import type { AppIdentity } from './server/private-envelope.ts'

export type { AppIdentity } from './server/private-envelope.ts'

type RouteContext = { params: Promise<{ nf: string[] }> }

/**
 * User file: `app/api/next-federation/[...nf]/route.ts`
 *
 * ```ts
 * export const { GET, POST } = createFederationRoutes(federation, { getIdentity })
 * ```
 *
 * Signing keys are validated when this module loads (see `startFederationRoutes`).
 */
export function createFederationRoutes(
  federation: Federation,
  options: { getIdentity: AppIdentity }
): {
  GET(request: Request, ctx: RouteContext): Promise<Response>
  POST(request: Request, ctx: RouteContext): Promise<Response>
} {
  const ready = startFederationRoutes(federation)

  async function handle(request: Request, ctx: RouteContext) {
    // A bad signing key fails every request with its NF error (logged once).
    await ready
    const { nf } = await ctx.params
    const result = await handleFederationRoute(federation, {
      method: request.method,
      segments: nf ?? [],
      aud: new URL(request.url).searchParams.get('aud'),
      secFetchSite: request.headers.get('sec-fetch-site'),
      identity: async () =>
        (await options.getIdentity({
          cookies: await cookies(),
          headers: await headers(),
        })) ?? null,
    })
    const responseHeaders = new Headers(result.headers)
    if (result.body === undefined) {
      return new Response(null, {
        status: result.status,
        headers: responseHeaders,
      })
    }
    responseHeaders.set('Content-Type', 'application/json')
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: responseHeaders,
    })
  }

  return { GET: handle, POST: handle }
}
