import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { defineFederation } from '@next-federation/core'
import {
  generateSigningKey,
  mintIslandToken,
  publicJwks,
} from '@next-federation/core/identity'
import { parseEnvelope } from '@next-federation/protocol'
import { REQUIRES_IDENTITY, requireIdentity } from '../src/action.ts'
import type { ActionRuntime } from '../src/action.ts'
import { createIslandHandler } from '../src/handler.ts'
import type { IslandHandlerOptions } from '../src/handler.ts'
import { getIdentity } from '../src/identity-context.ts'
import * as serverEntry from '../src/index.ts'

const ISSUER = 'https://host.example.com'
const HOST = 'https://a.example'
const BASE = 'https://r.example/b/v1'
const TEXT = 'text/plain;charset=UTF-8'
const SERVER_REF = Symbol.for('react.server.reference')

type Fn = (...args: unknown[]) => unknown

/** What plugin-rsc's registerServerReference does to an export. */
function serverRef<F extends Fn>(fn: F, id: string): F {
  Object.defineProperties(fn, {
    $$typeof: { value: SERVER_REF },
    $$id: { value: id },
  })
  return fn
}

const calls: string[] = []
const add = serverRef(async (a: unknown, b: unknown) => {
  calls.push('add')
  return (a as number) + (b as number)
}, 'src/actions.ts#add')
const whoami = serverRef(
  async () => getIdentity()?.sub ?? null,
  'src/actions.ts#whoami'
)
const boom = serverRef(async () => {
  throw new Error('secret detail')
}, 'src/actions.ts#boom')
const guarded = serverRef(
  requireIdentity(async () => getIdentity()?.sub),
  'src/actions.ts#guarded'
)
const echoForm = serverRef(
  async (form: unknown) => (form as FormData).get('sku'),
  'src/actions.ts#echoForm'
)
const plain = async () => 'not registered'
const mislabelled = serverRef(async () => 1, 'src/other.ts#x')

const table: Record<string, unknown> = {
  'src/actions.ts#add': add,
  'src/actions.ts#whoami': whoami,
  'src/actions.ts#boom': boom,
  'src/actions.ts#guarded': guarded,
  'src/actions.ts#echoForm': echoForm,
  'src/actions.ts#plain': plain,
  'src/actions.ts#mislabelled': mislabelled,
}

type Spies = {
  decodeReply: ReturnType<typeof rs.fn>
  loadAction: ReturnType<typeof rs.fn>
}

/** A JSON stand-in for Flight: resolves `returnValue` and writes `{ ok, value | error }`. */
function fakeRuntime(over: Partial<ActionRuntime> = {}): ActionRuntime & Spies {
  const loadAction = rs.fn(async (id: string) => table[id])
  const decodeReply = rs.fn(async (body: string | FormData) =>
    typeof body === 'string' ? JSON.parse(body) : [body]
  )
  const encodeResult: ActionRuntime['encodeResult'] = (value, onError) => {
    const out = Promise.resolve(value.returnValue).then(
      (v) => JSON.stringify({ ok: true, value: v }),
      (e: unknown) => {
        onError(e)
        return JSON.stringify({ ok: false, error: (e as Error).message })
      }
    )
    return new ReadableStream({
      async start(c) {
        c.enqueue(new TextEncoder().encode(await out))
        c.close()
      },
    })
  }
  return {
    loadAction,
    decodeReply,
    encodeResult,
    ...over,
  } as ActionRuntime & Spies
}

function make(over: Partial<IslandHandlerOptions> = {}) {
  const actions = (over.actions as ActionRuntime & Spies) ?? fakeRuntime()
  return {
    actions,
    handler: createIslandHandler({
      name: 'a',
      buildId: 'v1',
      mode: 'production',
      reactVersion: '19.2.0',
      hosts: [HOST],
      islands: { Panel: {}, Secret: { private: true } },
      render: async () => ({ html: '<p>x</p>', rscPayload: '0:[]\n', css: [] }),
      bootstrapUrl: () => 'https://r.example/b/v1/assets/i.js',
      ...over,
      actions,
    }),
  }
}

function action(
  id: string | null,
  body: BodyInit = '[]',
  headers: Record<string, string> = {},
  query = ''
): Request {
  const h: Record<string, string> = {
    origin: HOST,
    'content-type': TEXT,
    ...headers,
  }
  if (id !== null) h['x-nf-action'] = id
  return new Request(`${BASE}/_nf/action${query}`, {
    method: 'POST',
    headers: h,
    body,
  })
}

