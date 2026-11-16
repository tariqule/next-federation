// Runs on Node 20.9 against built packages, with no dev tooling.
// Imports every dist entry in every exports map; exits 1 on any failure.
// Later tasks append behavioural checks at the marked spot.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = join(root, 'packages')

// @next-federation/vite needs Node ^20.19 (vite 8), so it is exempt from the
// 20.9 floor and is import-checked only on a newer Node.
const NEEDS_NEWER_NODE = new Set(['@next-federation/vite'])
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number)
const nodeAtLeast20_19 = major > 20 || (major === 20 && minor >= 19)

function collectTargets(value, out = []) {
  if (typeof value === 'string') {
    if (value.endsWith('.js') || value.endsWith('.mjs')) out.push(value)
  } else if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) collectTargets(inner, out)
  }
  return out
}

const failures = []
const imported = new Map()

if (existsSync(packagesDir)) {
  for (const dir of readdirSync(packagesDir)) {
    const manifestPath = join(packagesDir, dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (NEEDS_NEWER_NODE.has(manifest.name) && !nodeAtLeast20_19) {
      console.log(`skip ${manifest.name} (needs Node >=20.19)`)
      continue
    }
    for (const target of new Set(collectTargets(manifest.exports))) {
      const file = join(packagesDir, dir, target)
      try {
        const mod = await import(pathToFileURL(file).href)
        imported.set(`${manifest.name}:${target}`, mod)
      } catch (error) {
        failures.push(`${manifest.name} ${target}: ${error?.message ?? error}`)
      }
    }
  }
}

// Behavioural checks (appended by later tasks) go below this line.

{
  const protocol = imported.get('@next-federation/protocol:./dist/index.js')
  if (protocol) {
    const { encodeIslandRequest, decodeIslandRequest } = protocol
    const props = { t: 'h\u00e9llo \u2713', n: [1, 2] }
    const r = encodeIslandRequest('https://r.example', 'Panel', props)
    const got = await decodeIslandRequest(new Request(r.url))
    if (
      got.island !== 'Panel' ||
      JSON.stringify(got.props) !== JSON.stringify({ n: [1, 2], t: props.t })
    ) {
      failures.push('protocol: encode/decode round trip mismatch')
    }
  }
}

{
  // Task 6: mint an island token with the built identity entry, verify it with Web Crypto.
  const identity = imported.get(
    '@next-federation/core:./dist/identity/index.js'
  )
  const core = imported.get('@next-federation/core:./dist/index.js')
  if (identity && core) {
    const { generateSigningKey, mintIslandToken, publicJwks } = identity
    const federation = core.defineFederation({
      remotes: { shop: { origin: 'https://shop.example.com' } },
      identity: {
        issuer: 'https://host.example.com',
        signingKeys: [await generateSigningKey('smoke')],
      },
    })
    await identity.validateIdentity(federation)
    const { token } = await mintIslandToken(federation, {
      remote: 'shop',
      identity: { sub: 'user-1' },
    })
    const [h, p, sig] = token.split('.')
    const b64 = (v) => Buffer.from(v, 'base64url')
    const [jwk] = (await publicJwks(federation)).keys
    const key = await globalThis.crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )
    const ok = await globalThis.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      b64(sig),
      new TextEncoder().encode(`${h}.${p}`)
    )
    const claims = JSON.parse(b64(p).toString('utf8'))
    if (
      !ok ||
      claims.aud !== 'shop' ||
      claims.sub !== 'user-1' ||
      claims.iss !== 'https://host.example.com'
    ) {
      failures.push('core/identity: mint -> verify mismatch')
    } else {
      console.log('smoke-dist: core/identity mint -> verify ok')
    }
  }
}

{
  // Task 7: the built boundary must keep its 'use client' directive.
  const file = join(packagesDir, 'react', 'dist', 'error-boundary.js')
  if (existsSync(file)) {
    if (!/^['"]use client['"]/.test(readFileSync(file, 'utf8'))) {
      failures.push('react: dist/error-boundary.js lost its "use client"')
    } else {
      console.log('smoke-dist: react error-boundary keeps "use client"')
    }
  }
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`)
  process.exit(1)
}
console.log(
  `smoke-dist: imported ${imported.size} entr(ies) on Node ${process.versions.node}`
)
