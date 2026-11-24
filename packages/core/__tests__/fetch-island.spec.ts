import { isNFError } from '@next-federation/sdk'
import {
  MAX_ENVELOPE_BYTES,
  eventFor,
  fetchIsland,
  islandFailureDetail,
  islandTags,
} from '../src/index.ts'
import type { IslandResult, IslandTarget } from '../src/index.ts'

const target: IslandTarget = {
  remote: 'shop',
  origin: 'https://shop.example.com',
  allowedOrigins: ['https://shop.example.com', 'https://cdn.example.com'],
  timeoutMs: 3000,
  retries: 1,
}

const envelope = (over: Record<string, unknown> = {}) => ({
  protocolVersion: 1,
  remote: 'shop',
  buildId: 'b1',
  mode: 'production',
  html: '<p>hi</p>',
  rscPayload: '0:"x"',
  css: ['https://shop.example.com/a.css'],
  bootstrap: 'https://shop.example.com/boot.js',
  reactVersion: '19.2.0',
  idPlaceholder: 'nfph0',
  ...over,
})

const json = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
  })

type Fetch = typeof fetch
const asFetch = (fn: unknown): Fetch => fn as Fetch

/** First recorded call of a mock: [url, init]. */
const firstCall = (f: unknown): [string, RequestInit] => {
  const call = (f as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]
  if (!call) throw new Error('fetch was not called')
  return call
}

/** A fetch that never answers on its own; rejects with AbortError when the signal aborts. */
function hanging(): Fetch {
  return asFetch(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))
        )
      })
  )
}

beforeEach(() => {
  rs.useFakeTimers()
})
afterEach(() => {
  rs.useRealTimers()
})

test('returns the envelope on 200', async () => {
  const f = rs.fn(async () => json(envelope()))
  const r = await fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
  expect(r.ok).toBe(true)
  if (r.ok) {
    expect(r.envelope.remote).toBe('shop')
    expect(r.meta.attempts).toBe(1)
    expect(r.meta.bytes).toBe(JSON.stringify(envelope()).length)
  }
  expect(firstCall(f)[0]).toMatch(
    /^https:\/\/shop\.example\.com\/_nf\/island\/Cart\?p=/
  )
})

test('sends no cookies and omits credentials', async () => {
  const f = rs.fn(async () => json(envelope()))
  await fetchIsland(target, { island: 'Cart', token: 't', fetch: asFetch(f) })
  const init = firstCall(f)[1]
  expect(init.credentials).toBe('omit')
  const headers = Object.keys(init.headers as Record<string, string>).map((h) =>
    h.toLowerCase()
  )
  expect(headers).not.toContain('cookie')
  expect(headers).toContain('authorization')
})

test('init cannot override credentials', async () => {
  const f = rs.fn(async () => json(envelope()))
  await fetchIsland(target, {
    island: 'Cart',
    fetch: asFetch(f),
    init: { credentials: 'include' },
  })
  expect(firstCall(f)[1].credentials).toBe('omit')
})

test('POSTs large props with a body', async () => {
  const f = rs.fn(async () => json(envelope()))
  await fetchIsland(target, {
    island: 'Cart',
    props: { big: 'x'.repeat(5000) },
    fetch: asFetch(f),
  })
  const init = firstCall(f)[1]
  expect(init.method).toBe('POST')
  expect(typeof init.body).toBe('string')
})

test('retries once on 503 then succeeds', async () => {
  const f = rs
    .fn()
    .mockResolvedValueOnce(json('', 503))
    .mockResolvedValueOnce(json(envelope()))
  const p = fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
  await rs.advanceTimersByTimeAsync(100)
  const r = await p
  expect(r.ok).toBe(true)
  expect(r.meta.attempts).toBe(2)
  expect(f).toHaveBeenCalledTimes(2)
})

test('retries once on a network TypeError', async () => {
  const f = rs
    .fn()
    .mockRejectedValueOnce(new TypeError('fetch failed'))
    .mockResolvedValueOnce(json(envelope()))
  const p = fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
  await rs.advanceTimersByTimeAsync(100)
  const r = await p
  expect(r.ok).toBe(true)
  expect(r.meta.attempts).toBe(2)
})

