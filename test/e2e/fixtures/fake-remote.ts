// A hand-written remote (port 4102) for host test cases. Island cases:
//   BrokenBootstrap  a valid envelope whose bootstrap URL (on this origin)
//                    answers 404, so the island never hydrates.
//   Echo             server HTML only (no working bootstrap): the props'
//                    `id`, the current content revision, the request method
//                    and the length of the decoded props JSON, e.g.
//                    `<p data-testid="echo">echo x rev 3 via GET props 10 keys id</p>`;
//                    `keys` is the props' key order as sent on the wire. A
//                    string `text` prop is echoed too, HTML-escaped, in
//                    `<span data-testid="echo-text">`. Props above the GET
//                    limit arrive by POST.
//   Flaky            like Echo, but answers 503 while switched down.
//   ForeignBootstrap a valid envelope whose bootstrap URL is on another origin
//                    (the lane's port 4199, where nothing listens).
//   VersionTwo       a valid envelope, except `protocolVersion: 2`.
//   NotJson          200 `text/html`: an HTML page, not an envelope.
// Control endpoints (test-only):
//   GET  /_stats             `{ requests: { "<Island>:<props.id>": n },
//                            arrivals: { "<Island>:<props.id>": [ms, …] } }`
//                            (arrivals: Date.now() when each request came in)
//   POST /_stats/reset       clears the counts and arrivals
//   POST /_rev               bumps the content revision; returns `{ rev }`
//   POST /_flaky?down=1|0    switches Flaky down or up
import { createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { lanePort } from '../lane.ts'

const PORT = Number(process.env.PORT ?? 4102)
const ORIGIN = `http://127.0.0.1:${PORT}`
// Not this origin, and nothing listens there.
const FOREIGN = `http://127.0.0.1:${lanePort(4199)}`

let rev = 1
let flakyDown = false
const requests = new Map<string, number>()
const arrivals = new Map<string, number[]>()

type Props = { id?: unknown; text?: unknown }
/** The decoded props, with the request's method and props JSON length. */
/**
 * The decoded props (JSON.parse keeps the key order of the wire text), the
 * request's method and the length of the props JSON.
 */
type IslandRequest = { props: Props; method: string; length: number }

const asProps = (value: unknown): Props =>
  typeof value === 'object' && value !== null ? (value as Props) : {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// GET carries the props as base64url JSON in `?p=`; POST (props above the
// GET limit) as `{ props, host }` JSON in the body.
async function readRequest(
  req: IncomingMessage,
  url: URL
): Promise<IslandRequest> {
  const method = req.method ?? 'GET'
  try {
    if (method === 'POST') {
      const body = asProps(JSON.parse(await readBody(req))) as {
        props?: unknown
      }
      const json = JSON.stringify(body.props ?? {})
      return { props: asProps(body.props), method, length: json.length }
    }
    const p = url.searchParams.get('p')
    if (!p) return { props: {}, method, length: 0 }
    const json = Buffer.from(p, 'base64url').toString('utf8')
    return { props: asProps(JSON.parse(json)), method, length: json.length }
  } catch {
    return { props: {}, method, length: 0 }
  }
}

const envelope = (html: string) => ({
  protocolVersion: 1,
  remote: 'fake',
  buildId: 'fake-1',
  mode: 'production',
  html,
  rscPayload: '',
  css: [],
  bootstrap: `${ORIGIN}/assets/missing-bootstrap.js`,
  reactVersion: '19.3.1',
  idPlaceholder: 'NFID_fake',
})

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const echoHtml = (island: string, { props, method, length }: IslandRequest) => {
  const name = island.toLowerCase()
  const keys = Object.keys(props).join(',')
  const text =
    typeof props.text === 'string'
      ? ` text <span data-testid="${name}-text">${escapeHtml(props.text)}</span>`
      : ''
  return `<p data-testid="${name}">${name} ${String(props.id ?? '')} rev ${rev} via ${method} props ${length} keys ${keys}${text}</p>`
}

// Each answers an envelope, `null` (503) or `{ page }` (a 200 `text/html`).
const ISLANDS: Record<string, (request: IslandRequest) => unknown> = {
  BrokenBootstrap: () =>
    envelope('<p data-testid="broken-html">server html of a broken island</p>'),
  Echo: (request) => envelope(echoHtml('Echo', request)),
  Flaky: (request) => (flakyDown ? null : envelope(echoHtml('Flaky', request))),
  ForeignBootstrap: () => ({
    ...envelope('<p data-testid="foreign-html">foreign bootstrap html</p>'),
    bootstrap: `${FOREIGN}/assets/foreign-bootstrap.js`,
  }),
  VersionTwo: () => ({
    ...envelope('<p data-testid="v2-html">protocol 2 html</p>'),
    protocolVersion: 2,
  }),
  NotJson: () => ({
    page: '<!doctype html><html><body><p>not an envelope</p></body></html>',
  }),
}

const json = (res: import('node:http').ServerResponse, body: unknown) => {
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', ORIGIN)
  // Browser hosts fetch envelopes cross-origin.
  res.setHeader('access-control-allow-origin', '*')
  if (url.pathname === '/_nf/health') {
    res.setHeader('content-type', 'text/plain')
    return res.end('ok')
  }
  if (url.pathname === '/_stats' && req.method === 'GET') {
    return json(res, {
      requests: Object.fromEntries(requests),
      arrivals: Object.fromEntries(arrivals),
    })
  }
  if (url.pathname === '/_stats/reset' && req.method === 'POST') {
    requests.clear()
    arrivals.clear()
    return json(res, { requests: {}, arrivals: {} })
  }
  if (url.pathname === '/_rev' && req.method === 'POST') {
    rev += 1
    return json(res, { rev })
  }
  if (url.pathname === '/_flaky' && req.method === 'POST') {
    flakyDown = url.searchParams.get('down') === '1'
    return json(res, { down: flakyDown })
  }
  const island = /^\/_nf\/island\/([A-Za-z][\w-]*)$/.exec(url.pathname)?.[1]
  const make = island === undefined ? undefined : ISLANDS[island]
  if (island !== undefined && make) {
    const arrived = Date.now()
    const request = await readRequest(req, url)
    const key = `${island}:${String(request.props.id ?? '')}`
    requests.set(key, (requests.get(key) ?? 0) + 1)
    arrivals.set(key, [...(arrivals.get(key) ?? []), arrived])
    const body = make(request)
    if (body === null) {
      res.statusCode = 503
      return res.end()
    }
    if (typeof body === 'object' && body !== null && 'page' in body) {
      res.setHeader('content-type', 'text/html')
      return res.end(String(body.page))
    }
    return json(res, body)
  }
  res.statusCode = 404
  res.end()
}).listen(PORT, '127.0.0.1')
