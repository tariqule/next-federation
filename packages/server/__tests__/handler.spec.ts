import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { isNFError } from '@next-federation/sdk'
import { defineFederation } from '@next-federation/core'
import {
  generateSigningKey,
  mintIslandToken,
  publicJwks,
} from '@next-federation/core/identity'
import { parseEnvelope } from '@next-federation/protocol'
import { createIslandHandler } from '../src/handler.ts'
import type { IslandHandlerOptions, RenderIsland } from '../src/handler.ts'
import { getIdentity } from '../src/identity-context.ts'

const ISSUER = 'https://host.example.com'
const HOST = 'https://a.example'
const BASE = 'https://r.example'

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(BASE + path, { headers })
const post = (path: string, body: string, headers = {}) =>
  new Request(BASE + path, { method: 'POST', body, headers })

const okRender = (html = '<p id="nfid-x">hi</p>'): RenderIsland =>
  rs.fn(async () => ({ html, rscPayload: '0:[]\n', css: [] }))

function make(over: Partial<IslandHandlerOptions> = {}) {
  const render = (over.render as ReturnType<typeof okRender>) ?? okRender()
  return {
    render,
    handler: createIslandHandler({
      name: 'a',
      buildId: 'v1',
      mode: 'production',
      reactVersion: '19.2.0',
      hosts: [HOST],
      islands: { Panel: {}, Secret: { private: true } },
      bootstrapUrl: () => 'https://r.example/b/v1/assets/i.js',
      ...over,
      render,
    }),
  }
}
const P = '/_nf/island/Panel?p=' + b64({ sku: 'A1' })

let jwksSrv: Server
let jwksUrl = ''
let fed: Awaited<ReturnType<typeof defineFederation>>
let body: unknown = { keys: [] }
let status = 200
beforeAll(async () => {
  fed = await defineFederation({
    remotes: { a: { origin: BASE } },
    identity: { issuer: ISSUER, signingKeys: [await generateSigningKey('k1')] },
  })
  body = await publicJwks(fed)
  jwksSrv = createServer((_q, res) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((r) => jwksSrv.listen(0, '127.0.0.1', r))
  jwksUrl = `http://127.0.0.1:${(jwksSrv.address() as AddressInfo).port}/jwks`
})
afterAll(() => {
  jwksSrv.close()
})
const token = async () =>
  (
    await mintIslandToken(fed, {
      remote: 'a',
      identity: { sub: 'u1', claims: {} },
    })
  ).token
const authed = () => ({ issuers: { [ISSUER]: jwksUrl } })

test('serves a v1 envelope that parseEnvelope accepts', async () => {
  const { handler } = make()
  const env = parseEnvelope(await (await handler(get(P))).json())
  expect(env).toMatchObject({
    remote: 'a',
    buildId: 'v1',
    mode: 'production',
    bootstrap: 'https://r.example/b/v1/assets/i.js',
  })
  expect(env.idPlaceholder).toMatch(/^nfid-[0-9a-f]{8}-$/)
})

test('idPlaceholder does not depend on props', async () => {
  const { handler } = make()
  const one = await (await handler(get(P))).json()
  const two = await (
    await handler(get('/_nf/island/Panel?p=' + b64({ sku: 'ZZ' })))
  ).json()
  expect(one.idPlaceholder).toBe(two.idPlaceholder)
})

test('render receives decoded props, host context and the placeholder', async () => {
  const { handler, render } = make()
  const h = b64({ basePath: '/shop', locale: 'fr' })
  const res = await handler(get(P + '&h=' + h))
  const env = await res.json()
  expect(render).toHaveBeenCalledWith(
    'Panel',
    { sku: 'A1' },
    {
      idPlaceholder: env.idPlaceholder,
      host: { basePath: '/shop', locale: 'fr' },
    }
  )
})

test('html is stripped of scripts and links before it is sent', async () => {
  const { handler } = make({
    render: okRender(
      '<script>x()</script><link rel="stylesheet" href="/a.css"><b>k</b>'
    ),
  })
  expect((await (await handler(get(P))).json()).html).toBe('<b>k</b>')
})

test('dev mode logs NF-018 for a <title> but not for a modulepreload link', async () => {
  const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const { handler } = make({
      dev: true,
      render: okRender(
        '<link rel="modulepreload" href="/m.js"><title>t</title>'
      ),
    })
    await handler(get(P))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]!.join(' '))).toContain('NF-018')
    warn.mockClear()
    const quiet = make({ render: okRender('<title>t</title>') })
    await quiet.handler(get(P))
    expect(warn).not.toHaveBeenCalled()
  } finally {
    warn.mockRestore()
  }
})