test('gives up after retries are exhausted with NF-007', async () => {
  const f = rs.fn(async () => json('', 503))
  const p = fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
  await rs.advanceTimersByTimeAsync(100)
  const r = await p
  expect(r).toMatchObject({ ok: false, code: 'NF-007', status: 503 })
  expect(r.meta.attempts).toBe(2)
})

test('does not retry 404; returns NF-007 with status 404', async () => {
  const f = rs.fn(async () => json('', 404))
  const r = await fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
  expect(r).toMatchObject({ ok: false, code: 'NF-007', status: 404 })
  expect(f).toHaveBeenCalledTimes(1)
})

test('a remote slower than the budget returns NF-008 at ~3000 ms and is not retried', async () => {
  const f = rs.fn(hanging())
  const p = fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
  await rs.advanceTimersByTimeAsync(2999)
  let settled = false
  void p.then(() => (settled = true))
  await rs.advanceTimersByTimeAsync(0)
  expect(settled).toBe(false)
  await rs.advanceTimersByTimeAsync(1)
  const r = await p
  expect(r).toMatchObject({ ok: false, code: 'NF-008' })
  expect(r.meta.ms).toBeGreaterThanOrEqual(3000)
  expect(f).toHaveBeenCalledTimes(1)
})

test('budget is shared across attempts', async () => {
  const f = rs.fn(async () => {
    await new Promise((res) => setTimeout(res, 2900))
    return json('', 503)
  })
  const p = fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
  await rs.advanceTimersByTimeAsync(3500)
  const r = await p
  expect(f).toHaveBeenCalledTimes(1)
  expect(r).toMatchObject({ ok: false, code: 'NF-007', status: 503 })
  expect(r.meta.attempts).toBe(1)
})

test('the second attempt only gets the remaining budget', async () => {
  const f = rs
    .fn()
    .mockImplementationOnce(async () => {
      await new Promise((res) => setTimeout(res, 1000))
      return json('', 503)
    })
    .mockImplementationOnce(hanging())
  const p = fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
  await rs.advanceTimersByTimeAsync(1000 + 100 + 1899)
  let settled = false
  void p.then(() => (settled = true))
  await rs.advanceTimersByTimeAsync(0)
  expect(settled).toBe(false)
  await rs.advanceTimersByTimeAsync(1)
  expect(await p).toMatchObject({ ok: false, code: 'NF-008' })
})

test('invalid JSON body is NF-004', async () => {
  const f = rs.fn(async () => json('not json'))
  const r = await fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
  expect(r).toMatchObject({ ok: false, code: 'NF-004' })
})

test('protocolVersion 2 is NF-003', async () => {
  const f = rs.fn(async () => json(envelope({ protocolVersion: 2 })))
  const r = await fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
  expect(r).toMatchObject({ ok: false, code: 'NF-003' })
})

test('bootstrap on a foreign origin is NF-005', async () => {
  const f = rs.fn(async () =>
    json(envelope({ bootstrap: 'https://evil.example.net/boot.js' }))
  )
  const r = await fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
  expect(r).toMatchObject({ ok: false, code: 'NF-005' })
})

test('css on a foreign origin is NF-005', async () => {
  const f = rs.fn(async () =>
    json(envelope({ css: ['https://evil.example.net/a.css'] }))
  )
  const r = await fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
  expect(r).toMatchObject({ ok: false, code: 'NF-005' })
})

test('css on a configured assetOrigin is accepted', async () => {
  const f = rs.fn(async () =>
    json(envelope({ css: ['https://cdn.example.com/a.css'] }))
  )
  const r = await fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
  expect(r.ok).toBe(true)
})

test('envelope.remote that differs from the target is NF-004', async () => {
  const f = rs.fn(async () => json(envelope({ remote: 'other' })))
  const r = await fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
  expect(r).toMatchObject({ ok: false, code: 'NF-004' })
})

test('passes init.next through to fetch untouched', async () => {
  const f = rs.fn(async () => json(envelope()))
  const next = { revalidate: 60, tags: ['nf:shop'] }
  await fetchIsland(target, {
    island: 'Cart',
    fetch: asFetch(f),
    init: { next },
  })
  expect((firstCall(f)[1] as { next?: unknown }).next).toBe(next)
})

test('a non-network error thrown by fetch is rethrown', async () => {
  const control = Object.assign(new Error('NEXT_PRERENDER_INTERRUPTED'), {
    digest: 'NEXT_PRERENDER_INTERRUPTED',
  })
  const f = rs.fn(async () => {
    throw control
  })
  await expect(
    fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
  ).rejects.toBe(control)
})

