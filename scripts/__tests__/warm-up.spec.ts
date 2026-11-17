// The e2e warm-up helper (test/e2e/lib/warm-up.ts, installed-dev.spec.ts):
// retries a cold dev page until it renders the content, bounded by a
// deadline. Its unit test runs here because Playwright would pick up any
// *.spec.ts under test/e2e.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { warmUp } from '../../test/e2e/lib/warm-up.ts'

let server: Server | undefined

/** Serves `respond(n)` for the n-th request (from 1); returns the URL. */
async function serve(
  respond: (n: number, cookie: string | undefined) => [number, string]
): Promise<string> {
  let n = 0
  server = createServer((req, res) => {
    const [status, body] = respond(++n, req.headers.cookie)
    res.writeHead(status, { 'content-type': 'text/html' }).end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/orders`
}

afterEach(async () => {
  await new Promise((resolve) => server?.close(resolve) ?? resolve(undefined))
  server = undefined
})

test('retries a cold page until it renders the content', async () => {
  let requests = 0
  const url = await serve((n) => {
    requests = n
    if (n === 1) return [500, 'compiling']
    if (n === 2) return [200, '<p>orders unavailable</p>']
    return [200, '<h2>Orders for warm-up</h2>']
  })
  expect(
    await warmUp(url, { ready: /Orders for warm-up/, intervalMs: 10 })
  ).toBe(true)
  expect(requests).toBe(3)
})

test('sends the given headers', async () => {
  const url = await serve((_, cookie) =>
    cookie === 'nf-user=warm-up'
      ? [200, 'Orders for warm-up']
      : [200, 'orders unavailable']
  )
  expect(
    await warmUp(url, {
      headers: { cookie: 'nf-user=warm-up' },
      ready: /Orders for warm-up/,
      deadlineMs: 500,
      intervalMs: 10,
    })
  ).toBe(true)
})

test('gives up at the deadline and resolves false', async () => {
  const url = await serve(() => [200, 'orders unavailable'])
  const started = Date.now()
  expect(
    await warmUp(url, {
      ready: /Orders for warm-up/,
      deadlineMs: 300,
      intervalMs: 20,
    })
  ).toBe(false)
  expect(Date.now() - started).toBeLessThan(2_000)
})

test('a server that is not answering counts as cold', async () => {
  const url = await serve(() => [200, ''])
  await new Promise((resolve) => server!.close(resolve))
  server = undefined
  expect(
    await warmUp(url, { ready: /x/, deadlineMs: 200, intervalMs: 20 })
  ).toBe(false)
})
