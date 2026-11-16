import { NFError, logger } from '@next-federation/sdk'
import type { NFErrorCode } from '@next-federation/sdk'
import {
  DEFAULT_MAX_BODY_BYTES,
  HEALTH_PATH,
  ISLAND_PATH,
  decodeIslandRequest,
  parseEnvelope,
  redactUrl,
} from '@next-federation/protocol'
import type {
  HostContext,
  IslandEnvelope,
  ReactMode,
} from '@next-federation/protocol'
import { corsHeaders } from './cors.ts'
import { runWithIdentity } from './identity-context.ts'
import { createIdentityVerifier } from './identity-verify.ts'
import type { IdentityOutcome, IssuerMap } from './identity-verify.ts'
import { stripIslandHtml } from './strip-html.ts'

export { corsHeaders } from './cors.ts'

export type RenderContext = { idPlaceholder: string; host: HostContext }
export type RenderIsland = (
  island: string,
  props: unknown,
  ctx: RenderContext
) => Promise<{ html: string; rscPayload: string; css: string[] }>

export type IslandHandlerOptions = {
  name: string
  buildId: string
  mode: ReactMode
  reactVersion: string
  /** Allowed browser origins. `'*'` is rejected (NF-002). */
  hosts: string[]
  issuers?: IssuerMap
  /** Accept plain-http issuers/JWKS URLs for non-loopback hosts outside development. Default false. */
  allowInsecureHttp?: boolean
  islands: Record<string, { private?: boolean }>
  render: RenderIsland
  /** Absolute URL of the island bootstrap module. */
  bootstrapUrl: () => string | Promise<string>
  /** `Cache-Control: max-age` for public responses. Default 60. */
  maxAge?: number
  /** Request body limit in bytes. Default 65536. */
  maxBodyBytes?: number
  /** Enables NF-018 warnings for tags stripped from island HTML. */
  dev?: boolean
}

const VARY = 'Origin, Authorization'
const NO_STORE = 'no-store'

function fnv1a32(text: string): string {
  let h = 0x811c9dc5
  for (const byte of new TextEncoder().encode(text)) {
    h ^= byte
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** An entry must equal the `Origin` header a browser sends, or it can never match. */
function checkHost(h: unknown): void {
  let ok = false
  if (typeof h === 'string' && !h.includes('*')) {
    try {
      const u = new URL(h)
      ok = (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === h
    } catch {
      // falls through to the error below
    }
  }
  if (!ok) {
    throw new NFError(
      'NF-002',
      `\`hosts\` entry "${redactUrl(String(h))}" must be an exact lowercase origin such as "https://app.example" (http/https, no path, no trailing slash, no "*").`
    )
  }
}

/** `/seg/seg...` or empty: a base path without empty segments. */
const BASE_PREFIX = /^(?:\/[^/]+)*$/

/** `path` is `<base><route>`, the base being whole path segments. */
function isRoute(path: string, route: string): boolean {
  return path.endsWith(route) && BASE_PREFIX.test(path.slice(0, -route.length))
}

/** `path` is `<base>/_nf/island/<one segment>` (the name may still be invalid: 400). */
function isIslandPath(path: string): boolean {
  const at = path.lastIndexOf(ISLAND_PATH)
  return (
    at !== -1 &&
    BASE_PREFIX.test(path.slice(0, at)) &&
    !path.slice(at + ISLAND_PATH.length).includes('/')
  )
}

class TooLarge extends Error {}

/** Reads the body as text, failing as soon as more than `limit` bytes have arrived. */
async function readLimited(req: Request, limit: number): Promise<string> {
  const declared = req.headers.get('content-length')
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > limit) {
    throw new TooLarge()
  }
  if (req.body === null) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      throw new TooLarge()
    }
    chunks.push(value)
  }
  const all = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.byteLength
  }
  return new TextDecoder().decode(all)
}

