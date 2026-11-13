import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { IdentityError, generateHostKeys, getIdentity, mintIslandToken, runWithIdentity, verifyIslandToken } from '../src/identity'

let server: Server
let jwksUrl = ''
let host: Awaited<ReturnType<typeof generateHostKeys>>
let other: Awaited<ReturnType<typeof generateHostKeys>>
const iss = 'http://localhost:3000'

beforeAll(async () => {
  host = await generateHostKeys('k1')
  other = await generateHostKeys('k1')
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(host.publicJwks))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  jwksUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks`
})
afterAll(() => server.close())

const mint = (over: Partial<Parameters<typeof mintIslandToken>[0]> = {}) =>
  mintIslandToken({ privateJwk: host.privateJwk, kid: 'k1', iss, aud: 'a', sub: 'user-1', ...over })

describe('island identity tokens', () => {
  test('mint → verify returns the subject and custom claims', async () => {
    const claims = await verifyIslandToken(await mint({ claims: { plan: 'pro' } }), { jwksUrl, aud: 'a', issuers: [iss] })
    expect(claims.sub).toBe('user-1')
    expect(claims.plan).toBe('pro')
  })

  test('default lifetime is 300 seconds', async () => {
    const token = await mint()
    const { exp, iat } = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString())
    expect(exp - iat).toBe(300)
  })

  test('an expired token is rejected', async () => {
    await expect(verifyIslandToken(await mint({ ttlSeconds: -1 }), { jwksUrl, aud: 'a', issuers: [iss] })).rejects.toBeInstanceOf(IdentityError)
  })

  test('a token for another remote (aud) is rejected', async () => {
    await expect(verifyIslandToken(await mint({ aud: 'b' }), { jwksUrl, aud: 'a', issuers: [iss] })).rejects.toBeInstanceOf(IdentityError)
  })

  test('a token from an issuer not on the allowlist is rejected', async () => {
    await expect(verifyIslandToken(await mint({ iss: 'http://evil.test' }), { jwksUrl, aud: 'a', issuers: [iss] })).rejects.toBeInstanceOf(IdentityError)
  })

  test('a token signed by a different key is rejected', async () => {
    const forged = await mintIslandToken({ privateJwk: other.privateJwk, kid: 'k1', iss, aud: 'a', sub: 'user-1' })
    await expect(verifyIslandToken(forged, { jwksUrl, aud: 'a', issuers: [iss] })).rejects.toBeInstanceOf(IdentityError)
  })

  test('getIdentity returns the identity only inside runWithIdentity', async () => {
    expect(getIdentity()).toBeUndefined()
    const seen = await runWithIdentity({ sub: 'user-9' }, async () => getIdentity()?.sub)
    expect(seen).toBe('user-9')
  })
})
