import { createIslandHandler, type RenderResult } from '@nf-spike/proto/remote-handler'
import { renderToReadableStream } from '@vitejs/plugin-rsc/rsc'
import { isValidElement, version, type ComponentType, type ReactNode } from 'react'
import Banner from './islands/Banner'
import MyOrders from './islands/MyOrders'
import ProductPanel from './islands/ProductPanel'

const NAME = import.meta.env.NF_REMOTE as string
const ORIGIN = import.meta.env.NF_ORIGIN as string
const BUILD_ID = process.env.NF_BUILD_ID ?? `dev-${Date.now().toString(36)}`
const ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:4200']

const islands: Record<string, ComponentType<any>> = { ProductPanel, Banner, MyOrders }
const ISSUERS = [...ALLOWED_ORIGINS.filter((o) => o !== 'http://localhost:4200'), 'http://localhost:3999']

// loadCss needs a literal module id, so one call per island.
const cssFor: Record<string, () => ReactNode> = {
  ProductPanel: () => import.meta.viteRsc.loadCss('/src/islands/ProductPanel.tsx'),
  Banner: () => import.meta.viteRsc.loadCss('/src/islands/Banner.tsx'),
  MyOrders: () => import.meta.viteRsc.loadCss('/src/islands/MyOrders.tsx'),
}

// Pull stylesheet hrefs out of what loadCss returns (a server component rendering <link>s).
// The host renders the links itself; islands never emit hoistables (design §6 island rules).
async function collectHrefs(node: ReactNode, out: string[] = []): Promise<string[]> {
  if (Array.isArray(node)) {
    for (const n of node) await collectHrefs(n, out)
  } else if (isValidElement<{ href?: string; children?: ReactNode }>(node)) {
    const type = node.type as { $$typeof?: symbol }
    if (type?.$$typeof === Symbol.for('react.client.reference')) return out // client component: nothing to collect
    if (typeof node.type === 'function') {
      await collectHrefs(await (node.type as (p: unknown) => ReactNode | Promise<ReactNode>)(node.props), out)
    } else {
      if (typeof node.props.href === 'string') out.push(new URL(node.props.href, ORIGIN).href)
      await collectHrefs(node.props.children, out)
    }
  }
  return [...new Set(out)]
}

async function renderIsland(island: string, props: unknown, identifierPrefix: string): Promise<RenderResult> {
  const Island = islands[island]!
  const [forPayload, forHtml] = renderToReadableStream(<Island {...(props as object)} />).tee()
  const ssr = await import.meta.viteRsc.loadModule<typeof import('./entry.ssr')>('ssr', 'index')
  const [rscPayload, html] = await Promise.all([new Response(forPayload).text(), ssr.renderHtml(forHtml, identifierPrefix)])
  return { html, rscPayload, css: await collectHrefs(cssFor[island]!()) }
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
    if (import.meta.env.DEV) return new URL('/src/bootstrap.tsx', ORIGIN).href
    const ssr = await import.meta.viteRsc.loadModule<typeof import('./entry.ssr')>('ssr', 'index')
    return new URL(ssr.clientEntryUrl(), ORIGIN).href
  },
})

export default async function handler(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (pathname === '/_nf/health') return new Response('ok')
  if (pathname.startsWith('/_nf/island/')) return islandHandler(request)
  return new Response('not found', { status: 404 })
}

if (import.meta.hot) import.meta.hot.accept()
