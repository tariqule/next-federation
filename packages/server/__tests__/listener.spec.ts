import { Agent, createServer, request } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { toNodeListener } from '../src/node/listener.ts'

const servers: Server[] = []
async function start(handler: (req: Request) => Promise<Response>) {
  const server = createServer(toNodeListener(handler))
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((r) => {
          s.close(() => r())
          s.closeAllConnections()
        })
    )
  )
})

test('round-trips method, headers, body and status through a real http server', async () => {
  const base = await start(async (req) => {
    const body = await req.text()
    const headers = new Headers({ 'x-seen-method': req.method })
    headers.append('set-cookie', 'a=1')
    headers.append('set-cookie', 'b=2')
    return new Response(
      JSON.stringify({
        body,
        path: new URL(req.url).pathname + new URL(req.url).search,
        custom: req.headers.get('x-custom'),
      }),
      { status: 201, headers }
    )
  })
  const res = await fetch(`${base}/p?q=1`, {
    method: 'POST',
    headers: { 'x-custom': 'yes' },
    body: 'hello',
  })
  expect(res.status).toBe(201)
  expect(res.headers.get('x-seen-method')).toBe('POST')
  expect(res.headers.getSetCookie()).toEqual(['a=1', 'b=2'])
  expect(await res.json()).toEqual({
    body: 'hello',
    path: '/p?q=1',
    custom: 'yes',
  })
})

test('a handler that throws yields 500, not a crashed process', async () => {
  let calls = 0
  const base = await start(async () => {
    if (++calls === 1) throw new Error('boom')
    return new Response('fine')
  })
  expect((await fetch(base)).status).toBe(500)
  expect(await (await fetch(base)).text()).toBe('fine')
})

// One keep-alive socket, like nf-serve's proxy agent: a request that hangs on
// it fails the test after `deadlineMs` instead of the test timeout.
function send(
  agent: Agent,
  url: string,
  method: string,
  body?: string,
  deadlineMs = 3000
): Promise<{ status: number; body: string; socket: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { agent, method }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (c: string) => (text += c))
      res.on('end', () => {
        clearTimeout(timer)
        const { localPort } = res.socket ?? req.socket ?? {}
        resolve({
          status: res.statusCode ?? 0,
          body: text,
          socket: String(localPort),
        })
      })
    })
    const timer = setTimeout(() => {
      req.destroy()
      reject(new Error(`${method} ${url}: no response within ${deadlineMs} ms`))
    }, deadlineMs)
    req.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    req.end(body)
  })
}

// A handler that answers before reading the whole body (a 413 on the declared
// length, a 404) must not leave the rest of that body on a keep-alive
// connection: the next request on it would never be parsed.
test.each([
  ['refused on its declared length, never read', 300_000],
  ['refused on its declared length, never read (2 MiB)', 2 * 1024 * 1024],
  ['read in part, then cancelled', 300_000],
])(
  'a body the handler does not read to the end leaves the connection usable: %s',
  async (mode, size) => {
    const base = await start(async (req) => {
      if (req.method === 'GET') return new Response('next')
      if (mode.startsWith('read in part')) {
        const reader = req.body!.getReader()
        await reader.read()
        await reader.cancel()
      }
      return new Response(null, { status: 413 })
    })
    const agent = new Agent({ keepAlive: true, maxSockets: 1 })
    try {
      const big = await send(agent, `${base}/big`, 'POST', 'x'.repeat(size))
      expect(big.status).toBe(413)
      const next = await send(agent, `${base}/next`, 'GET')
      expect(next).toEqual({ status: 200, body: 'next', socket: big.socket })
    } finally {
      agent.destroy()
    }
  }
)
