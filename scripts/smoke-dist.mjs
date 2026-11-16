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

// Entries that import Next's bare subpaths (`next/cache`, `next/navigation`).
// Next has no exports map, so plain Node ESM cannot resolve them; only Next's
// bundlers can. They are checked structurally below instead of imported.
const NEXT_BUNDLER_ONLY = new Set([
  '@next-federation/next:./dist/server/island-cache.cc.js',
])
// Next runtime entries (`next/headers`, `next/navigation`, `server-only`):
// also resolvable only by Next's bundlers. Checked for existence below.
const NEXT_RUNTIME_ONLY = new Set([
  '@next-federation/next:./dist/routes.js',
  '@next-federation/next:./dist/server/index.js',
  // `next/head`, `next/router`.
  '@next-federation/next:./dist/pages/index.js',
])

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
      if (NEXT_BUNDLER_ONLY.has(`${manifest.name}:${target}`)) continue
      if (NEXT_RUNTIME_ONLY.has(`${manifest.name}:${target}`)) continue
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

for (const key of NEXT_RUNTIME_ONLY) {
  const [name, target] = key.split(':')
  if (!existsSync(join(packagesDir, name.split('/')[1], target))) {
    failures.push(`${name} ${target}: missing`)
  }
}

{
  const before = failures.length
  for (const key of NEXT_BUNDLER_ONLY) {
    const [name, target] = key.split(':')
    const file = join(packagesDir, name.split('/')[1], target)
    if (!existsSync(file)) {
      failures.push(`${name} ${target}: missing`)
      continue
    }
    const text = readFileSync(file, 'utf8')
    if (!text.includes('"use cache"') || !text.includes('from "next/cache"')) {
      failures.push(`${name} ${target}: 'use cache' or next/cache import lost`)
    }
  }
  if (failures.length === before) {
    console.log('smoke-dist: next island-cache (structural) ok')
  }
}

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

{
  // Task 16: the built island mount keeps 'use client' and the bundler-ignore
  // comments on the bootstrap import(), so host bundlers leave the remote URL alone.
  const file = join(packagesDir, 'react', 'dist', 'island-mount.js')
  if (existsSync(file)) {
    const source = readFileSync(file, 'utf8')
    const call = /import\(\s*((?:\/\*[^]*?\*\/\s*)+)url\s*\)/.exec(source)
    const comments = call?.[1] ?? ''
    const missing = [
      'webpackIgnore: true',
      'turbopackIgnore: true',
      '@vite-ignore',
    ].filter((c) => !comments.includes(c))
    if (!/^['"]use client['"]/.test(source)) {
      failures.push('react: dist/island-mount.js lost its "use client"')
    } else if (missing.length > 0) {
      failures.push(
        `react: dist/island-mount.js bootstrap import() lost ${missing.join(', ')}`
      )
    } else {
      console.log(
        'smoke-dist: react island-mount keeps "use client" and import() ignore comments'
      )
    }
  }
}

{
  // Task 10: the built server verifier accepts a token minted by built core/identity.
  const server = imported.get('@next-federation/server:./dist/index.js')
  const identity = imported.get(
    '@next-federation/core:./dist/identity/index.js'
  )
  const core = imported.get('@next-federation/core:./dist/index.js')
  if (server && identity && core) {
    const { createServer } = await import('node:http')
    const issuer = 'https://host.example.com'
    const federation = core.defineFederation({
      remotes: { shop: { origin: 'https://shop.example.com' } },
      identity: {
        issuer,
        signingKeys: [await identity.generateSigningKey('smoke')],
      },
    })
    const jwks = JSON.stringify(await identity.publicJwks(federation))
    const http = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(jwks)
    })
    await new Promise((r) => http.listen(0, '127.0.0.1', r))
    try {
      const verify = server.createIdentityVerifier({
        audience: 'shop',
        issuers: { [issuer]: `http://127.0.0.1:${http.address().port}/jwks` },
      })
      const { token } = await identity.mintIslandToken(federation, {
        remote: 'shop',
        identity: { sub: 'user-1' },
      })
      const out = await verify(
        new Request('https://shop.example.com/', {
          headers: { authorization: `Bearer ${token}` },
        })
      )
      const seen = await server.runWithIdentity(
        out.kind === 'verified' ? out.identity : null,
        async () => server.getIdentity()?.sub
      )
      if (out.kind !== 'verified' || seen !== 'user-1') {
        failures.push('server/identity: built verify of a core token failed')
      } else {
        console.log('smoke-dist: server identity verify (core token) ok')
      }
    } finally {
      http.close()
    }
  }
}

{
  // Task 12: the built multi-build server runs each build in a child process and 410s retired builds.
  const node = imported.get('@next-federation/server:./dist/node/index.js')
  if (node) {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
      await import('node:fs')
    const { tmpdir } = await import('node:os')
    const dir = mkdtempSync(join(tmpdir(), 'nf-smoke-'))
    let served
    try {
      mkdirSync(join(dir, 'b1', 'rsc'), { recursive: true })
      writeFileSync(
        join(dir, 'b1', 'nf-build.json'),
        JSON.stringify({ buildId: 'b1', builtAt: Date.now() })
      )
      writeFileSync(
        join(dir, 'b1', 'rsc', 'index.js'),
        'export default async () => new Response(`${process.pid}:${process.env.NODE_ENV}`)'
      )
      served = await node.serveBuilds({ dir, port: 0 })
      const base = `http://127.0.0.1:${served.port}`
      const [pid, env] = (await (await fetch(`${base}/_nf/x`)).text()).split(
        ':'
      )
      const gone = await fetch(`${base}/b/old/_nf/x`)
      if (
        Number(pid) === process.pid ||
        env !== 'production' ||
        gone.status !== 410 ||
        (await gone.json()).error !== 'NF-023'
      ) {
        failures.push('server/node: built serveBuilds behaved unexpectedly')
      } else {
        console.log('smoke-dist: server/node serveBuilds ok')
      }
    } catch (error) {
      failures.push(`server/node: ${error?.message ?? error}`)
    } finally {
      await served?.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

{
  // island: dist-shape checks (client entry stays server-free; 'use client' survives the build).
  const islandDist = join(packagesDir, 'island', 'dist')
  if (existsSync(islandDist)) {
    const read = (f) => readFileSync(join(islandDist, f), 'utf8')
    if (/async_hooks/.test(read('index.client.js'))) {
      failures.push('island: index.client.js imports node:async_hooks')
    }
    if (/@next-federation\/server/.test(read('index.client.js'))) {
      failures.push('island: index.client.js imports @next-federation/server')
    }
    if (!/@next-federation\/server/.test(read('index.server.js'))) {
      failures.push('island: index.server.js does not re-export the server')
    }
    for (const f of ['link.js', 'bridge-context.js']) {
      if (!/^['"]use client['"]/.test(read(f))) {
        failures.push(`island: ${f} does not start with "use client"`)
      }
    }
    console.log('smoke-dist: island dist checks ok')
  }
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`)
  process.exit(1)
}
console.log(
  `smoke-dist: imported ${imported.size} entr(ies) on Node ${process.versions.node}`
)
