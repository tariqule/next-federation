import {
  createLocalJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
} from 'jose'
import { isNFError } from '@next-federation/sdk'
import { defineFederation } from '../src/index.ts'
import {
  generateSigningKey,
  identityKey,
  mintIslandToken,
  publicJwks,
  validateIdentity,
} from '../src/identity/index.ts'

const ISSUER = 'https://host.example.com'

async function fed(keys: string[], extra: Record<string, unknown> = {}) {
  return defineFederation({
    remotes: { shop: { origin: 'https://shop.example.com' } },
    identity: { issuer: ISSUER, signingKeys: keys, ...extra },
  })
}

async function codeOf(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    return isNFError(e) ? e.code : 'other'
  }
  return 'none'
}

test('only `sub` and `claims` reach the token: other identity fields are not copied', async () => {
  const f = await fed([await generateSigningKey('k1')])
  // A host session object passed through as-is, with extra fields.
  const identity = {
    sub: 'user-1',
    email: 'user-1@example.com',
    name: 'User One',
  } as { sub: string }
  const { token } = await mintIslandToken(f, { remote: 'shop', identity })
  expect(Object.keys(decodeJwt(token)).sort()).toEqual([
    'aud',
    'exp',
    'iat',
    'iss',
    'sub',
  ])
  const withClaims = await mintIslandToken(f, {
    remote: 'shop',
    identity: { ...identity, claims: { role: 'admin' } },
  })
  expect(Object.keys(decodeJwt(withClaims.token)).sort()).toEqual([
    'aud',
    'exp',
    'iat',
    'iss',
    'role',
    'sub',
  ])
})

test('mints an ES256 token with iss, aud, sub, exp = iat + 300 and the kid of the first key', async () => {
  const k1 = await generateSigningKey('k1')
  const k2 = await generateSigningKey('k2')
  const f = await fed([k1, k2])
  const { token, expiresAt } = await mintIslandToken(f, {
    remote: 'shop',
    identity: { sub: 'user-1', claims: { role: 'admin' } },
  })
  const header = decodeProtectedHeader(token)
  expect(header.alg).toBe('ES256')
  expect(header.kid).toBe('k1')
  const { payload } = await jwtVerify(
    token,
    createLocalJWKSet(await publicJwks(f)),
    { issuer: ISSUER, audience: 'shop' }
  )
  expect(payload.sub).toBe('user-1')
  expect(payload.role).toBe('admin')
  expect(payload.exp).toBe((payload.iat as number) + 300)
  expect(expiresAt).toBe(payload.exp)
})

test('honours ttlSeconds from the call and from config', async () => {
  const f = await fed([await generateSigningKey()], { ttlSeconds: 60 })
  const a = await mintIslandToken(f, { remote: 'shop', identity: { sub: 'u' } })
  const b = await mintIslandToken(f, {
    remote: 'shop',
    identity: { sub: 'u' },
    ttlSeconds: 10,
  })
  const now = Math.floor(Date.now() / 1000)
  expect(Math.abs(a.expiresAt - (now + 60))).toBeLessThanOrEqual(2)
  expect(Math.abs(b.expiresAt - (now + 10))).toBeLessThanOrEqual(2)
})

test('`now` sets the issue time (no Date.now() read); a non-finite one is NF-002', async () => {
  const f = await fed([await generateSigningKey()])
  const spy = rs.spyOn(Date, 'now')
  const { token, expiresAt } = await mintIslandToken(f, {
    remote: 'shop',
    identity: { sub: 'u' },
    now: 1_800_000_000.7,
  })
  expect(spy).not.toHaveBeenCalled()
  spy.mockRestore()
  expect(decodeJwt(token).iat).toBe(1_800_000_000)
  expect(expiresAt).toBe(1_800_000_300)
  expect(
    await codeOf(
      mintIslandToken(f, { remote: 'shop', identity: { sub: 'u' }, now: NaN })
    )
  ).toBe('NF-002')
})

test('publicJwks lists every key and contains no private member "d"', async () => {
  const f = await fed([
    await generateSigningKey('a'),
    await generateSigningKey('b'),
  ])
  const { keys } = await publicJwks(f)
  expect(keys.map((k) => k.kid)).toEqual(['a', 'b'])
  for (const k of keys) {
    expect(k.alg).toBe('ES256')
    expect(k.use).toBe('sig')
    expect(Object.keys(k).sort()).toEqual(
      ['alg', 'crv', 'kid', 'kty', 'use', 'x', 'y'].sort()
    )
  }
})