test('caller mistakes throw: bad island name NF-002, bad props NF-009', async () => {
  const f = rs.fn(async () => json(envelope()))
  const a = await fetchIsland(target, {
    island: 'bad name',
    fetch: asFetch(f),
  }).catch((e: unknown) => e)
  expect(isNFError(a, 'NF-002')).toBe(true)
  const b = await fetchIsland(target, {
    island: 'Cart',
    props: { fn: () => 1 },
    fetch: asFetch(f),
  }).catch((e: unknown) => e)
  expect(isNFError(b, 'NF-009')).toBe(true)
  expect(f).not.toHaveBeenCalled()
})

test('eventFor maps ok to island:fetch and failure to island:error', () => {
  const okResult = {
    ok: true,
    envelope: envelope(),
    meta: { ms: 12, bytes: 99, attempts: 1 },
  } as unknown as IslandResult
  expect(eventFor(target, 'Cart', okResult)).toEqual({
    type: 'island:fetch',
    remote: 'shop',
    island: 'Cart',
    ms: 12,
    bytes: 99,
    attempts: 1,
  })
  const bad: IslandResult = {
    ok: false,
    code: 'NF-007',
    status: 404,
    meta: { ms: 5, bytes: 0, attempts: 1 },
  }
  expect(eventFor(target, 'Cart', bad)).toEqual({
    type: 'island:error',
    remote: 'shop',
    island: 'Cart',
    ms: 5,
    attempts: 1,
    code: 'NF-007',
    status: 404,
  })
})

test('islandTags returns remote and island tags', () => {
  expect(islandTags('shop')).toEqual(['nf:shop'])
  expect(islandTags('shop', 'Cart')).toEqual(['nf:shop', 'nf:shop:Cart'])
})

test('forces redirect: error', async () => {
  const f = rs.fn(async () => json(envelope()))
  await fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
  expect(firstCall(f)[1].redirect).toBe('error')
})

test('init cannot override redirect', async () => {
  const f = rs.fn(async () => json(envelope()))
  await fetchIsland(target, {
    island: 'Cart',
    fetch: asFetch(f),
    init: { redirect: 'follow' },
  })
  expect(firstCall(f)[1].redirect).toBe('error')
})

test('a redirect failure is NF-007 and is not retried', async () => {
  const f = rs.fn(async () => {
    throw new TypeError('fetch failed', {
      cause: new Error('unexpected redirect'),
    })
  })
  const r = await fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
  expect(r).toMatchObject({ ok: false, code: 'NF-007' })
  expect(r.meta.attempts).toBe(1)
  expect(f).toHaveBeenCalledTimes(1)
})

test('a browser-style redirect TypeError is also not retried', async () => {
  const f = rs.fn(async () => {
    throw new TypeError('Failed to fetch: redirect mode is set to error')
  })
  const r = await fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
  expect(r).toMatchObject({ ok: false, code: 'NF-007' })
  expect(f).toHaveBeenCalledTimes(1)
})

test('the token never leaks into results or events; cookie headers are dropped', async () => {
  const f = rs.fn(async () => json('boom', 404))
  const r = await fetchIsland(target, {
    island: 'Cart',
    token: 'SECRET',
    fetch: asFetch(f),
    init: { headers: { cookie: 'sid=abc' } },
  })
  expect(r.ok).toBe(false)
  expect(JSON.stringify(r)).not.toContain('SECRET')
  expect(JSON.stringify(eventFor(target, 'Cart', r))).not.toContain('SECRET')
  const headers = firstCall(f)[1].headers as Record<string, string>
  expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain(
    'cookie'
  )
  expect(JSON.stringify(headers)).not.toContain('sid=abc')
})