test('public response is public, max-age=60; any token makes it private, no-store', async () => {
  const { handler } = make(authed())
  expect((await handler(get(P))).headers.get('cache-control')).toBe(
    'public, max-age=60'
  )
  const res = await handler(
    get(P, { authorization: `Bearer ${await token()}` })
  )
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toBe('private, no-store')
  const custom = make({ maxAge: 5 })
  expect((await custom.handler(get(P))).headers.get('cache-control')).toBe(
    'public, max-age=5'
  )
})

test('render runs with the verified identity in scope', async () => {
  let seen: unknown = 'unset'
  const render: RenderIsland = async () => {
    seen = getIdentity()?.sub
    return { html: '', rscPayload: '', css: [] }
  }
  const { handler } = make({ ...authed(), render })
  await handler(get(P, { authorization: `Bearer ${await token()}` }))
  expect(seen).toBe('u1')
})

test('private island without a token is 401 NF-014 and render is not called', async () => {
  const { handler, render } = make(authed())
  const res = await handler(get('/_nf/island/Secret'))
  expect(res.status).toBe(401)
  expect(await res.json()).toEqual({ error: 'NF-014' })
  expect(res.headers.get('cache-control')).toBe('no-store')
  expect(render).not.toHaveBeenCalled()
})

test('private island without a token and no issuers configured is still 401', async () => {
  const { handler } = make()
  expect((await handler(get('/_nf/island/Secret'))).status).toBe(401)
})

test('token from an issuer not in the map is 401 NF-016', async () => {
  const { handler } = make({ issuers: { 'https://other.example': jwksUrl } })
  const res = await handler(
    get(P, { authorization: `Bearer ${await token()}` })
  )
  expect(res.status).toBe(401)
  expect(await res.json()).toEqual({ error: 'NF-016' })
})

test('a garbage token is 401 NF-014', async () => {
  const { handler } = make(authed())
  const res = await handler(get(P, { authorization: 'Bearer nope' }))
  expect(res.status).toBe(401)
  expect(await res.json()).toEqual({ error: 'NF-014' })
})

test('unknown island is 404 NF-021', async () => {
  const { handler } = make()
  const res = await handler(get('/_nf/island/Nope'))
  expect(res.status).toBe(404)
  expect(await res.json()).toEqual({ error: 'NF-021' })
  expect(res.headers.get('cache-control')).toBe('no-store')
})

test('own-property lookup: island "constructor" is 404', async () => {
  const { handler, render } = make()
  expect((await handler(get('/_nf/island/constructor'))).status).toBe(404)
  expect((await handler(get('/_nf/island/toString'))).status).toBe(404)
  expect(render).not.toHaveBeenCalled()
})

test('non-island path is a bare 404; invalid island name is 400 NF-004', async () => {
  const { handler } = make()
  const nope = await handler(get('/other'))
  expect(nope.status).toBe(404)
  expect(await nope.text()).toBe('')
  const bad = await handler(get('/_nf/island/'))
  expect(bad.status).toBe(400)
  expect(await bad.json()).toEqual({ error: 'NF-004' })
})

test('health answers 200 ok at any prefix, even for a disallowed Origin', async () => {
  const { handler } = make()
  for (const path of ['/_nf/health', '/b/v1/_nf/health']) {
    const res = await handler(get(path, { origin: 'https://evil.example' }))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    expect(res.headers.get('cache-control')).toBe('no-store')
  }
})

