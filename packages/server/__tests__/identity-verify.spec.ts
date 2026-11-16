import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { isNFError } from '@next-federation/sdk'
import { defineFederation } from '@next-federation/core'
import {
  generateSigningKey,
  mintIslandToken,
  publicJwks,
} from '@next-federation/core/identity'
import { createIdentityVerifier } from '../src/identity-verify.ts'

const ISSUER = 'https://host.example.com'
const AUD = 'shop'

type Jwks = { keys: unknown[] }
type Jwk = Server & { hits: number; body: Jwks }

async function jwksServer(body: Jwks): Promise<{ s: Jwk; url: string }> {
  const s = createServer((_req, res) => {
    s.hits++
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(s.body))
  }) as Jwk
  s.hits = 0
  s.body = body
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  return {
    s,
    url: `http://127.0.0.1:${(s.address() as AddressInfo).port}/jwks`,
  }
}

async function host(keys: string[]) {
  return defineFederation({
    remotes: { [AUD]: { origin: 'https://shop.example.com' } },
    identity: { issuer: ISSUER, signingKeys: keys },
  })
}

const req = (token?: string, header?: string) =>
  new Request('https://shop.example.com/x', {
    headers:
      header !== undefined
        ? { authorization: header }
        : token
          ? { authorization: `Bearer ${token}` }
          : {},
  })

let fed: Awaited<ReturnType<typeof host>>
let srv: { s: Jwk; url: string }
const servers: Server[] = []

beforeAll(async () => {
  fed = await host([await generateSigningKey('k1')])
  srv = await jwksServer(await publicJwks(fed))
  servers.push(srv.s)
})
afterAll(() => {
  for (const s of servers) s.close()
})

/** Signs arbitrary claims with a throwaway key served from a JWKS server. */
async function foreign(claims: {
  iat?: number
  exp?: number
}): Promise<{ token: string; v: ReturnType<typeof createIdentityVerifier> }> {
  const k = await generateKeyPair('ES256', { extractable: true })
  const s = await jwksServer({
    keys: [{ ...(await exportJWK(k.publicKey)), kid: 'z', alg: 'ES256' }],
  })
  servers.push(s.s)
  let jwt = new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: 'z' })
    .setIssuer(ISSUER)
    .setAudience(AUD)
    .setSubject('u')
  if (claims.iat !== undefined) jwt = jwt.setIssuedAt(claims.iat)
  if (claims.exp !== undefined) jwt = jwt.setExpirationTime(claims.exp)
  return {
    token: await jwt.sign(k.privateKey),
    v: createIdentityVerifier({ audience: AUD, issuers: { [ISSUER]: s.url } }),
  }
}

const mint = async (opts: { ttlSeconds?: number; remote?: string } = {}) =>
  (
    await mintIslandToken(fed, {
      remote: opts.remote ?? AUD,
      identity: { sub: 'user-1', claims: { plan: 'pro' } },
      ttlSeconds: opts.ttlSeconds,
    })
  ).token

const verifier = (issuers: Record<string, string> = { [ISSUER]: srv.url }) =>
  createIdentityVerifier({ audience: AUD, issuers })

test('no header is anonymous', async () => {
  expect(await verifier()(req())).toEqual({ kind: 'anonymous' })
})

test('a header that is not Bearer <jwt> is NF-014', async () => {
  expect(await verifier()(req(undefined, 'Basic abc'))).toEqual({
    kind: 'invalid',
    code: 'NF-014',
  })
  expect(await verifier()(req(undefined, 'Bearer '))).toEqual({
    kind: 'invalid',
    code: 'NF-014',
  })
  expect(await verifier()(req(undefined, 'Bearer not-a-jwt'))).toEqual({
    kind: 'invalid',
    code: 'NF-014',
  })
})

test('a valid token is verified and exposes sub and custom claims', async () => {
  const out = await verifier()(req(await mint()))
  expect(out.kind).toBe('verified')
  if (out.kind !== 'verified') return
  expect(out.identity.sub).toBe('user-1')
  expect(out.identity.plan).toBe('pro')
  expect(out.identity.iss).toBe(ISSUER)
})

test('a token for another audience is NF-014', async () => {
  const other = await defineFederation({
    remotes: {
      shop: { origin: 'https://shop.example.com' },
      cart: { origin: 'https://cart.example.com' },
    },
    identity: { issuer: ISSUER, signingKeys: [await generateSigningKey('k1')] },
  })
  const { token } = await mintIslandToken(other, {
    remote: 'cart',
    identity: { sub: 'u' },
  })
  expect(await verifier()(req(token))).toEqual({
    kind: 'invalid',
    code: 'NF-014',
  })
})

test('an expired token is NF-014', async () => {
  const now = Math.floor(Date.now() / 1000)
  const { token, v } = await foreign({ iat: now - 400, exp: now - 120 })
  expect(await v(req(token))).toEqual({ kind: 'invalid', code: 'NF-014' })
})

test('alg none / HS256 tokens are NF-014', async () => {
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString('base64url')
  const claims = { iss: ISSUER, aud: AUD, sub: 'u', exp: 9999999999 }
  const none = `${b64({ alg: 'none' })}.${b64(claims)}.`
  const hs = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
    .sign(new TextEncoder().encode('secret-secret-secret-secret-secret!'))
  for (const t of [none, hs]) {
    expect(await verifier()(req(t))).toEqual({
      kind: 'invalid',
      code: 'NF-014',
    })
  }
})

