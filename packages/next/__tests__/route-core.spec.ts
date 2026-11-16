import { defineFederation } from '@next-federation/core'
import { generateSigningKey } from '@next-federation/core/identity'
import { handleFederationRoute } from '../src/route-core.ts'
import type { RouteRequest } from '../src/route-core.ts'

const ISSUER = 'https://host.example.com'

async function fed(withIdentity = true, extra: string[] = []) {
  const keys = withIdentity
    ? [await generateSigningKey('k1'), ...extra]
    : undefined
  return defineFederation({
    remotes: {
      shop: { origin: 'https://shop.example.com' },
      blog: { origin: 'https://blog.example.com' },
    },
    ...(keys ? { identity: { issuer: ISSUER, signingKeys: keys } } : {}),
  })
}

function req(over: Partial<RouteRequest> = {}): RouteRequest {
  return {
    method: 'POST',
    segments: ['token'],
    aud: 'shop',
    secFetchSite: 'same-origin',
    identity: async () => ({ sub: 'user-1' }),
    ...over,
  }
}

function b64(part: string) {
  return Buffer.from(part, 'base64url')
}

async function verify(token: string, jwk: JsonWebKey) {
  const [h, p, s] = token.split('.') as [string, string, string]
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  )
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    b64(s),
    new TextEncoder().encode(`${h}.${p}`)
  )
  return {
    ok,
    payload: JSON.parse(b64(p).toString()) as Record<string, unknown>,
  }
}

test('GET jwks returns public keys only, cacheable for 300 s', async () => {
  const f = await fed(true, [await generateSigningKey('k2')])
  const r = await handleFederationRoute(
    f,
    req({ method: 'GET', segments: ['jwks'], aud: null })
  )
  expect(r.status).toBe(200)
  expect(r.headers['Cache-Control']).toBe('public, max-age=300')
  const keys = (r.body as { keys: Record<string, unknown>[] }).keys
  expect(keys.map((k) => k.kid)).toEqual(['k1', 'k2'])
  for (const k of keys) {
    expect(k.d).toBeUndefined()
    expect(Object.keys(k).sort()).toEqual([
      'alg',
      'crv',
      'kid',
      'kty',
      'use',
      'x',
      'y',
    ])
  }
})

test('POST token returns token, expiresAt and identityKey with no-store', async () => {
  const f = await fed()
  const jwks = (
    await handleFederationRoute(f, req({ method: 'GET', segments: ['jwks'] }))
  ).body as {
    keys: JsonWebKey[]
  }
  const r = await handleFederationRoute(f, req({ aud: 'blog' }))
  expect(r.status).toBe(200)
  expect(r.headers['Cache-Control']).toBe('no-store')
  const body = r.body as {
    token: string
    expiresAt: number
    identityKey: string
  }
  const { ok, payload } = await verify(body.token, jwks.keys[0]!)
  expect(ok).toBe(true)
  expect(payload.aud).toBe('blog')
  expect(payload.sub).toBe('user-1')
  expect(payload.iss).toBe(ISSUER)
  expect(payload.exp).toBe(body.expiresAt)
  expect(typeof body.identityKey).toBe('string')
  expect(body.identityKey).not.toContain('user-1')
})

test('POST token for an unknown aud is 400', async () => {
  const f = await fed()
  const r = await handleFederationRoute(f, req({ aud: 'nope' }))
  expect(r.status).toBe(400)
  expect(r.body).toBeUndefined()
  const proto = await handleFederationRoute(f, req({ aud: 'constructor' }))
  expect(proto.status).toBe(400)
})

test('missing aud is 400', async () => {
  const r = await handleFederationRoute(await fed(), req({ aud: null }))
  expect(r.status).toBe(400)
})

test('POST token without a session is 401', async () => {
  const r = await handleFederationRoute(
    await fed(),
    req({ identity: async () => null })
  )
  expect(r.status).toBe(401)
  expect(r.headers['Cache-Control']).toBe('no-store')
  expect(r.body).toBeUndefined()
})

test('cross-site POST (Sec-Fetch-Site: cross-site) is 403 and identity() is not called', async () => {
  let called = 0
  const identity = async () => {
    called++
    return { sub: 'u' }
  }
  for (const site of ['cross-site', 'same-site', 'none']) {
    const r = await handleFederationRoute(
      await fed(),
      req({ secFetchSite: site, identity })
    )
    expect(r.status).toBe(403)
  }
  expect(called).toBe(0)
})

test('a missing Sec-Fetch-Site header is allowed', async () => {
  const r = await handleFederationRoute(
    await fed(),
    req({ secFetchSite: null })
  )
  expect(r.status).toBe(200)
})

test('GET token and POST jwks are 404', async () => {
  const f = await fed()
  expect(
    (
      await handleFederationRoute(
        f,
        req({ method: 'GET', segments: ['token'] })
      )
    ).status
  ).toBe(404)
  expect(
    (
      await handleFederationRoute(
        f,
        req({ method: 'POST', segments: ['jwks'] })
      )
    ).status
  ).toBe(404)
  expect((await handleFederationRoute(f, req({ segments: [] }))).status).toBe(
    404
  )
  expect(
    (await handleFederationRoute(f, req({ segments: ['token', 'x'] }))).status
  ).toBe(404)
})

test('no identity config: everything is 404', async () => {
  const f = await fed(false)
  expect(
    (await handleFederationRoute(f, req({ method: 'GET', segments: ['jwks'] })))
      .status
  ).toBe(404)
  expect((await handleFederationRoute(f, req())).status).toBe(404)
})

test('the same identity yields the identityKey that loadIsland gave the mount', async () => {
  const { identityKey } = await import('@next-federation/core/identity')
  const f = await fed()
  const r = await handleFederationRoute(f, req())
  expect((r.body as { identityKey: string }).identityKey).toBe(
    await identityKey(f, 'user-1')
  )
  const other = await handleFederationRoute(
    f,
    req({ identity: async () => ({ sub: 'user-2' }) })
  )
  expect((other.body as { identityKey: string }).identityKey).not.toBe(
    (r.body as { identityKey: string }).identityKey
  )
})