test('routes are anchored: look-alike paths are a bare 404', async () => {
  const { handler } = make()
  for (const path of [
    '/_nf/island/Panel/extra',
    '/assets/_nf/island/Panel/style.css',
    '/_nf/island//Panel',
    '/b/v1//_nf/island/Panel',
    '//_nf/health',
    '/_nf/health/',
    '/_nf/healthz',
    '/x_nf/health',
  ]) {
    const res = await handler(get(path))
    expect([path, res.status]).toEqual([path, 404])
    expect(await res.text()).toBe('')
  }
  // A base path before the route still works.
  expect((await handler(get('/remote/b/v1' + P))).status).toBe(200)
  expect((await handler(get('/remote/_nf/health'))).status).toBe(200)
})

test('method other than GET/POST is 405', async () => {
  const { handler } = make()
  const res = await handler(new Request(BASE + P, { method: 'DELETE' }))
  expect(res.status).toBe(405)
  expect(res.headers.get('cache-control')).toBe('no-store')
})

test('disallowed Origin is 403 NF-022 and gets no allow-origin header', async () => {
  const { handler, render } = make()
  const res = await handler(get(P, { origin: 'https://evil.example' }))
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ error: 'NF-022' })
  expect(res.headers.get('access-control-allow-origin')).toBeNull()
  expect(res.headers.get('vary')).toBe('Origin, Authorization')
  expect(render).not.toHaveBeenCalled()
})

test('an error response to an allowed Origin still has CORS headers', async () => {
  const { handler } = make(authed())
  const origin = { origin: HOST }
  const cases = [
    [await handler(get('/_nf/island/Nope', origin)), 404],
    [await handler(get('/_nf/island/Secret', origin)), 401],
    [await handler(get('/other', origin)), 404],
    [await handler(get('/_nf/island/Panel?p=!!', origin)), 400],
  ] as const
  for (const [res, code] of cases) {
    expect(res.status).toBe(code)
    expect(res.headers.get('access-control-allow-origin')).toBe(HOST)
    expect(res.headers.get('vary')).toBe('Origin, Authorization')
  }
})

test('success responses carry CORS and Vary', async () => {
  const { handler } = make()
  const res = await handler(get(P, { origin: HOST }))
  expect(res.headers.get('access-control-allow-origin')).toBe(HOST)
  expect(res.headers.get('vary')).toBe('Origin, Authorization')
})

test('preflight allows Authorization, Content-Type, X-NF-Action and max-age 600', async () => {
  const { handler } = make()
  const res = await handler(
    new Request(BASE + P, { method: 'OPTIONS', headers: { origin: HOST } })
  )
  expect(res.status).toBe(204)
  expect(res.headers.get('access-control-allow-headers')).toBe(
    'Authorization, Content-Type, X-NF-Action'
  )
  expect(res.headers.get('access-control-max-age')).toBe('600')
  expect(res.headers.get('access-control-allow-origin')).toBe(HOST)
})

test('preflight from a disallowed Origin is 204 without allow-origin', async () => {
  const { handler } = make()
  const res = await handler(
    new Request(BASE + P, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    })
  )
  expect(res.status).toBe(204)
  expect(res.headers.get('access-control-allow-origin')).toBeNull()
})

test('POST works and a body over 65536 bytes is 413', async () => {
  const { handler, render } = make()
  const ok = await handler(
    post('/_nf/island/Panel', JSON.stringify({ props: { a: 1 } }))
  )
  expect(ok.status).toBe(200)
  expect(render).toHaveBeenCalledWith('Panel', { a: 1 }, expect.anything())
  const big = JSON.stringify({ props: { s: 'x'.repeat(65536) } })
  const res = await handler(post('/_nf/island/Panel', big))
  expect(res.status).toBe(413)
  expect(res.headers.get('cache-control')).toBe('no-store')
})