test('a token signed by the older second key still verifies against publicJwks (rotation)', async () => {
  const oldKey = await generateSigningKey('old')
  const newKey = await generateSigningKey('new')
  const signer = await fed([oldKey])
  const { token } = await mintIslandToken(signer, {
    remote: 'shop',
    identity: { sub: 'u' },
  })
  const rotated = await fed([newKey, oldKey])
  const { payload } = await jwtVerify(
    token,
    createLocalJWKSet(await publicJwks(rotated)),
    { audience: 'shop' }
  )
  expect(payload.sub).toBe('u')
})

test('reserved claim names are NF-002', async () => {
  const f = await fed([await generateSigningKey()])
  for (const name of ['iss', 'aud', 'sub', 'exp', 'iat', 'nbf', 'jti']) {
    expect(
      await codeOf(
        mintIslandToken(f, {
          remote: 'shop',
          identity: { sub: 'u', claims: { [name]: 'x' } },
        })
      )
    ).toBe('NF-002')
  }
})

test('no identity config is NF-013', async () => {
  const f = defineFederation({
    remotes: { shop: { origin: 'https://shop.example.com' } },
  })
  expect(
    await codeOf(mintIslandToken(f, { remote: 'shop', identity: { sub: 'u' } }))
  ).toBe('NF-013')
  expect(await codeOf(publicJwks(f))).toBe('NF-013')
  expect(await codeOf(identityKey(f, 'u'))).toBe('NF-013')
})

test('an unknown remote is NF-001', async () => {
  const f = await fed([await generateSigningKey()])
  expect(
    await codeOf(mintIslandToken(f, { remote: 'nope', identity: { sub: 'u' } }))
  ).toBe('NF-001')
})

test('bad signing keys are NF-002 and never echoed', async () => {
  const good = await generateSigningKey('same')
  const noKid = JSON.stringify({ ...JSON.parse(good), kid: undefined })
  const pub = JSON.stringify({ ...JSON.parse(good), d: undefined })
  const rsa = JSON.stringify({ ...JSON.parse(good), kty: 'RSA' })
  for (const bad of [noKid, pub, rsa, 'not json SECRETVALUE']) {
    const f = await fed([bad])
    try {
      await publicJwks(f)
      throw new Error('expected failure')
    } catch (e) {
      expect(isNFError(e) && e.code).toBe('NF-002')
      expect(String((e as Error).message)).not.toContain('SECRETVALUE')
    }
  }
  const dup = await fed([good, good])
  expect(await codeOf(publicJwks(dup))).toBe('NF-002')
  const d = JSON.parse(good).d as string
  let rejected: unknown
  try {
    await publicJwks(await fed([rsa]))
  } catch (e) {
    rejected = e
  }
  expect(isNFError(rejected) && rejected.code).toBe('NF-002')
  expect((rejected as Error).message).not.toContain(d)
})

test('identityKey is stable per sub, differs across subs and signing keys, and does not contain the sub', async () => {
  const f1 = await fed([await generateSigningKey('a')])
  const f2 = await fed([await generateSigningKey('a')])
  const a1 = await identityKey(f1, 'alice@example.com')
  expect(await identityKey(f1, 'alice@example.com')).toBe(a1)
  expect(await identityKey(f1, 'bob@example.com')).not.toBe(a1)
  expect(await identityKey(f2, 'alice@example.com')).not.toBe(a1)
  expect(a1).toMatch(/^[A-Za-z0-9_-]{22}$/)
  expect(a1).not.toContain('alice')
})

test('generateSigningKey output is accepted by defineFederation + mintIslandToken', async () => {
  const raw = await generateSigningKey()
  const jwk = JSON.parse(raw)
  expect(jwk.kty).toBe('EC')
  expect(jwk.crv).toBe('P-256')
  expect(jwk.kid).toMatch(/^[0-9a-f]{8}$/)
  expect(typeof jwk.d).toBe('string')
  const f = await fed([raw])
  const { token } = await mintIslandToken(f, {
    remote: 'shop',
    identity: { sub: 'u' },
  })
  expect(token.split('.')).toHaveLength(3)
})

test('validateIdentity resolves for good keys and rejects bad keys or missing identity eagerly', async () => {
  const good = await generateSigningKey('g')
  await expect(validateIdentity(await fed([good]))).resolves.toBeUndefined()
  const rsa = JSON.stringify({ ...JSON.parse(good), kty: 'RSA' })
  expect(await codeOf(validateIdentity(await fed([rsa])))).toBe('NF-002')
  expect(await codeOf(validateIdentity(await fed([good, good])))).toBe('NF-002')
  const none = defineFederation({
    remotes: { shop: { origin: 'https://shop.example.com' } },
  })
  expect(await codeOf(validateIdentity(none))).toBe('NF-013')
})