async function expectError(res: Response, status: number, code?: string) {
  expect(res.status).toBe(status)
  expect(res.headers.get('access-control-allow-origin')).toBe(HOST)
  expect(res.headers.get('cache-control')).toBe('no-store')
  expect(res.headers.get('vary')).toBe('Origin, Authorization')
  if (code) expect(await res.json()).toEqual({ error: code })
  else expect(await res.text()).toBe('')
}

let jwksSrv: Server
let jwksUrl = ''
let fed: Awaited<ReturnType<typeof defineFederation>>
let jwks: unknown
let jwksStatus = 200
beforeAll(async () => {
  fed = await defineFederation({
    remotes: { a: { origin: 'https://r.example' } },
    identity: { issuer: ISSUER, signingKeys: [await generateSigningKey('k1')] },
  })
  jwks = await publicJwks(fed)
  jwksSrv = createServer((_q, res) => {
    res.statusCode = jwksStatus
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(jwks))
  })
  await new Promise<void>((r) => jwksSrv.listen(0, '127.0.0.1', r))
  jwksUrl = `http://127.0.0.1:${(jwksSrv.address() as AddressInfo).port}/jwks`
})
afterAll(() => {
  jwksSrv.close()
})
beforeEach(() => {
  calls.length = 0
})
const bearer = async (sub = 'u1') => ({
  authorization: `Bearer ${
    (await mintIslandToken(fed, { remote: 'a', identity: { sub, claims: {} } }))
      .token
  }`,
})
const authed = () => ({ issuers: { [ISSUER]: jwksUrl } })

test('runs the action and streams { returnValue } as text/x-component, no-store', async () => {
  const { handler } = make()
  const res = await handler(action('src/actions.ts#add', '[2,3]'))
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toMatch(/^text\/x-component/)
  expect(res.headers.get('cache-control')).toBe('no-store')
  expect(res.headers.get('vary')).toBe('Origin, Authorization')
  expect(res.headers.get('access-control-allow-origin')).toBe(HOST)
  expect(await res.json()).toEqual({ ok: true, value: 5 })
})

test('the action route works under any base path of whole segments', async () => {
  const { handler } = make()
  const res = await handler(
    new Request('https://r.example/_nf/action', {
      method: 'POST',
      headers: { 'x-nf-action': 'src/actions.ts#add', 'content-type': TEXT },
      body: '[1,1]',
    })
  )
  expect(res.status).toBe(200)
  const nested = await handler(
    new Request('https://r.example/x_nf/action', {
      method: 'POST',
      headers: { 'x-nf-action': 'src/actions.ts#add', 'content-type': TEXT },
      body: '[1,1]',
    })
  )
  expect(nested.status).toBe(404)
})

test('without an actions runtime the action path is a bare 404', async () => {
  const handler = createIslandHandler({
    name: 'a',
    buildId: 'v1',
    mode: 'production',
    reactVersion: '19.2.0',
    hosts: [HOST],
    islands: { Panel: {} },
    render: async () => ({ html: '', rscPayload: '', css: [] }),
    bootstrapUrl: () => 'https://r.example/i.js',
  })
  await expectError(await handler(action('src/actions.ts#add')), 404)
})

test('non-POST is 405 with CORS', async () => {
  const { handler } = make()
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const res = await handler(
      new Request(`${BASE}/_nf/action`, {
        method,
        headers: { origin: HOST, 'x-nf-action': 'src/actions.ts#add' },
      })
    )
    await expectError(res, 405)
  }
})

test('preflight and a disallowed Origin behave as for islands', async () => {
  const { handler, actions } = make()
  const pre = await handler(
    new Request(`${BASE}/_nf/action`, {
      method: 'OPTIONS',
      headers: { origin: HOST },
    })
  )
  expect(pre.status).toBe(204)
  expect(pre.headers.get('access-control-allow-headers')).toContain(
    'X-NF-Action'
  )
  const bad = await handler(
    action('src/actions.ts#add', '[1,2]', { origin: 'https://evil.example' })
  )
  expect(bad.status).toBe(403)
  expect(bad.headers.get('access-control-allow-origin')).toBeNull()
  expect(await bad.json()).toEqual({ error: 'NF-022' })
  expect(actions.loadAction).not.toHaveBeenCalled()
})

