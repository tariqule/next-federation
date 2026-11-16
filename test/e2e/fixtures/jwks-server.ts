// Test-only identity provider (port 3999): publishes a JWKS like a host does
// and mints island tokens on request.
//   GET /jwks                                   the public keys
//   GET /mint?aud=&sub=&ttl=&iss=               an ES256 token (ttl in s; a negative
//                                               ttl gives a token expired by more than
//                                               the verifier's clock skew)
import { createServer } from 'node:http'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'

const PORT = Number(process.env.PORT ?? 3999)
const ISS = `http://localhost:${PORT}`
const KID = 'fixture-1'

const { privateKey, publicKey } = await generateKeyPair('ES256')
const jwks = {
  keys: [
    { ...(await exportJWK(publicKey)), kid: KID, alg: 'ES256', use: 'sig' },
  ],
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', ISS)
  // Test-only: the SPA host fetches tokens cross-origin.
  res.setHeader('access-control-allow-origin', '*')
  if (url.pathname === '/jwks') {
    res.setHeader('content-type', 'application/json')
    return res.end(JSON.stringify(jwks))
  }
  if (url.pathname === '/mint') {
    const now = Math.floor(Date.now() / 1000)
    const ttl = Number(url.searchParams.get('ttl') ?? 300)
    const exp = ttl < 0 ? now + ttl - 120 : now + ttl
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setIssuer(url.searchParams.get('iss') ?? ISS)
      .setAudience(url.searchParams.get('aud') ?? 'a')
      .setSubject(url.searchParams.get('sub') ?? 'user-1')
      .setIssuedAt(ttl < 0 ? exp - 60 : now)
      .setExpirationTime(exp)
      .sign(privateKey)
    res.setHeader('content-type', 'text/plain')
    return res.end(token)
  }
  res.statusCode = 404
  res.end()
}).listen(PORT, 'localhost')
