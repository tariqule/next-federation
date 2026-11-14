import { runWithIdentity } from '@nf-spike/proto/identity';
import { sanitizeIslandHtml } from '@nf-spike/proto/protocol';
import {
  corsHeaders,
  createIslandHandler,
  identityFrom,
  type RenderResult,
} from '@nf-spike/proto/remote-handler';
import {
  decodeReply,
  loadServerAction,
  renderToReadableStream,
} from '@vitejs/plugin-rsc/rsc';
import {
  isValidElement,
  version,
  type ComponentType,
  type ReactNode,
} from 'react';
import Banner, { islandCss as BannerCss } from './islands/Banner';
import Links, { islandCss as LinksCss } from './islands/Links';
import MyOrders, { islandCss as MyOrdersCss } from './islands/MyOrders';
import ProductPanel, {
  islandCss as ProductPanelCss,
} from './islands/ProductPanel';
import Slow, { islandCss as SlowCss } from './islands/Slow';

const NAME = import.meta.env.NF_REMOTE as string;
const ORIGIN = import.meta.env.NF_ORIGIN as string;
const BUILD_ID = import.meta.env.NF_BUILD_ID as string;
const ALLOWED_ORIGINS = [
  'http://localhost:3100',
  'http://localhost:3101',
  'http://localhost:3102',
  'http://localhost:3103',
  'http://localhost:4200',
];

const islands: Record<string, ComponentType<any>> = {
  ProductPanel,
  Banner,
  MyOrders,
  Links,
  Slow,
};
const ISSUERS = [
  ...ALLOWED_ORIGINS.filter((o) => o !== 'http://localhost:4200'),
  'http://localhost:3999',
];

// Each island module exports its own islandCss() (see the note in the island files).
const cssFor: Record<string, () => ReactNode> = {
  ProductPanel: ProductPanelCss,
  Banner: BannerCss,
  MyOrders: MyOrdersCss,
  Links: LinksCss,
  Slow: SlowCss,
};

// Pull stylesheet hrefs out of what loadCss returns (a server component rendering <link>s).
// The host renders the links itself; islands never emit hoistables (design §6 island rules).
async function collectHrefs(
  node: ReactNode,
  out: string[] = [],
): Promise<string[]> {
  if (Array.isArray(node)) {
    for (const n of node) await collectHrefs(n, out);
  } else if (isValidElement<{ href?: string; children?: ReactNode }>(node)) {
    const type = node.type as { $$typeof?: symbol };
    if (type?.$$typeof === Symbol.for('react.client.reference')) return out; // client component: nothing to collect
    if (typeof node.type === 'function') {
      await collectHrefs(
        await (node.type as (p: unknown) => ReactNode | Promise<ReactNode>)(
          node.props,
        ),
        out,
      );
    } else {
      if (typeof node.props.href === 'string')
        out.push(new URL(node.props.href, ORIGIN).href);
      await collectHrefs(node.props.children, out);
    }
  }
  return [...new Set(out)];
}

async function renderIsland(
  island: string,
  props: unknown,
  identifierPrefix: string,
): Promise<RenderResult> {
  const Island = islands[island]!;
  const [forPayload, forHtml] = renderToReadableStream(
    <Island {...(props as object)} />,
  ).tee();
  const ssr = await import.meta.viteRsc.loadModule<
    typeof import('./entry.ssr')
  >('ssr', 'index');
  const [rscPayload, html] = await Promise.all([
    new Response(forPayload).text(),
    ssr.renderHtml(forHtml, identifierPrefix),
  ]);
  return {
    html: sanitizeIslandHtml(html),
    rscPayload,
    css: await collectHrefs(cssFor[island]!()),
  };
}

const islandHandler = createIslandHandler({
  name: NAME,
  buildId: BUILD_ID,
  reactVersion: version,
  allowedOrigins: ALLOWED_ORIGINS,
  islands,
  renderIsland,
  privateIslands: ['MyOrders'],
  issuers: ISSUERS,
  bootstrapUrl: async () => {
    // Dev: point at the bootstrap module itself, not plugin-rsc's dev wrapper (which installs
    // Fast Refresh globals on window). Build: the hashed client entry.
    if (import.meta.env.DEV) return new URL('/src/bootstrap.tsx', ORIGIN).href;
    const ssr = await import.meta.viteRsc.loadModule<
      typeof import('./entry.ssr')
    >('ssr', 'index');
    return new URL(ssr.clientEntryUrl(), ORIGIN).href;
  },
});

// Island Server Actions: POST /_nf/action, bearer identity, no cookies (design §6 Server Actions).
async function actionHandler(request: Request): Promise<Response> {
  const cors = corsHeaders(request, ALLOWED_ORIGINS);
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: cors });
  const origin = request.headers.get('origin');
  if (origin && !ALLOWED_ORIGINS.includes(origin))
    return new Response(null, { status: 403 });
  const identity = await identityFrom(request, {
    name: NAME,
    issuers: ISSUERS,
  });
  if (identity === 'invalid')
    return new Response(null, { status: 401, headers: cors });
  const id = request.headers.get('x-nf-action');
  if (!id)
    return new Response('missing x-nf-action', { status: 400, headers: cors });
  const body = request.headers
    .get('content-type')
    ?.startsWith('multipart/form-data')
    ? await request.formData()
    : await request.text();
  const args = (await decodeReply(body)) as unknown[];
  const action = (await loadServerAction(id)) as (
    ...a: unknown[]
  ) => Promise<unknown>;
  const run = () => action(...args);
  const returnValue = identity
    ? await runWithIdentity(identity, run)
    : await run();
  return new Response(renderToReadableStream({ returnValue }), {
    headers: {
      ...cors,
      'content-type': 'text/x-component;charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export default async function handler(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === '/_nf/health') return new Response('ok');
  if (pathname.startsWith('/_nf/island/')) return islandHandler(request);
  if (pathname === '/_nf/action') return actionHandler(request);
  return new Response('not found', { status: 404 });
}

if (import.meta.hot) import.meta.hot.accept();
