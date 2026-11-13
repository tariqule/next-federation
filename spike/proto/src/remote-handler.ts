// Framework-free island handler: Web Request → Response (design §6 "Remote side").
import type { ComponentType } from 'react'
import { ProtocolError, readIslandRequest, type IslandEnvelope } from './protocol'

export type RenderResult = { html: string; rscPayload: string; css: string[] }

export type IslandHandlerOptions = {
  name: string
  buildId: string
  reactVersion: string
  allowedOrigins: string[]
  islands: Record<string, ComponentType<any>>
  bootstrapUrl: () => Promise<string>
  renderIsland: (island: string, props: unknown, identifierPrefix: string) => Promise<RenderResult>
}

const hash = (text: string) => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
  return h.toString(36)
}

export const identifierPrefixFor = (name: string, island: string, props: unknown) =>
  `nf-${name}-${island}-${hash(JSON.stringify(props ?? {}))}-`

export function corsHeaders(req: Request, allowedOrigins: string[]): Record<string, string> {
  const origin = req.headers.get('origin')
  const headers: Record<string, string> = { vary: 'Origin' }
  if (origin && allowedOrigins.includes(origin)) {
    headers['access-control-allow-origin'] = origin
    headers['access-control-allow-headers'] = 'Authorization, Content-Type'
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS'
    headers['access-control-max-age'] = '600'
  }
  return headers
}

export function createIslandHandler(opts: IslandHandlerOptions): (req: Request) => Promise<Response> {
  return async (req) => {
    const cors = corsHeaders(req, opts.allowedOrigins)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    let island: string
    let props: unknown
    try {
      ;({ island, props } = await readIslandRequest(req))
    } catch (e) {
      if (e instanceof ProtocolError) return new Response(e.message, { status: 400, headers: cors })
      throw e
    }
    if (!Object.hasOwn(opts.islands, island)) {
      return new Response(`unknown island: ${island}`, { status: 404, headers: cors })
    }
    const identifierPrefix = identifierPrefixFor(opts.name, island, props)
    const rendered = await opts.renderIsland(island, props, identifierPrefix)
    const envelope: IslandEnvelope = {
      protocolVersion: 1,
      buildId: opts.buildId,
      html: rendered.html,
      rscPayload: rendered.rscPayload,
      css: rendered.css,
      bootstrap: await opts.bootstrapUrl(),
      reactVersion: opts.reactVersion,
      identifierPrefix,
    }
    return Response.json(envelope, {
      headers: { ...cors, 'cache-control': 'public, max-age=60' },
    })
  }
}