export function createIslandHandler(
  options: IslandHandlerOptions
): (req: Request) => Promise<Response> {
  const {
    name,
    buildId,
    mode,
    reactVersion,
    hosts,
    islands,
    render,
    bootstrapUrl,
    dev = false,
  } = options
  const maxAge = options.maxAge ?? 60
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  if (!Array.isArray(hosts)) {
    throw new NFError('NF-002', '`hosts` must be an array of origins.')
  }
  for (const h of hosts) checkHost(h)
  const verify =
    options.issuers && Object.keys(options.issuers).length > 0
      ? createIdentityVerifier({
          audience: name,
          issuers: options.issuers,
          allowInsecureHttp: options.allowInsecureHttp,
        })
      : null

  const verifyIdentity = async (req: Request): Promise<IdentityOutcome> => {
    if (verify) return verify(req)
    // No issuers configured: no token can be trusted.
    return req.headers.has('authorization')
      ? { kind: 'invalid', code: 'NF-016' }
      : { kind: 'anonymous' }
  }

  return async (req) => {
    const cors = corsHeaders(req, hosts)
    const reply = (
      status: number,
      body: BodyInit | null,
      extra: Record<string, string> = {},
      withCors = true
    ): Response =>
      new Response(body, {
        status,
        headers: {
          ...(withCors ? cors : {}),
          vary: VARY,
          'cache-control': NO_STORE,
          ...extra,
        },
      })
    const fail = (
      status: number,
      code: NFErrorCode,
      extra?: Record<string, string>,
      withCors = true
    ): Response =>
      reply(
        status,
        JSON.stringify({ error: code }),
        { 'content-type': 'application/json', ...extra },
        withCors
      )

    const path = new URL(req.url).pathname

    // 1. health, 2. preflight, 3. origin: answered in this order regardless of the rest.
    if (req.method === 'GET' && isRoute(path, HEALTH_PATH)) {
      return reply(200, 'ok', { 'content-type': 'text/plain' })
    }
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...cors, vary: VARY },
      })
    }
    const origin = req.headers.get('origin')
    if (origin !== null && !hosts.includes(origin)) {
      return fail(403, 'NF-022', undefined, false)
    }

    if (!isIslandPath(path)) return reply(404, null)
    if (req.method !== 'GET' && req.method !== 'POST') return reply(405, null)

    let decodeReq = req
    try {
      if (req.method === 'POST') {
        const text = await readLimited(req, maxBodyBytes)
        decodeReq = new Request(req.url, {
          method: 'POST',
          headers: req.headers,
          body: text,
        })
      } else {
        const declared = req.headers.get('content-length')
        if (declared !== null && Number(declared) > maxBodyBytes) {
          return reply(413, null)
        }
      }
    } catch (e) {
      if (e instanceof TooLarge) return reply(413, null)
      return fail(400, 'NF-004')
    }

    let decoded: Awaited<ReturnType<typeof decodeIslandRequest>>
    try {
      decoded = await decodeIslandRequest(decodeReq)
    } catch {
      return fail(400, 'NF-004')
    }
    const { island, props, host } = decoded

    if (!Object.hasOwn(islands, island)) return fail(404, 'NF-021')

    const outcome = await verifyIdentity(req)
    if (outcome.kind === 'unavailable') {
      return fail(503, 'NF-015', { 'retry-after': '5' })
    }
    if (outcome.kind === 'invalid') return fail(401, outcome.code)
    const identity = outcome.kind === 'verified' ? outcome.identity : null
    if (identity === null && islands[island]!.private === true) {
      return fail(401, 'NF-014')
    }

    try {
      const idPlaceholder = `nfid-${fnv1a32(`${name}:${island}:${buildId}`)}-`
      const rendered = await runWithIdentity(identity, () =>
        render(island, props, { idPlaceholder, host })
      )
      const stripped = stripIslandHtml(rendered.html)
      if (dev) {
        for (const tag of stripped.removed) {
          if (
            tag.tag === 'link' &&
            /\brel\s*=\s*["']?modulepreload/i.test(tag.attrs)
          ) {
            continue
          }
          logger.warn(
            'NF-018',
            `Island "${island}" rendered <${tag.tag}${tag.attrs}>; it was removed.`
          )
        }
      }
      const envelope: IslandEnvelope = {
        protocolVersion: 1,
        remote: name,
        buildId,
        mode,
        html: stripped.html,
        rscPayload: rendered.rscPayload,
        css: rendered.css,
        bootstrap: await bootstrapUrl(),
        reactVersion,
        idPlaceholder,
      }
      parseEnvelope(envelope) // rejects non-absolute css/bootstrap URLs
      return new Response(JSON.stringify(envelope), {
        status: 200,
        headers: {
          ...cors,
          vary: VARY,
          'content-type': 'application/json',
          'cache-control': identity
            ? 'private, no-store'
            : `public, max-age=${maxAge}`,
        },
      })
    } catch (cause) {
      logger.error('NF-012', `Island "${island}" could not be served.`, cause)
      return reply(500, null)
    }
  }
}
