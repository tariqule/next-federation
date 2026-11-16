import { createServer } from 'node:http'
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