test.each([
  ['missing header', null, {}, ''],
  ['malformed id', '../x#a', {}, ''],
  [
    'application/json body',
    'src/actions.ts#add',
    { 'content-type': 'application/json' },
    '',
  ],
  [
    'urlencoded form post',
    'src/actions.ts#add',
    { 'content-type': 'application/x-www-form-urlencoded' },
    '',
  ],
  ['invalid island query', 'src/actions.ts#add', {}, '?island=a%20b'],
] as const)(
  '%s is 400 NF-032 before loading anything',
  async (_n, id, headers, query) => {
    const { handler, actions } = make()
    await expectError(
      await handler(action(id, '[1,2]', headers, query)),
      400,
      'NF-032'
    )
    expect(actions.loadAction).not.toHaveBeenCalled()
  }
)

test('an unknown island query is 404 NF-021', async () => {
  const { handler, actions } = make()
  await expectError(
    await handler(action('src/actions.ts#add', '[1,2]', {}, '?island=Nope')),
    404,
    'NF-021'
  )
  expect(actions.loadAction).not.toHaveBeenCalled()
})

test('a body over the limit is 413 with CORS, by Content-Length or by bytes read', async () => {
  const { handler, actions } = make({ maxActionBodyBytes: 8 })
  await expectError(
    await handler(action('src/actions.ts#add', '[1,2,3,4,5,6]')),
    413
  )
  const chunks = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('[1,2,3,'))
      c.enqueue(new TextEncoder().encode('4,5,6]'))
      c.close()
    },
  })
  const streamed = new Request(`${BASE}/_nf/action`, {
    method: 'POST',
    headers: {
      origin: HOST,
      'x-nf-action': 'src/actions.ts#add',
      'content-type': TEXT,
    },
    body: chunks,
    duplex: 'half',
  } as RequestInit)
  await expectError(await handler(streamed), 413)
  expect(actions.loadAction).not.toHaveBeenCalled()
})

test('the default action body limit is 1 MiB, not the island limit', async () => {
  const { handler } = make()
  const big = JSON.stringify([1, 'x'.repeat(200_000)])
  expect((await handler(action('src/actions.ts#add', big))).status).toBe(200)
  const tooBig = JSON.stringify(['x'.repeat(1_048_577)])
  expect((await handler(action('src/actions.ts#add', tooBig))).status).toBe(413)
})

test('JWKS outage is 503 NF-015 with Retry-After', async () => {
  const { handler } = make(authed())
  const auth = await bearer()
  jwksStatus = 500
  try {
    const res = await handler(action('src/actions.ts#whoami', '[]', auth))
    expect(res.headers.get('retry-after')).toBe('5')
    await expectError(res, 503, 'NF-015')
  } finally {
    jwksStatus = 200
  }
})

test('a bad token is 401 NF-014; an issuer outside the map is 401 NF-016', async () => {
  const { handler } = make(authed())
  await expectError(
    await handler(
      action('src/actions.ts#whoami', '[]', { authorization: 'Bearer nope' })
    ),
    401,
    'NF-014'
  )
  const other = make({ issuers: { 'https://other.example': jwksUrl } })
  await expectError(
    await other.handler(action('src/actions.ts#whoami', '[]', await bearer())),
    401,
    'NF-016'
  )
})

test('a private island query without a token is 401 NF-014 (advisory gate)', async () => {
  const { handler, actions } = make(authed())
  await expectError(
    await handler(action('src/actions.ts#add', '[1,2]', {}, '?island=Secret')),
    401,
    'NF-014'
  )
  expect(actions.loadAction).not.toHaveBeenCalled()
  const ok = await handler(
    action('src/actions.ts#whoami', '[]', await bearer('u9'), '?island=Secret')
  )
  expect(await ok.json()).toEqual({ ok: true, value: 'u9' })
})

test.each([
  ['an unknown id', 'src/actions.ts#nope'],
  ['an export that is not a server reference', 'src/actions.ts#plain'],
  ['a server reference whose $$id differs', 'src/actions.ts#mislabelled'],
])('%s is 404 NF-031 and never runs', async (_n, id) => {
  const { handler, actions } = make()
  await expectError(await handler(action(id)), 404, 'NF-031')
  expect(actions.decodeReply).not.toHaveBeenCalled()
})

test('a loadAction that throws (e.g. dev allowlist) is 404 NF-031', async () => {
  const { handler } = make({
    actions: fakeRuntime({
      loadAction: async () => {
        throw new Error('not allowed')
      },
    }),
  })
  await expectError(
    await handler(action('src/actions.ts#add', '[1,2]')),
    404,
    'NF-031'
  )
})

