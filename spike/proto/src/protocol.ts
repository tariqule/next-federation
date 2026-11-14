// Island protocol v1 (design §6 "Island protocol").

export type IslandEnvelope = {
  protocolVersion: 1;
  buildId: string;
  html: string;
  rscPayload: string;
  css: string[];
  bootstrap: string;
  reactVersion: string;
  identifierPrefix: string;
};

export const GET_PROPS_LIMIT = 2048;
export const ISLAND_PATH = '/_nf/island/';

export class ProtocolError extends Error {
  override name = 'ProtocolError';
}

// Browser- and Node-safe base64url (no Buffer: this module also runs in the browser).
const toBase64Url = (text: string) => {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (text: string) => {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export function islandRequest(
  origin: string,
  island: string,
  props: unknown,
  opts: { token?: string } = {},
): { url: string; init: RequestInit } {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const base = `${origin.replace(/\/$/, '')}${ISLAND_PATH}${encodeURIComponent(island)}`;
  const json = JSON.stringify(props ?? {});
  const encoded = toBase64Url(json);
  if (encoded.length <= GET_PROPS_LIMIT) {
    return { url: `${base}?p=${encoded}`, init: { method: 'GET', headers } };
  }
  headers['content-type'] = 'application/json';
  return { url: base, init: { method: 'POST', headers, body: json } };
}

export async function readIslandRequest(
  req: Request,
): Promise<{ island: string; props: unknown }> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith(ISLAND_PATH))
    throw new ProtocolError(`not an island path: ${url.pathname}`);
  const island = decodeURIComponent(url.pathname.slice(ISLAND_PATH.length));
  if (!island) throw new ProtocolError('missing island id');
  if (req.method === 'POST') return { island, props: await req.json() };
  const p = url.searchParams.get('p');
  return { island, props: p ? JSON.parse(fromBase64Url(p)) : {} };
}

const STRING_FIELDS = [
  'buildId',
  'html',
  'rscPayload',
  'bootstrap',
  'reactVersion',
  'identifierPrefix',
] as const;

export function parseEnvelope(json: unknown): IslandEnvelope {
  if (!json || typeof json !== 'object')
    throw new ProtocolError('envelope is not an object');
  const e = json as Record<string, unknown>;
  if (e.protocolVersion !== 1)
    throw new ProtocolError(
      `unsupported protocolVersion: ${String(e.protocolVersion)}`,
    );
  for (const f of STRING_FIELDS) {
    if (typeof e[f] !== 'string')
      throw new ProtocolError(`missing or invalid field: ${f}`);
  }
  if (!Array.isArray(e.css) || !e.css.every((c) => typeof c === 'string')) {
    throw new ProtocolError('missing or invalid field: css');
  }
  return e as unknown as IslandEnvelope;
}

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

// JSON for an inline <script type="application/json">, safe against breaking out of the script.
export function embedPayload(payload: string): string {
  return JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .split(LS)
    .join('\\u2028')
    .split(PS)
    .join('\\u2029');
}

// React and plugin-rsc SSR emit <link rel="modulepreload"> hoistables and inline scripts (form
// replay). Island HTML must contain neither (design §6 island rules): React would hoist the links
// into the host's <head>, and scripts set via innerHTML never run. React escapes text content,
// so a literal "<script" or "<link" here is always a real tag.
export function sanitizeIslandHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b[^>]*>/gi, '');
}