describe('envelope size limit', () => {
  /** A body that never ends: `chunk` spaces per pull, each after `delayMs`. */
  function drip(chunk: number, delayMs: number, signal?: AbortSignal | null) {
    const seen = { pulls: 0, cancelled: false }
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        seen.pulls++
        await new Promise((r) => setTimeout(r, delayMs))
        if (signal?.aborted) {
          // What undici does to a body whose request was aborted.
          controller.error(new DOMException('aborted', 'AbortError'))
          return
        }
        controller.enqueue(new Uint8Array(chunk).fill(32))
      },
      cancel() {
        seen.cancelled = true
      },
    })
    return { body, seen }
  }

  test('MAX_ENVELOPE_BYTES is 5 MiB', () => {
    expect(MAX_ENVELOPE_BYTES).toBe(5 * 1024 * 1024)
  })

  test('a slow drip past maxBytes is NF-007, cancelled and not retried', async () => {
    const { body, seen } = drip(16, 10)
    const f = rs.fn(async () => new Response(body))
    const p = fetchIsland(
      { ...target, maxBytes: 64 },
      { island: 'Cart', fetch: asFetch(f) }
    )
    await rs.advanceTimersByTimeAsync(200)
    const r = await p
    expect(r).toMatchObject({ ok: false, code: 'NF-007' })
    expect(r).not.toHaveProperty('status')
    expect(r.meta.ms).toBeLessThan(200)
    expect(seen.cancelled).toBe(true)
    expect(seen.pulls).toBeLessThanOrEqual(6)
    expect(f).toHaveBeenCalledTimes(1)
  })

  test('a declared content-length over maxBytes is refused without reading the body', async () => {
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        controller.enqueue(new Uint8Array(16))
      },
    })
    const f = rs.fn(
      async () => new Response(body, { headers: { 'content-length': '65' } })
    )
    const r = await fetchIsland(
      { ...target, maxBytes: 64 },
      { island: 'Cart', fetch: asFetch(f) }
    )
    expect(r).toMatchObject({ ok: false, code: 'NF-007' })
    expect(pulls).toBeLessThanOrEqual(1)
    expect(f).toHaveBeenCalledTimes(1)
  })

  test('passing maxBytes aborts the request itself, not only the body read', async () => {
    rs.useRealTimers()
    // A wrapped fetch (Next's patched fetch reads its own copy of the
    // body): cancelling the body handed to us does not stop the request,
    // so the request's signal must be aborted at the limit.
    const signals: AbortSignal[] = []
    const f = rs.fn(async (_url: string, init: RequestInit) => {
      signals.push(init.signal!)
      return signals.length === 1
        ? new Response(new Uint8Array(128).fill(32))
        : new Response('x', { headers: { 'content-length': '65' } })
    })
    for (let i = 0; i < 2; i++) {
      const r = await fetchIsland(
        { ...target, maxBytes: 64 },
        { island: 'Cart', fetch: asFetch(f) }
      )
      expect(r).toMatchObject({ ok: false, code: 'NF-007' })
    }
    expect(signals.map((s) => s.aborted)).toEqual([true, true])
  })

  test('a body within maxBytes never aborts its request, and a retry gets its own signal', async () => {
    rs.useRealTimers()
    const text = JSON.stringify(envelope({ html: '<p>é</p>' }))
    const signals: AbortSignal[] = []
    const f = rs.fn(async (_url: string, init: RequestInit) => {
      signals.push(init.signal!)
      return signals.length === 1
        ? new Response('busy', { status: 503 })
        : new Response(text)
    })
    const r = await fetchIsland(
      { ...target, retries: 1, maxBytes: 1024 },
      // POST: props above the GET limit.
      { island: 'Cart', props: { pad: 'x'.repeat(3000) }, fetch: asFetch(f) }
    )
    expect(r.ok).toBe(true)
    expect(f.mock.calls[0]![1].method).toBe('POST')
    expect(signals).toHaveLength(2)
    expect(signals[0]).not.toBe(signals[1])
    // After the fetch settled, and after the timeout would have fired.
    await new Promise((resolve) => setTimeout(resolve, target.timeoutMs + 50))
    expect(signals.map((s) => s.aborted)).toEqual([false, false])
  })

  test('without maxBytes the 5 MiB default applies', async () => {
    rs.useRealTimers()
    const over = new Uint8Array(MAX_ENVELOPE_BYTES + 1).fill(32)
    const f = rs.fn(async () => new Response(over))
    const r = await fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
    expect(r).toMatchObject({ ok: false, code: 'NF-007' })
  })

  test('an envelope at maxBytes is accepted and meta.bytes counts bytes', async () => {
    const text = JSON.stringify(envelope({ html: '<p>é</p>' }))
    const size = new TextEncoder().encode(text).byteLength
    const f = rs.fn(async () => new Response(text))
    const r = await fetchIsland(
      { ...target, maxBytes: size },
      { island: 'Cart', fetch: asFetch(f) }
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.envelope.html).toBe('<p>é</p>')
      expect(r.meta.bytes).toBe(size)
    }
  })

  test('a slow drip under the limit still times out with NF-008', async () => {
    let seen: { cancelled: boolean } | undefined
    const f = rs.fn(async (_url: string, init: RequestInit) => {
      const d = drip(1, 100, init.signal)
      seen = d.seen
      return new Response(d.body)
    })
    const p = fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
    await rs.advanceTimersByTimeAsync(3200)
    const r = await p
    expect(r).toMatchObject({ ok: false, code: 'NF-008' })
    expect(seen).toBeDefined()
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('B5: a failure names its URL, and hints when the origin is no island remote', () => {
  const html = (status: number) =>
    new Response('<!doctype html><title>404</title>', {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })

  test('a 404 HTML page: the URL without its query, and the hint', async () => {
    const f = rs.fn(async () => html(404))
    const r = await fetchIsland(target, {
      island: 'Cart',
      props: { secret: 'p-value' },
      token: 'SECRET',
      fetch: asFetch(f),
    })
    expect(r).toMatchObject({
      ok: false,
      code: 'NF-007',
      status: 404,
      url: 'https://shop.example.com/_nf/island/Cart',
      hint: 'not-an-island-remote',
    })
    const detail = islandFailureDetail(r)
    expect(detail).toContain('https://shop.example.com/_nf/island/Cart')
    expect(detail).toContain('HTTP 404')
    expect(detail).toMatch(/answered HTML \/ 404: is it an island remote/)
    expect(detail).toContain('/_nf/island')
    expect(detail).toContain('remote-components/sharing-from-a-next-app.mdx')
    for (const leak of ['SECRET', 'p-value', '?p=']) {
      expect(JSON.stringify(r)).not.toContain(leak)
      expect(detail).not.toContain(leak)
    }
  })

  test("a plain 404 hints; an island remote's JSON 404 and a 503 do not", async () => {
    const text404 = await fetchIsland(target, {
      island: 'Cart',
      fetch: asFetch(
        rs.fn(
          async () =>
            new Response('Not Found', {
              status: 404,
              headers: { 'content-type': 'text/plain' },
            })
        )
      ),
    })
    expect(text404).toMatchObject({ hint: 'not-an-island-remote' })
    // An island remote that does not expose this island (NF-021).
    const r404 = await fetchIsland(target, {
      island: 'Cart',
      fetch: asFetch(
        rs.fn(
          async () =>
            new Response(JSON.stringify({ error: 'NF-021' }), {
              status: 404,
              headers: { 'content-type': 'application/json' },
            })
        )
      ),
    })
    expect(r404).toMatchObject({ code: 'NF-007', status: 404 })
    expect(r404).not.toHaveProperty('hint')
    const f = rs.fn(async () => json('', 503))
    const p = fetchIsland(target, { island: 'Cart', fetch: asFetch(f) })
    await rs.advanceTimersByTimeAsync(100)
    const r503 = await p
    expect(r503).toMatchObject({
      ok: false,
      code: 'NF-007',
      url: 'https://shop.example.com/_nf/island/Cart',
    })
    expect(r503).not.toHaveProperty('hint')
    expect(islandFailureDetail(r503)).toBe(
      'at https://shop.example.com/_nf/island/Cart (HTTP 503)'
    )
  })

  test('an HTML 200 (a catch-all page) is NF-004 with the hint', async () => {
    const r = await fetchIsland(target, {
      island: 'Cart',
      fetch: asFetch(rs.fn(async () => html(200))),
    })
    expect(r).toMatchObject({
      ok: false,
      code: 'NF-004',
      hint: 'not-an-island-remote',
    })
  })

  test('a timeout (NF-008) and a network error name the URL', async () => {
    const p = fetchIsland(target, { island: 'Cart', fetch: hanging() })
    await rs.advanceTimersByTimeAsync(3000)
    const timedOut = await p
    expect(timedOut).toMatchObject({
      code: 'NF-008',
      url: 'https://shop.example.com/_nf/island/Cart',
    })
    expect(islandFailureDetail(timedOut)).toBe(
      'at https://shop.example.com/_nf/island/Cart'
    )
  })
})