test('requireIdentity marks the function and returns it', () => {
  const fn = async () => 1
  expect(requireIdentity(fn)).toBe(fn)
  expect((fn as unknown as Record<symbol, unknown>)[REQUIRES_IDENTITY]).toBe(
    true
  )
  expect(REQUIRES_IDENTITY).toBe(
    Symbol.for('next-federation.requires-identity')
  )
  expect(serverEntry.requireIdentity).toBe(requireIdentity)
})

test('a requireIdentity action without a token is 401 NF-014, checked before decodeReply', async () => {
  const { handler, actions } = make(authed())
  await expectError(
    await handler(action('src/actions.ts#guarded', 'not json at all')),
    401,
    'NF-014'
  )
  expect(actions.decodeReply).not.toHaveBeenCalled()
  const ok = await handler(
    action('src/actions.ts#guarded', '[]', await bearer('u2'))
  )
  expect(await ok.json()).toEqual({ ok: true, value: 'u2' })
})

test('actionsRequireIdentity makes every action need a token', async () => {
  const { handler } = make({ ...authed(), actionsRequireIdentity: true })
  await expectError(
    await handler(action('src/actions.ts#add', '[1,2]')),
    401,
    'NF-014'
  )
  const ok = await handler(
    action('src/actions.ts#add', '[1,2]', await bearer())
  )
  expect(ok.status).toBe(200)
})

test('undecodable arguments are 400 NF-032 and the action never runs', async () => {
  const { handler } = make()
  await expectError(
    await handler(action('src/actions.ts#add', '{not json')),
    400,
    'NF-032'
  )
  await expectError(
    await handler(action('src/actions.ts#add', '{"not":"an array"}')),
    400,
    'NF-032'
  )
  expect(calls).toEqual([])
})

test('multipart bodies are decoded as FormData', async () => {
  const { handler, actions } = make()
  const form = new FormData()
  form.set('sku', 'A1')
  const multipart = new Request(`${BASE}/_nf/action`, {
    method: 'POST',
    headers: { origin: HOST, 'x-nf-action': 'src/actions.ts#echoForm' },
    body: form,
  })
  const res = await handler(multipart)
  expect(await res.json()).toEqual({ ok: true, value: 'A1' })
  expect(actions.decodeReply.mock.calls[0]?.[0]).toBeInstanceOf(FormData)
})

test('getIdentity() inside the action is the token subject; cookies never count', async () => {
  const { handler } = make(authed())
  const signedIn = await handler(
    action('src/actions.ts#whoami', '[]', await bearer('alice'))
  )
  expect(signedIn.headers.get('cache-control')).toBe('no-store')
  expect(await signedIn.json()).toEqual({ ok: true, value: 'alice' })
  const cookieOnly = await handler(
    action('src/actions.ts#whoami', '[]', { cookie: 'session=alice' })
  )
  expect(await cookieOnly.json()).toEqual({ ok: true, value: null })
})

test('a throwing action is 200 with a rejected returnValue, redacted in production, logged as NF-033', async () => {
  const err = rs.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const { handler } = make()
    const res = await handler(action('src/actions.ts#boom'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).not.toContain('secret detail')
    const logged = err.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(logged).toContain('NF-033')
    expect(
      err.mock.calls
        .flat()
        .some((c) => (c as Error)?.message === 'secret detail')
    ).toBe(true)

    const dev = make({ mode: 'development' })
    const devBody = await (
      await dev.handler(action('src/actions.ts#boom'))
    ).json()
    expect(devBody).toEqual({ ok: false, error: 'secret detail' })
  } finally {
    err.mockRestore()
  }
})

test('an encoder that throws before streaming is a 500 without the message', async () => {
  const err = rs.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const { handler } = make({
      actions: fakeRuntime({
        encodeResult: () => {
          throw new Error('encoder secret')
        },
      }),
    })
    const res = await handler(action('src/actions.ts#add', '[1,2]'))
    await expectError(res, 500)
  } finally {
    err.mockRestore()
  }
})

test('island envelopes now carry the island name', async () => {
  const { handler } = make()
  const res = await handler(new Request(`${BASE}/_nf/island/Panel`))
  expect(parseEnvelope(await res.json()).island).toBe('Panel')
})

test.each([
  'constructor',
  'hasOwnProperty',
  '__proto__',
  'toString',
  'valueOf',
])(
  'an id whose file part is the Object.prototype key %p is 404 NF-031 before loadAction',
  async (key) => {
    const { handler, actions } = make()
    await expectError(await handler(action(`${key}#x`)), 404, 'NF-031')
    expect(actions.loadAction).not.toHaveBeenCalled()
  }
)
