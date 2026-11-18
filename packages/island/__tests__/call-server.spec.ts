import { isNFError } from '@next-federation/sdk'
import type { ActionReport } from '@next-federation/protocol'
import { createCallServer } from '../src/bootstrap/call-server.ts'
import type { CallServerOptions } from '../src/bootstrap/call-server.ts'

type Sent = { url: string; init: RequestInit }

let sent: Sent[] = []
let replies: Array<() => Response> = []
const realFetch = globalThis.fetch

beforeEach(() => {
  sent = []
  replies = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, init })
    const next = replies.shift()
    if (!next) throw new Error('no reply queued')
    return next()
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

const flight = (value: unknown) => () =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'text/x-component;charset=utf-8' },
  })
const failure = (status: number, code?: string) => () =>
  code
    ? new Response(JSON.stringify({ error: code }), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    : new Response(null, { status })

// A JSON stand-in for the Flight client: `{ returnValue }` or `{ reject }`.
const createFromReadableStream = rs.fn(
  async (stream: ReadableStream<Uint8Array>) => {
    const parsed = JSON.parse(await new Response(stream).text())
    return 'reject' in parsed
      ? { returnValue: Promise.reject(new Error(parsed.reject)) }
      : parsed
  }
) as unknown as CallServerOptions['createFromReadableStream']

const encodeReply = rs.fn(async (args: unknown[]) => JSON.stringify(args))

function make(over: Partial<CallServerOptions> = {}) {
  const reports: ActionReport[] = []
  const callServer = createCallServer({
    url: 'https://r.example/b/v1/',
    encodeReply,
    createFromReadableStream,
    onAction: (r) => reports.push(r),
    ...over,
  })
  return { callServer, reports }
}

const header = (s: Sent, name: string) => new Headers(s.init.headers).get(name)

test('posts to the build-pinned action URL with the id, omitting credentials', async () => {
  replies.push(flight({ returnValue: 5 }))
  const { callServer, reports } = make({ island: 'Cart' })
  await expect(callServer('src/a.ts#add', [2, 3])).resolves.toBe(5)
  expect(sent).toHaveLength(1)
  expect(sent[0]!.url).toBe('https://r.example/b/v1/_nf/action?island=Cart')
  expect(sent[0]!.init.method).toBe('POST')
  expect(sent[0]!.init.credentials).toBe('omit')
  expect(header(sent[0]!, 'x-nf-action')).toBe('src/a.ts#add')
  expect(header(sent[0]!, 'authorization')).toBeNull()
  expect(sent[0]!.init.body).toBe('[2,3]')
  expect(reports).toEqual([
    { ok: true, status: 200, ms: expect.any(Number), retried: false },
  ])
})

test('each mount gets its own URL', async () => {
  replies.push(flight({ returnValue: 1 }), flight({ returnValue: 2 }))
  const a = make({ url: 'https://a.example/b/v1/' }).callServer
  const b = make({ url: 'https://b.example/b/v9', island: 'X' }).callServer
  await a('f.ts#x', [])
  await b('f.ts#x', [])
  expect(sent.map((s) => s.url)).toEqual([
    'https://a.example/b/v1/_nf/action',
    'https://b.example/b/v9/_nf/action?island=X',
  ])
})

test('sends the bearer token when there is one', async () => {
  replies.push(flight({ returnValue: 'ok' }))
  const { callServer } = make({ getToken: async () => 't1' })
  await callServer('f.ts#x', [])
  expect(header(sent[0]!, 'authorization')).toBe('Bearer t1')
})

test('a 401 NF-014 with a token invalidates, refetches and resends once, encoding once', async () => {
  encodeReply.mockClear()
  replies.push(failure(401, 'NF-014'), flight({ returnValue: 'second' }))
  const tokens = ['old', 'new']
  const invalidateToken = rs.fn()
  const { callServer, reports } = make({
    getToken: async () => tokens.shift() ?? null,
    invalidateToken,
  })
  await expect(callServer('f.ts#x', ['a'])).resolves.toBe('second')
  expect(invalidateToken).toHaveBeenCalledTimes(1)
  expect(invalidateToken).toHaveBeenCalledWith('old')
  expect(sent.map((s) => header(s, 'authorization'))).toEqual([
    'Bearer old',
    'Bearer new',
  ])
  expect(sent[1]!.init.body).toBe(sent[0]!.init.body)
  expect(encodeReply).toHaveBeenCalledTimes(1)
  expect(reports).toEqual([
    { ok: true, status: 200, ms: expect.any(Number), retried: true },
  ])
})

test('a retry that is rejected again is not retried a second time', async () => {
  replies.push(failure(401, 'NF-014'), failure(401, 'NF-014'))
  let n = 0
  const { callServer, reports } = make({
    getToken: async () => `t${n++}`,
    invalidateToken: () => {},
  })
  const error = await callServer('f.ts#x', []).catch((e: unknown) => e)
  expect(isNFError(error, 'NF-014')).toBe(true)
  expect(sent).toHaveLength(2)
  expect(reports).toEqual([
    {
      ok: false,
      status: 401,
      code: 'NF-014',
      ms: expect.any(Number),
      retried: true,
    },
  ])
})

type GetToken = () => Promise<string | null>
const noRetry: [
  string,
  GetToken,
  'NF-014' | 'NF-015' | 'NF-016' | undefined,
  number,
][] = [
  ['no token was sent', async () => null, 'NF-014', 401],
  ['the refreshed token is the same', async () => 'same', 'NF-014', 401],
  ['the code is NF-016', async () => 't', 'NF-016', 401],
  ['the code is NF-015', async () => 't', 'NF-015', 503],
  ['it is a 5xx', async () => 't', undefined, 500],
]
test.each(noRetry)('no retry when %s', async (_n, getToken, code, status) => {
  replies.push(failure(status, code))
  const invalidateToken = rs.fn()
  const { callServer } = make({ getToken, invalidateToken })
  const error = await callServer('f.ts#x', []).catch((e: unknown) => e)
  expect(sent).toHaveLength(1)
  expect(isNFError(error, code ?? 'NF-038')).toBe(true)
  if (code !== 'NF-014') expect(invalidateToken).not.toHaveBeenCalled()
})

test('a refreshed null token is not retried', async () => {
  replies.push(failure(401, 'NF-014'))
  const tokens = ['old', null]
  const { callServer } = make({
    getToken: async () => tokens.shift() ?? null,
    invalidateToken: () => {},
  })
  await expect(callServer('f.ts#x', [])).rejects.toMatchObject({
    code: 'NF-014',
  })
  expect(sent).toHaveLength(1)
})

test('non-200 or non-Flight responses reject with their code, else one that fits the status', async () => {
  replies.push(
    failure(404, 'NF-031'),
    failure(404),
    failure(413),
    failure(500),
    failure(502),
    failure(503),
    () =>
      new Response('<html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    failure(400, 'not-a-code')
  )
  const { callServer, reports } = make()
  const expected: [string, RegExp][] = [
    ['NF-031', /status 404/],
    ['NF-031', /status 404/],
    ['NF-032', /larger than the remote accepts \(413\)/],
    ['NF-038', /server or network failure \(status 500\)/],
    ['NF-038', /server or network failure \(status 502\)/],
    ['NF-038', /server or network failure \(status 503\)/],
    ['NF-038', /not a Server Action response \(status 200\)/],
    ['NF-038', /not a Server Action response \(status 400\)/],
  ]
  for (const [code, message] of expected) {
    const error = await callServer('f.ts#x', []).catch((e: unknown) => e)
    expect(isNFError(error, code as 'NF-031')).toBe(true)
    expect((error as Error).message).toMatch(message)
  }
  expect(reports.map((r) => [r.ok, r.status, r.code])).toEqual([
    [false, 404, 'NF-031'],
    [false, 404, undefined],
    [false, 413, undefined],
    [false, 500, undefined],
    [false, 502, undefined],
    [false, 503, undefined],
    [false, 200, undefined],
    [false, 400, undefined],
  ])
})

test('a rejected returnValue rejects the call and reports ok: false with status 200', async () => {
  replies.push(flight({ reject: 'nope' }))
  const { callServer, reports } = make()
  await expect(callServer('f.ts#x', [])).rejects.toThrow('nope')
  expect(reports).toEqual([
    {
      ok: false,
      status: 200,
      code: 'NF-033',
      ms: expect.any(Number),
      retried: false,
    },
  ])
})

test('a network failure rejects and reports status 0', async () => {
  replies.push(() => {
    throw new TypeError('Failed to fetch')
  })
  const { callServer, reports } = make()
  await expect(callServer('f.ts#x', [])).rejects.toThrow('Failed to fetch')
  expect(reports[0]).toMatchObject({ ok: false, status: 0, retried: false })
})

test('reports never carry arguments, results or tokens', async () => {
  replies.push(flight({ returnValue: 'secret-result' }))
  const { callServer, reports } = make({ getToken: async () => 'secret-token' })
  await callServer('f.ts#x', ['secret-arg'])
  const text = JSON.stringify(reports)
  expect(text).not.toContain('secret')
  expect(Object.keys(reports[0]!).sort()).toEqual([
    'ms',
    'ok',
    'retried',
    'status',
  ])
})

test('the Flight client gets the same callServer for nested references', async () => {
  replies.push(flight({ returnValue: 1 }))
  const { callServer } = make()
  await callServer('f.ts#x', [])
  const calls = (
    createFromReadableStream as unknown as {
      mock: { calls: [unknown, { callServer: unknown }][] }
    }
  ).mock.calls
  expect(calls.at(-1)![1].callServer).toBe(callServer)
})

test('redirects are refused, never followed', async () => {
  replies.push(flight({ returnValue: 1 }))
  const { callServer } = make()
  await callServer('f.ts#x', [])
  expect(sent[0]!.init.redirect).toBe('error')
})

describe('timeoutMs: the remote must start answering in time (NF-038)', () => {
  // A fetch that answers only when its signal aborts (a hung remote).
  const hang = () => {
    globalThis.fetch = ((url: string, init: RequestInit) => {
      sent.push({ url, init })
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(init.signal!.reason)
        )
      })
    }) as typeof fetch
  }

  test('a remote that does not answer within timeoutMs rejects with NF-038 and is aborted', async () => {
    hang()
    const { callServer, reports } = make({ timeoutMs: 30 })
    const error = (await callServer('src/a.ts#slow', []).catch(
      (e: unknown) => e
    )) as Error & { code?: string }
    expect(isNFError(error)).toBe(true)
    expect(error.code).toBe('NF-038')
    expect(error.message).toContain('did not answer within 30 ms')
    expect(sent[0]!.init.signal?.aborted).toBe(true)
    expect(reports).toEqual([
      {
        ok: false,
        status: 0,
        code: 'NF-038',
        ms: expect.any(Number),
        retried: false,
      },
    ])
  })

  test('one deadline covers the 401 token refresh and the retry: never twice timeoutMs', async () => {
    // First answer: 401 NF-014 after 60 ms (of 100). The retry hangs; it is
    // aborted at the first request's deadline (100 ms), not 100 ms after it
    // started (160 ms). Fake timers: the check is exact, not a wall-clock race.
    rs.useFakeTimers()
    try {
      globalThis.fetch = ((url: string, init: RequestInit) => {
        sent.push({ url, init })
        if (sent.length === 1) {
          return new Promise((resolve) =>
            setTimeout(() => resolve(failure(401, 'NF-014')()), 60)
          )
        }
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(init.signal!.reason)
          )
        })
      }) as typeof fetch
      const { callServer, reports } = make({
        timeoutMs: 100,
        getToken: async () => (sent.length === 0 ? 'old' : 'new'),
        invalidateToken: () => {},
      })
      let settled = false
      const outcome = callServer('src/a.ts#slow', [])
        .catch((e: unknown) => e as Error & { code?: string })
        .finally(() => {
          settled = true
        })
      await rs.advanceTimersByTimeAsync(99)
      expect(sent).toHaveLength(2)
      expect(settled).toBe(false)
      await rs.advanceTimersByTimeAsync(1)
      for (let i = 0; i < 20; i++) await Promise.resolve()
      expect(settled).toBe(true)
      const error = (await outcome) as Error & { code?: string }
      expect(error.code).toBe('NF-038')
      expect(error.message).toContain('did not answer within 100 ms')
      expect(reports).toEqual([
        expect.objectContaining({ ok: false, code: 'NF-038', retried: true }),
      ])
    } finally {
      // Without one deadline the retry's own timer is still pending.
      await rs.advanceTimersByTimeAsync(1000)
      rs.useRealTimers()
    }
  })

  test('a retry whose deadline already passed is not sent', async () => {
    replies.push(failure(401, 'NF-014'), flight({ returnValue: 'late' }))
    let calls = 0
    const { callServer } = make({
      timeoutMs: 30,
      // The token refresh itself outlives the deadline.
      getToken: async () => {
        calls++
        if (calls === 2) await new Promise((r) => setTimeout(r, 50))
        return calls === 1 ? 'old' : 'new'
      },
      invalidateToken: () => {},
    })
    const error = (await callServer('src/a.ts#slow', []).catch(
      (e: unknown) => e
    )) as Error & { code?: string }
    expect(error.code).toBe('NF-038')
    expect(sent).toHaveLength(1)
  })

  test('an answer in time is not aborted afterwards, and no timeoutMs sends no signal', async () => {
    replies.push(flight({ returnValue: 1 }))
    const timed = make({ timeoutMs: 20 })
    await expect(timed.callServer('src/a.ts#fast', [])).resolves.toBe(1)
    await new Promise((r) => setTimeout(r, 40))
    expect(sent[0]!.init.signal?.aborted).toBe(false)
    replies.push(flight({ returnValue: 2 }))
    await expect(make().callServer('src/a.ts#fast', [])).resolves.toBe(2)
    expect(sent[1]!.init.signal).toBeUndefined()
  })
})
