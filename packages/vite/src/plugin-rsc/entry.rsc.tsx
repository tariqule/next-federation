// The remote's `rsc` entry (`rsc/index.js` in the build): a fetch handler,
// `(req: Request) => Promise<Response>`, that serves the island protocol.
import { createIslandHandler } from '@next-federation/server'
import type { RenderIsland } from '@next-federation/server'
import { renderToReadableStream } from '@vitejs/plugin-rsc/rsc'
import { createElement, version } from 'react'
import type { ComponentType } from 'react'
import config from 'virtual:next-federation/config'
import islands from 'virtual:next-federation/islands'
import { islandCssUrls } from './css.ts'
import { DEV_BOOTSTRAP_PATH } from './virtual.ts'

type SsrEntry = typeof import('./entry.ssr.tsx')

const loadSsr = (): Promise<SsrEntry> =>
  import.meta.viteRsc.loadModule<SsrEntry>('ssr', 'index')

// Buffered (design §13): the RSC stream is teed into the payload text and the
// SSR HTML, and both are awaited before the envelope is sent.
const render: RenderIsland = async (island, props, ctx) => {
  const mod = await islands[island]!.load()
  const Island = mod.default as ComponentType<Record<string, unknown>>
  const stream = renderToReadableStream(
    createElement(Island, props as Record<string, unknown>)
  )
  const [forPayload, forHtml] = stream.tee()
  const ssr = await loadSsr()
  const [rscPayload, html, css] = await Promise.all([
    new Response(forPayload).text(),
    ssr.renderIslandHtml(forHtml, {
      identifierPrefix: ctx.idPlaceholder,
      host: ctx.host,
    }),
    islandCssUrls(mod, config.publicBase),
  ])
  return { html, rscPayload, css }
}

const handler: (req: Request) => Promise<Response> = createIslandHandler({
  ...config,
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  reactVersion: version,
  render,
  bootstrapUrl: async () => {
    // Dev: the bootstrap module itself, never plugin-rsc's dev client wrapper
    // (it installs Fast Refresh globals on the host page).
    if (import.meta.env.DEV) {
      return new URL(DEV_BOOTSTRAP_PATH, config.publicBase).href
    }
    const ssr = await loadSsr()
    return new URL(ssr.clientEntryUrl(), config.publicBase).href
  },
  dev: import.meta.env.DEV,
})

export default handler

if (import.meta.hot) import.meta.hot.accept()
