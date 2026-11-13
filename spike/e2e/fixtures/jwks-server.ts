// Test-only identity provider for e2e: serves JWKS like a host and mints tokens on request.
import { createServer } from 'node:http'
import { generateHostKeys, mintIslandToken } from '@nf-spike/proto/identity'

const ISS = 'http://localhost:3999'
const keys = await generateHostKeys('fixture-1')

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', ISS)
  if (url.pathname === '/api/nf/jwks') {
    res.setHeader('content-type', 'application/json')
    return res.end(JSON.stringify(keys.publicJwks))
  }
  if (url.pathname === '/mint') {
    const token = await mintIslandToken({
      privateJwk: keys.privateJwk,
      kid: 'fixture-1',
      iss: url.searchParams.get('iss') ?? ISS,
      aud: url.searchParams.get('aud') ?? 'a',
      sub: url.searchParams.get('sub') ?? 'user-1',
      ttlSeconds: Number(url.searchParams.get('ttl') ?? 300),
    })
    return res.end(token)
  }
  res.statusCode = 404
  res.end()
}).listen(3999, 'localhost')
