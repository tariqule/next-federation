// Framework-free island handler: Web Request → Response (design §6 "Remote side").
import type { ComponentType } from 'react';
import { decodeJwt } from 'jose';
import {
  IdentityError,
  IdentityUnavailableError,
  runWithIdentity,
  verifyIslandToken,
  type IslandIdentity,
} from './identity';
import {
  ProtocolError,
  readIslandRequest,
  type IslandEnvelope,
} from './protocol';

export type RenderResult = { html: string; rscPayload: string; css: string[] };

export type IslandHandlerOptions = {
  name: string;
  buildId: string;
  reactVersion: string;
  allowedOrigins: string[];
  islands: Record<string, ComponentType<any>>;
  bootstrapUrl: () => Promise<string>;
  renderIsland: (
    island: string,
    props: unknown,
    identifierPrefix: string,
  ) => Promise<RenderResult>;
  /** Islands that require a verified identity token. */
  privateIslands?: string[];
  /** Hosts allowed to mint tokens for this remote; JWKS is fetched from `${iss}/api/nf/jwks`. */
  issuers?: string[];
};

export async function identityFrom(
  req: Request,
  opts: Pick<IslandHandlerOptions, 'name' | 'issuers'>,
): Promise<IslandIdentity | null | 'invalid' | 'unavailable'> {
  const auth = req.headers.get('authorization');
  if (!auth) return null;
  const token = auth.replace(/^Bearer /, '');
  try {
    const iss = decodeJwt(token).iss;
    if (!iss || !opts.issuers?.includes(iss)) return 'invalid';
    return await verifyIslandToken(token, {
      jwksUrl: `${iss}/api/nf/jwks`,
      aud: opts.name,
      issuers: opts.issuers,
    });
  } catch (e) {
    if (e instanceof IdentityUnavailableError) return 'unavailable';
    if (e instanceof IdentityError || e instanceof Error) return 'invalid';
    throw e;
  }
}

const hash = (text: string) => {
  let h = 5381;
  for (let i = 0; i < text.length; i++)
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

export const identifierPrefixFor = (
  name: string,
  island: string,
  props: unknown,
) => `nf-${name}-${island}-${hash(JSON.stringify(props ?? {}))}-`;

export function corsHeaders(
  req: Request,
  allowedOrigins: string[],
): Record<string, string> {
  const origin = req.headers.get('origin');
  const headers: Record<string, string> = { vary: 'Origin' };
  if (origin && allowedOrigins.includes(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-headers'] =
      'Authorization, Content-Type, X-NF-Action';
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    headers['access-control-max-age'] = '600';
  }
  return headers;
}

export function createIslandHandler(
  opts: IslandHandlerOptions,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const cors = corsHeaders(req, opts.allowedOrigins);
    if (req.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: cors });
    let island: string;
    let props: unknown;
    try {
      ({ island, props } = await readIslandRequest(req));
    } catch (e) {
      if (e instanceof ProtocolError)
        return new Response(e.message, { status: 400, headers: cors });
      throw e;
    }
    if (!Object.hasOwn(opts.islands, island)) {
      return new Response(`unknown island: ${island}`, {
        status: 404,
        headers: cors,
      });
    }
    const identity = await identityFrom(req, opts);
    if (identity === 'unavailable') {
      // The issuer's JWKS can't be reached: a temporary server problem, not a bad token.
      return new Response(null, {
        status: 503,
        headers: { ...cors, 'cache-control': 'no-store', 'retry-after': '5' },
      });
    }
    if (
      identity === 'invalid' ||
      (!identity && opts.privateIslands?.includes(island))
    ) {
      return new Response(null, {
        status: 401,
        headers: { ...cors, 'cache-control': 'no-store' },
      });
    }
    const identifierPrefix = identifierPrefixFor(opts.name, island, props);
    const render = () => opts.renderIsland(island, props, identifierPrefix);
    const rendered = identity
      ? await runWithIdentity(identity, render)
      : await render();
    const envelope: IslandEnvelope = {
      protocolVersion: 1,
      buildId: opts.buildId,
      html: rendered.html,
      rscPayload: rendered.rscPayload,
      css: rendered.css,
      bootstrap: await opts.bootstrapUrl(),
      reactVersion: opts.reactVersion,
      identifierPrefix,
    };
    return Response.json(envelope, {
      // Token-bearing responses are always private (design §9 caching).
      headers: {
        ...cors,
        'cache-control': identity ? 'private, no-store' : 'public, max-age=60',
      },
    });
  };
}
