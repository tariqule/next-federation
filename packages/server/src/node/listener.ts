import { Readable } from 'node:stream'
import type { IncomingMessage, RequestListener } from 'node:http'

type WebHandler = (req: Request) => Promise<Response>

function toRequest(req: IncomingMessage, signal: AbortSignal): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (name.startsWith(':') || value === undefined) continue
    if (Array.isArray(value)) for (const v of value) headers.append(name, v)
    else headers.set(name, value)
  }
  const url = new URL(
    req.url ?? '/',
    `http://${req.headers.host ?? 'localhost'}`
  )
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  return new Request(url, {
    method: req.method,
    headers,
    signal,
    ...(hasBody
      ? {
          body: Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>,
          duplex: 'half',
        }
      : {}),
  } as RequestInit)
}

/** Adapts a Web `Request -> Response` handler to a Node `http` listener. */
export function toNodeListener(handler: WebHandler): RequestListener {
  return (req, res) => {
    const abort = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) abort.abort()
    })
    void (async () => {
      let response: Response
      try {
        response = await handler(toRequest(req, abort.signal))
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'text/plain' })
        }
        res.end(res.headersSent ? undefined : 'Internal Server Error')
        return
      }
      const headers: Record<string, string | string[]> = {}
      response.headers.forEach((value, name) => {
        if (name !== 'set-cookie') headers[name] = value
      })
      const cookies = response.headers.getSetCookie()
      if (cookies.length > 0) headers['set-cookie'] = cookies
      res.writeHead(response.status, headers)
      if (!response.body || req.method === 'HEAD') {
        res.end()
        return
      }
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          if (!res.write(chunk)) {
            await new Promise<void>((resolve) => {
              const done = () => {
                res.off('drain', done)
                res.off('close', done)
                resolve()
              }
              res.on('drain', done)
              res.on('close', done)
            })
          }
          if (res.destroyed) break
        }
      } catch {
        res.destroy()
        return
      }
      res.end()
    })()
  }
}