test('an issuer missing from the map is NF-016 and no network request is made', async () => {
  const before = srv.s.hits
  const v = verifier({ 'https://other.example.com': srv.url })
  expect(await v(req(await mint()))).toEqual({
    kind: 'invalid',
    code: 'NF-016',
  })
  expect(srv.s.hits).toBe(before)
})

test('a token whose iss points at an attacker JWKS is NF-016', async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256', {
    extractable: true,
  })
  const pub = { ...(await exportJWK(publicKey)), kid: 'a1', alg: 'ES256' }
  const attacker = await jwksServer({ keys: [pub] })
  servers.push(attacker.s)
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: 'a1', jku: attacker.url })
    .setIssuer(attacker.url)
    .setAudience(AUD)
    .setSubject('evil')
    .setExpirationTime('5m')
    .sign(privateKey)
  expect(await verifier()(req(token))).toEqual({
    kind: 'invalid',
    code: 'NF-016',
  })
  expect(attacker.s.hits).toBe(0)
})

test('JWKS server down is unavailable, not invalid', async () => {
  const dead = await jwksServer({ keys: [] })
  const url = dead.url
  const token = await mint()
  await new Promise<void>((r) => dead.s.close(() => r()))
  const v = createIdentityVerifier({
    audience: AUD,
    issuers: { [ISSUER]: url },
  })
  expect(await v(req(token))).toEqual({ kind: 'unavailable' })
})

test('a token signed by a rotated-in second key verifies', async () => {
  const k1 = await generateSigningKey('k1')
  const k2 = await generateSigningKey('k2')
  const before = await host([k1])
  // Rotation: the host publishes both keys, then signs with the new first key.
  const after = await host([k2, k1])
  const s = await jwksServer(await publicJwks(after))
  servers.push(s.s)
  const v = createIdentityVerifier({
    audience: AUD,
    issuers: { [ISSUER]: s.url },
  })
  const old = await mintIslandToken(before, {
    remote: AUD,
    identity: { sub: 'a' },
  })
  const fresh = await mintIslandToken(after, {
    remote: AUD,
    identity: { sub: 'b' },
  })
  expect((await v(req(old.token))).kind).toBe('verified')
  const out = await v(req(fresh.token))
  expect(out.kind).toBe('verified')
  if (out.kind === 'verified') expect(out.identity.sub).toBe('b')
})

test('a token without exp is NF-014', async () => {
  const { token, v } = await foreign({ iat: Math.floor(Date.now() / 1000) })
  expect(await v(req(token))).toEqual({ kind: 'invalid', code: 'NF-014' })
})

test('a token with an iat far in the future is NF-014', async () => {
  const now = Math.floor(Date.now() / 1000)
  const { token, v } = await foreign({
    iat: now + 365 * 86400,
    exp: now + 365 * 86400 + 300,
  })
  expect(await v(req(token))).toEqual({ kind: 'invalid', code: 'NF-014' })
})

test('a token older than the max age is NF-014', async () => {
  const now = Math.floor(Date.now() / 1000)
  const { token, v } = await foreign({ iat: now - 3600, exp: now + 300 })
  expect(await v(req(token))).toEqual({ kind: 'invalid', code: 'NF-014' })
})

test('bad issuer or JWKS URLs are NF-002 at creation', () => {
  const codeOf = (issuers: Record<string, string>) => {
    try {
      createIdentityVerifier({ audience: AUD, issuers })
    } catch (e) {
      return isNFError(e) ? e.code : 'other'
    }
    return 'none'
  }
  expect(codeOf({ [ISSUER]: 'not a url' })).toBe('NF-002')
  expect(codeOf({ [ISSUER]: 'file:///etc/passwd' })).toBe('NF-002')
  expect(codeOf({ 'not an issuer': 'https://h.example.com/jwks' })).toBe(
    'NF-002'
  )
  expect(codeOf({})).toBe('NF-002')
  expect(codeOf({ [ISSUER]: 'https://h.example.com/jwks' })).toBe('none')
})

test('non-loopback http issuer or JWKS URLs are NF-002 outside development', () => {
  const before = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    const messageOf = (
      issuers: Record<string, string>,
      allowInsecureHttp?: boolean
    ) => {
      try {
        createIdentityVerifier({ audience: AUD, issuers, allowInsecureHttp })
      } catch (e) {
        expect(isNFError(e, 'NF-002')).toBe(true)
        return (e as Error).message
      }
      return 'none'
    }
    expect(
      messageOf({ 'http://host.example': 'https://h.example.com/jwks' })
    ).toMatch(/https.*http:\/\/host\.example/)
    const jwks = messageOf({ [ISSUER]: 'http://u:pw@h.example.com/jwks' })
    expect(jwks).toMatch(/http:\/\/h\.example\.com/)
    expect(jwks).not.toMatch(/pw|\/jwks/)
    expect(messageOf({ [ISSUER]: 'http://127.0.0.1:9/jwks' })).toBe('none')
    expect(messageOf({ 'http://localhost:3000': 'http://[::1]:9/jwks' })).toBe(
      'none'
    )
    expect(messageOf({ [ISSUER]: 'http://h.example.com/jwks' }, true)).toBe(
      'none'
    )
  } finally {
    process.env.NODE_ENV = before
  }
})

test('outcomes never contain the token', async () => {
  const now = Math.floor(Date.now() / 1000)
  const { token, v } = await foreign({ iat: now - 400, exp: now - 120 })
  const out = await v(req(token))
  expect(out).toEqual({ kind: 'invalid', code: 'NF-014' })
  expect(JSON.stringify(out)).not.toContain(token.split('.')[1]!)
})
