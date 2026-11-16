import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Dev server CORS for module assets (the bootstrap, island client modules,
 * CSS) that hosts load cross-origin. `/_nf/` requests pass through untouched
 * so the island handler's own CORS is what dev exercises, as in production.
 */
export function devCorsMiddleware(
  hosts: readonly string[],
  /** Path of the dev base, e.g. '/' or '/remote/'; always ends with '/'. */
  basePath = '/'
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  // Paths the island handler answers itself, CORS included: `/_nf/` at the
  // start of the request path (or right after the base path).
  const prefixes = [...new Set(['/_nf/', `${basePath}_nf/`])]
  return (req, res, next) => {
    const path = (req.url ?? '/').split('?')[0]!
    if (prefixes.some((prefix) => path.startsWith(prefix))) return next()
    res.setHeader('vary', 'Origin')
    const origin = req.headers.origin
    if (typeof origin === 'string' && hosts.includes(origin)) {
      res.setHeader('access-control-allow-origin', origin)
      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.setHeader('access-control-allow-methods', 'GET, HEAD')
        const requested = req.headers['access-control-request-headers']
        if (typeof requested === 'string') {
          res.setHeader('access-control-allow-headers', requested)
        }
        res.end()
        return
      }
    }
    next()
  }
}