test('413 is also enforced by a lying Content-Length and by bytes read', async () => {
  const { handler } = make({ maxBodyBytes: 10 })
  const declared = await handler(
    post('/_nf/island/Panel', '{}', { 'content-length': '999999' })
  )
  expect(declared.status).toBe(413)
  const read = await handler(
    post('/_nf/island/Panel', JSON.stringify({ props: { s: 'y'.repeat(50) } }))
  )
  expect(read.status).toBe(413)
})

test('malformed base64 or JSON input is 400 NF-004, never 500', async () => {
  const { handler } = make()
  const cases = [
    get('/_nf/island/Panel?p=%%%'),
    get('/_nf/island/Panel?p=' + Buffer.from('{nope').toString('base64url')),
    get('/_nf/island/Panel?p=' + b64({}) + '&h=' + b64('str')),
    get(
      '/_nf/island/Panel?p=' + Buffer.from([0xff, 0xfe]).toString('base64url')
    ),
    post('/_nf/island/Panel', '{not json'),
    post('/_nf/island/Panel', '[1]'),
    get('/_nf/island/%E0%A4%A'),
  ]
  for (const c of cases) {
    const res = await handler(c)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'NF-004' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  }
})

test('JWKS outage is 503 NF-015 with Retry-After', async () => {
  const { handler } = make(authed())
  const t = await token()
  status = 500
  try {
    const res = await handler(get(P, { authorization: `Bearer ${t}` }))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'NF-015' })
    expect(res.headers.get('retry-after')).toBe('5')
    expect(res.headers.get('cache-control')).toBe('no-store')
  } finally {
    status = 200
  }
})

test('a throwing render is 500, no-store, and the message is not in the body', async () => {
  const err = rs.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const { handler } = make({
      render: rs.fn(async () => {
        throw new Error('secret-db-password')
      }),
    })
    const res = await handler(get(P, { origin: HOST }))
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('access-control-allow-origin')).toBe(HOST)
    expect(await res.text()).not.toContain('secret-db-password')
    expect(err).toHaveBeenCalled()
  } finally {
    err.mockRestore()
  }
})

test('a relative css or bootstrap URL is 500', async () => {
  const err = rs.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const css = make({
      render: rs.fn(async () => ({
        html: '',
        rscPayload: '',
        css: ['/a.css'],
      })),
    })
    expect((await css.handler(get(P))).status).toBe(500)
    const boot = make({ bootstrapUrl: () => '/i.js' })
    expect((await boot.handler(get(P))).status).toBe(500)
  } finally {
    err.mockRestore()
  }
})

test('hosts containing "*" is NF-002 at creation', () => {
  try {
    make({ hosts: ['*'] })
    throw new Error('should have thrown')
  } catch (e) {
    expect(isNFError(e) && e.code).toBe('NF-002')
  }
})

test('a build-pinned prefix /b/v1/_nf/island/Panel is served', async () => {
  const { handler } = make()
  const res = await handler(get('/b/v1' + P))
  expect(res.status).toBe(200)
})

test('hosts entries that can never match an Origin are NF-002 at creation', () => {
  for (const bad of [
    'https://a.example/',
    'https://A.example',
    'a.example',
    'ftp://a.example',
    'https://a.example/path',
    '',
  ]) {
    try {
      make({ hosts: [bad] })
      throw new Error(`should have thrown for "${bad}"`)
    } catch (e) {
      expect(isNFError(e) && e.code).toBe('NF-002')
    }
  }
  expect(() =>
    make({ hosts: ['https://a.example', 'http://localhost:3000'] })
  ).not.toThrow()
})

test('a hosts error names the entry and never echoes credentials', () => {
  try {
    make({ hosts: ['https://user:hunter2@a.example'] })
    throw new Error('should have thrown')
  } catch (e) {
    const msg = (e as Error).message
    expect(msg).toContain('a.example')
    expect(msg).not.toContain('hunter2')
  }
})
