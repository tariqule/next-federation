import type { IncomingMessage, RequestListener } from 'node:http'

type WebHandler = (req: Request) => Promise<Response>

/**
 * The request body as a Web stream that reads `req` only when the handler reads
 * it. `drain()` stops that and discards whatever is left, as Node does for a body
 * no one reads: a handler may answer before the end of an upload (a 413 on the
 * declared length, a cancelled read), and the rest of that upload must not stay
 * on a keep-alive connection, where the next request on it would never be parsed.
 */
function requestBody(req: IncomingMessage): {
  stream: ReadableStream<Uint8Array>
  drain: () => void
} {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let state: 'idle' | 'reading' | 'done' = 'idle'
  const onData = (chunk: Buffer) => {
    controller.enqueue(new Uint8Array(chunk))
    if ((controller.desiredSize ?? 0) <= 0) req.pause()
  }
  const onEnd = () => {
    if (state !== 'reading') return
    detach()
    controller.close()
  }
  const onClose = () => {
    if (state !== 'reading') return
    detach()
    controller.error(new Error('The request was aborted.'))
  }
  const onError = (error: Error) => {
    if (state !== 'reading') return
    detach()
    controller.error(error)
  }
  const detach = () => {
    state = 'done'
    req.off('data', onData)
    req.off('end', onEnd)
    req.off('close', onClose)
    req.off('error', onError)
  }
  const drain = () => {
    if (state === 'reading') detach()
    state = 'done'
    // Flowing with no 'data' listener: the rest is read and dropped.
    req.resume()
  }
  const stream = new ReadableStream<Uint8Array>(
    {
      start(c) {
        controller = c
      },
      pull() {
        if (state === 'idle') {
          state = 'reading'
          req.on('end', onEnd)
          req.on('close', onClose)
          req.on('error', onError)
          req.on('data', onData)
        } else if (state === 'reading') {
          req.resume()
        }
      },
      cancel: drain,
    },
    // Pulled only when the handler reads: nothing is read ahead of it.
    new CountQueuingStrategy({ highWaterMark: 0 })
  )
  return { stream, drain }
}

function toRequest(
  req: IncomingMessage,
  signal: AbortSignal,
  body: ReadableStream<Uint8Array> | null
): Request {
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
  return new Request(url, {
    method: req.method,
    headers,
    signal,
    ...(body ? { body, duplex: 'half' } : {}),
  } as RequestInit)
}

/** Adapts a Web `Request -> Response` handler to a Node `http` listener. */
export function toNodeListener(handler: WebHandler): RequestListener {
  return (req, res) => {
    const abort = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) abort.abort()
    })
    const body =
      req.method !== 'GET' && req.method !== 'HEAD' ? requestBody(req) : null
    if (body) res.on('finish', body.drain)
    void (async () => {
      let response: Response
      try {
        response = await handler(
          toRequest(req, abort.signal, body?.stream ?? null)
        )
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
