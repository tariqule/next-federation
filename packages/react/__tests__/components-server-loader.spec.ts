import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import {
  canonicalJson,
  componentTrustRegistry,
  verifiedKey,
} from '@next-federation/protocol'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  canLoadServerCode,
  createServerEntryPlugin,
  evaluateServerEntry,
  isTrustedDescriptor,
  loaderGet,
} from '../src/components/server-loader.ts'
import type { ServerLoaderOptions } from '../src/components/server-loader.ts'

const sri = (text: string) =>
  `sha384-${createHash('sha384').update(text).digest('base64')}`

let server: Server
let files: Record<string, string>
let base: string
let hits: string[]

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url!)
    if (req.url === '/b/c1/hang.js') return // never answers
    const body = files[req.url!.replace('/b/c1/', '')]
    if (body === undefined) {
      res.statusCode = 404
      return res.end()
    }
    res.end(body)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/b/c1/`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
})

const MARKER = '__nfLoaderSpecRan'
const runtime = { createInstance: () => 'host runtime' }

beforeEach(() => {
  hits = []
  delete (globalThis as Record<string, unknown>)[MARKER]
  files = {
    'remoteEntry.ssr.js': `const mf = require("@module-federation/runtime"); const c = require("./assets/c.cjs"); exports.init = () => mf.createInstance(); exports.get = () => c.value; globalThis.${MARKER} = (globalThis.${MARKER} ?? 0) + 1`,
    'assets/c.cjs':
      'const d = require("./d.cjs"); exports.value = "c+" + d.value',
    'assets/d.cjs': 'exports.value = "d"',
  }
})

function options(
  integrity: Record<string, string> = Object.fromEntries(
    Object.entries(files).map(([path, text]) => [path, sri(text)])
  )
): ServerLoaderOptions {
  return {
    integrityFor: (url) =>
      url.startsWith(base) ? { base, integrity } : undefined,
    hostModules: { '@module-federation/runtime': runtime },
  }
}

test('Node 24 can load server code (process.getBuiltinModule)', () => {
  expect(canLoadServerCode()).toBe(true)
})

test('evaluates the verified CommonJS graph with the host runtime', async () => {
  const exports = (await evaluateServerEntry(
    `${base}remoteEntry.ssr.js`,
    options()
  )) as { init: () => unknown; get: () => unknown }
  expect(exports.init()).toBe('host runtime')
  expect(exports.get()).toBe('c+d')
  expect((globalThis as Record<string, unknown>)[MARKER]).toBe(1)
})

test('a tampered chunk anywhere in the graph is NF-027 and nothing is evaluated', async () => {
  const integrity = options().integrityFor(base)!.integrity
  files['assets/d.cjs'] =
    `globalThis.${MARKER} = 'tampered'; exports.value = "evil"`
  await expect(
    evaluateServerEntry(`${base}remoteEntry.ssr.js`, options(integrity))
  ).rejects.toMatchObject({ code: 'NF-027' })
  expect((globalThis as Record<string, unknown>)[MARKER]).toBeUndefined()
})

test('a file missing from the verified descriptor is never fetched or evaluated', async () => {
  const partial = { ...options().integrityFor(base)!.integrity }
  delete partial['assets/d.cjs']
  await expect(
    evaluateServerEntry(`${base}remoteEntry.ssr.js`, options(partial))
  ).rejects.toMatchObject({ code: 'NF-027' })
  expect(hits).not.toContain('/b/c1/assets/d.cjs')
  expect((globalThis as Record<string, unknown>)[MARKER]).toBeUndefined()
})

test('a build without verified integrity is refused before any request', async () => {
  const opts: ServerLoaderOptions = {
    integrityFor: () => undefined,
    hostModules: { '@module-federation/runtime': runtime },
  }
  await expect(
    evaluateServerEntry(`${base}remoteEntry.ssr.js`, opts)
  ).rejects.toMatchObject({ code: 'NF-027' })
  expect(hits).toEqual([])
})

test('require allow-list: any bare specifier but @module-federation/runtime is NF-030', async () => {
  files['assets/d.cjs'] =
    'const React = require("react"); exports.value = React'
  await expect(
    evaluateServerEntry(`${base}remoteEntry.ssr.js`, options())
  ).rejects.toMatchObject({ code: 'NF-030' })
  files['assets/d.cjs'] = 'require("node:fs"); exports.value = 1'
  await expect(
    evaluateServerEntry(`${base}remoteEntry.ssr.js`, options())
  ).rejects.toMatchObject({ code: 'NF-030' })
})

test('the MF plugin verifies the manifest in its fetch hook', async () => {
  files['mf-manifest.json'] = '{"id":"components","remotes":[]}'
  const plugin = createServerEntryPlugin(options())
  const res = await plugin.fetch(`${base}mf-manifest.json`)!
  expect(await res.json()).toEqual({ id: 'components', remotes: [] })
  const integrity = options().integrityFor(base)!.integrity
  files['mf-manifest.json'] = '{"id":"evil","remotes":[]}'
  await expect(
    createServerEntryPlugin(options(integrity)).fetch(`${base}mf-manifest.json`)
  ).rejects.toMatchObject({ code: 'NF-027' })
  const exports = (await plugin.loadEntry({
    remoteInfo: { entry: `${base}remoteEntry.ssr.js` },
  })) as { get: () => unknown }
  expect(exports.get()).toBe('c+d')
})

test('loader I/O times out (3 s by default) and refuses other schemes', async () => {
  const started = performance.now()
  await expect(loaderGet(`${base}hang.js`, 100)).rejects.toMatchObject({
    code: 'NF-029',
  })
  expect(performance.now() - started).toBeLessThan(2000)
  await expect(loaderGet('file:///etc/passwd')).rejects.toMatchObject({
    code: 'NF-029',
  })
})

test('an HTTP error is NF-029', async () => {
  files = {}
  await expect(
    evaluateServerEntry(`${base}remoteEntry.ssr.js`, {
      ...options({ 'remoteEntry.ssr.js': sri('x') }),
    })
  ).rejects.toMatchObject({ code: 'NF-029' })
})

describe('fix round 1: server-side trust', () => {
  const registry = () =>
    (globalThis as Record<symbol, unknown>)[
      Symbol.for('nf.components.verified')
    ] as
      | { verified: Map<string, string>; trust: Map<string, unknown[]> }
      | undefined

  function keyPair() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    })
    const pub = {
      ...(publicKey.export({ format: 'jwk' }) as {
        kty: 'EC'
        crv: 'P-256'
        x: string
        y: string
      }),
      kid: 'k1',
    }
    return { privateKey, pub }
  }
  const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url')
  function jwsOf(payloadJson: string, privateKey: KeyObject) {
    const input = `${b64(JSON.stringify({ alg: 'ES256', kid: 'k1', typ: 'nf-components+jws' }))}.${b64(payloadJson)}`
    const sig = sign('sha256', Buffer.from(input), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    })
    return `${input}.${b64(sig)}`
  }
  const d = (overrides: Record<string, unknown> = {}) => ({
    remote: 'trusted-remote',
    name: 'components',
    buildId: 't1',
    base: 'http://127.0.0.1:1/b/t1/',
    manifest: 'http://127.0.0.1:1/b/t1/mf-manifest.json',
    ssr: { integrity: { 'mf-manifest.json': 'sha384-AAAA' } },
    maxBuilds: 5,
    ...overrides,
  })
  const canonicalOf = (x: ReturnType<typeof d>) =>
    canonicalJson({
      v: 1,
      name: x.name,
      buildId: x.buildId,
      base: x.base,
      manifest: x.manifest,
      ssr: x.ssr,
      iat: (x as { iat?: number }).iat,
    })

  afterEach(() => {
    registry()?.verified.clear()
    registry()?.trust.delete('trusted-remote')
  })

  test('a descriptor nobody verified (a forged prop) is not trusted', () => {
    expect(isTrustedDescriptor(d())).toBe(false)
  })

  test('a descriptor whose digest was recorded by verification is trusted', () => {
    const digest = `sha384-${createHash('sha384').update(canonicalOf(d())).digest('base64')}`
    componentTrustRegistry().verified.set(
      verifiedKey('trusted-remote', digest),
      'signature'
    )
    expect(isTrustedDescriptor(d())).toBe(true)
    // Any change to what would be evaluated breaks it.
    expect(
      isTrustedDescriptor(
        d({ ssr: { integrity: { 'mf-manifest.json': 'sha384-BBBB' } } })
      )
    ).toBe(false)
  })

  test('a `refused` field is outside the trusted payload: the descriptor stays trusted', () => {
    const digest = `sha384-${createHash('sha384').update(canonicalOf(d())).digest('base64')}`
    componentTrustRegistry().verified.set(
      verifiedKey('trusted-remote', digest),
      'signature'
    )
    expect(isTrustedDescriptor(d({ refused: { code: 'NF-027' } }))).toBe(true)
  })

  test('the assets (stylesheets, chunks) are covered: a changed stylesheet URL is not trusted', () => {
    const assets = {
      entry: 'http://127.0.0.1:1/b/t1/remoteEntry.js',
      exposes: {
        './Counter': {
          css: ['http://127.0.0.1:1/b/t1/assets/a.css'],
          js: ['http://127.0.0.1:1/b/t1/assets/a.js'],
        },
      },
    }
    const signed = { ...d(), assets }
    const digest = `sha384-${createHash('sha384')
      .update(canonicalJson({ ...JSON.parse(canonicalOf(d())), assets }))
      .digest('base64')}`
    componentTrustRegistry().verified.set(
      verifiedKey('trusted-remote', digest),
      'signature'
    )
    expect(isTrustedDescriptor(signed)).toBe(true)
    expect(isTrustedDescriptor(d())).toBe(false)
    expect(
      isTrustedDescriptor({
        ...signed,
        assets: {
          ...assets,
          exposes: {
            './Counter': {
              ...assets.exposes['./Counter'],
              css: ['http://127.0.0.1:1/b/t1/assets/evil.css'],
            },
          },
        },
      })
    ).toBe(false)
  })

  test('the shared requirements are covered: a relaxed requirement is not trusted', () => {
    const shared = {
      'components-context': { requiredVersion: '^1.0.0', fallback: false },
    }
    const signed = { ...d(), shared }
    const digest = `sha384-${createHash('sha384')
      .update(canonicalJson({ ...JSON.parse(canonicalOf(d())), shared }))
      .digest('base64')}`
    componentTrustRegistry().verified.set(
      verifiedKey('trusted-remote', digest),
      'signature'
    )
    expect(isTrustedDescriptor(signed)).toBe(true)
    expect(
      isTrustedDescriptor({
        ...signed,
        shared: {
          'components-context': { requiredVersion: false, fallback: true },
        },
      })
    ).toBe(false)
  })

  test('the type declarations are covered: a signed descriptor with types is trusted, a changed index hash is not', () => {
    const types = {
      index: `${d().base}@mf-types/index.json`,
      integrity: `sha384-${'A'.repeat(64)}`,
    }
    const signed = { ...d(), types }
    const digest = `sha384-${createHash('sha384')
      .update(canonicalJson({ ...JSON.parse(canonicalOf(d())), types }))
      .digest('base64')}`
    componentTrustRegistry().verified.set(
      verifiedKey('trusted-remote', digest),
      'signature'
    )
    expect(isTrustedDescriptor(signed)).toBe(true)
    expect(
      isTrustedDescriptor({
        ...signed,
        types: { ...types, integrity: `sha384-${'B'.repeat(64)}` },
      })
    ).toBe(false)
  })

  test('cache hit after a restart: re-verified from the carried jws against registered keys', () => {
    const { privateKey, pub } = keyPair()
    const signed = d({ iat: 100 })
    const jws = jwsOf(canonicalOf(signed), privateKey)
    expect(isTrustedDescriptor({ ...signed, jws })).toBe(false) // no keys registered yet
    componentTrustRegistry().trust.set('trusted-remote', [
      {
        publicKeys: [pub],
        pinned: {},
        unsafeDev: false,
        maxAgeSeconds: null,
        name: null,
        allowedOrigins: ['http://127.0.0.1:1'],
      },
    ])
    expect(isTrustedDescriptor({ ...signed, jws })).toBe(true)
    expect(componentTrustRegistry().verified.size).toBe(1)
    // A jws over a different payload does not cover this descriptor.
    componentTrustRegistry().verified.clear()
    const forged = d({
      iat: 100,
      ssr: { integrity: { 'mf-manifest.json': 'sha384-EVIL' } },
    })
    expect(isTrustedDescriptor({ ...forged, jws })).toBe(false)
    // Another key does not verify.
    componentTrustRegistry().trust.set('trusted-remote', [
      {
        publicKeys: [keyPair().pub],
        pinned: {},
        unsafeDev: false,
        maxAgeSeconds: null,
        name: null,
        allowedOrigins: ['http://127.0.0.1:1'],
      },
    ])
    expect(isTrustedDescriptor({ ...signed, jws })).toBe(false)
  })

  test('re-verification honours pins, the container name and maxAge', () => {
    const digest = `sha384-${createHash('sha384').update(canonicalOf(d())).digest('base64')}`
    componentTrustRegistry().trust.set('trusted-remote', [
      {
        publicKeys: [],
        pinned: { t1: digest },
        unsafeDev: false,
        maxAgeSeconds: null,
        name: 'other',
        allowedOrigins: ['http://127.0.0.1:1'],
      },
    ])
    expect(isTrustedDescriptor(d())).toBe(false)
    componentTrustRegistry().trust.set('trusted-remote', [
      {
        publicKeys: [],
        pinned: { t1: digest },
        unsafeDev: false,
        maxAgeSeconds: null,
        name: null,
        allowedOrigins: ['http://127.0.0.1:1'],
      },
    ])
    expect(isTrustedDescriptor(d())).toBe(true)
    componentTrustRegistry().verified.clear()
    const { privateKey, pub } = keyPair()
    const old = d({ iat: 1 })
    componentTrustRegistry().trust.set('trusted-remote', [
      {
        publicKeys: [pub],
        pinned: {},
        unsafeDev: false,
        maxAgeSeconds: 60,
        name: null,
        allowedOrigins: ['http://127.0.0.1:1'],
      },
    ])
    expect(
      isTrustedDescriptor({ ...old, jws: jwsOf(canonicalOf(old), privateKey) })
    ).toBe(false)
  })

  test('maxAge bounds signed builds only: a pinned build stays trusted on both paths', () => {
    const pinnedOld = d({ iat: 1 })
    const digest = `sha384-${createHash('sha384').update(canonicalOf(pinnedOld)).digest('base64')}`
    const policy = {
      publicKeys: [],
      pinned: { t1: digest },
      unsafeDev: false,
      maxAgeSeconds: 60,
      name: null,
      allowedOrigins: ['http://127.0.0.1:1'],
    }
    componentTrustRegistry().trust.set('trusted-remote', [policy])
    // Re-verification from the pin ignores maxAge, and records the kind.
    expect(isTrustedDescriptor(pinnedOld)).toBe(true)
    expect(
      componentTrustRegistry().verified.get(
        verifiedKey('trusted-remote', digest)
      )
    ).toBe('pinned')
    // Recorded by core as pinned: still trusted although iat is old.
    componentTrustRegistry().verified.clear()
    componentTrustRegistry().verified.set(
      verifiedKey('trusted-remote', digest),
      'pinned'
    )
    expect(isTrustedDescriptor(pinnedOld)).toBe(true)
    // A build time far in the future is refused on this path too.
    const ahead = d({ iat: Math.floor(Date.now() / 1000) + 600 })
    const aheadDigest = `sha384-${createHash('sha384').update(canonicalOf(ahead)).digest('base64')}`
    componentTrustRegistry().trust.set('trusted-remote', [
      { ...policy, pinned: { t1: aheadDigest } },
    ])
    expect(isTrustedDescriptor(ahead)).toBe(false)
    componentTrustRegistry().trust.set('trusted-remote', [policy])
    // Recorded as signed: the same old iat is out of maxAge.
    componentTrustRegistry().verified.set(
      verifiedKey('trusted-remote', digest),
      'signature'
    )
    expect(isTrustedDescriptor(pinnedOld)).toBe(false)
  })

  test('require() matches in strings or comments that are not in the descriptor are not fetched', async () => {
    files['assets/d.cjs'] =
      '// require("./not-listed.cjs")\nexports.value = "d"; const s = \'require("./also-not.cjs")\''
    const exports = (await evaluateServerEntry(
      `${base}remoteEntry.ssr.js`,
      options()
    )) as { get: () => unknown }
    expect(exports.get()).toBe('c+d')
    expect(hits).not.toContain('/b/c1/assets/not-listed.cjs')
  })

  test('a runtime require of an unlisted file is NF-027', async () => {
    files['assets/d.cjs'] = 'exports.value = require("./not-listed.cjs")'
    await expect(
      evaluateServerEntry(`${base}remoteEntry.ssr.js`, options())
    ).rejects.toMatchObject({ code: 'NF-027' })
  })
})

describe('fix round 2', () => {
  const policy = (over: Record<string, unknown> = {}) => ({
    publicKeys: [],
    pinned: {},
    unsafeDev: false,
    maxAgeSeconds: null,
    name: null,
    allowedOrigins: ['http://127.0.0.1:1'],
    ...over,
  })
  const d = (over: Record<string, unknown> = {}) => ({
    remote: 'r2-remote',
    name: 'components',
    buildId: 'z1',
    base: 'http://127.0.0.1:1/b/z1/',
    manifest: 'http://127.0.0.1:1/b/z1/mf-manifest.json',
    ssr: { integrity: { 'mf-manifest.json': 'sha384-AAAA' } },
    maxBuilds: 5,
    ...over,
  })
  const digestOf = (x: ReturnType<typeof d>) =>
    `sha384-${createHash('sha384')
      .update(
        canonicalJson({
          v: 1,
          name: x.name,
          buildId: x.buildId,
          base: x.base,
          manifest: x.manifest,
          ssr: x.ssr,
          iat: (x as { iat?: number }).iat,
        })
      )
      .digest('base64')}`
  afterEach(() => {
    componentTrustRegistry().verified.clear()
    componentTrustRegistry().trust.delete('r2-remote')
    componentTrustRegistry().trust.delete('other-remote')
  })

  test('1: no process.getBuiltinModule (Node < 20.16): false, never a TypeError', () => {
    const proc = process as { getBuiltinModule?: unknown }
    const saved = proc.getBuiltinModule
    componentTrustRegistry().trust.set('r2-remote', [
      policy({ unsafeDev: true }),
    ])
    proc.getBuiltinModule = undefined
    try {
      expect(isTrustedDescriptor(d() as never)).toBe(false)
    } finally {
      proc.getBuiltinModule = saved
    }
  })

  test('4: re-verification checks the build origin against the remote origins (unsafe-dev too)', () => {
    componentTrustRegistry().trust.set('r2-remote', [
      policy({ unsafeDev: true }),
    ])
    expect(isTrustedDescriptor(d() as never)).toBe(true)
    componentTrustRegistry().verified.clear()
    const foreign = d({
      base: 'http://evil.example/b/z1/',
      manifest: 'http://evil.example/b/z1/mf-manifest.json',
    })
    expect(isTrustedDescriptor(foreign as never)).toBe(false)
  })

  test('5: a verified digest is bound to its remote', () => {
    componentTrustRegistry().verified.set(
      verifiedKey('other-remote', digestOf(d())),
      'signature'
    )
    expect(isTrustedDescriptor(d() as never)).toBe(false)
    componentTrustRegistry().verified.set(
      verifiedKey('r2-remote', digestOf(d())),
      'signature'
    )
    expect(isTrustedDescriptor(d() as never)).toBe(true)
  })

  test('5: maxAge applies to signed registry hits too', () => {
    const old = d({ iat: 1 })
    componentTrustRegistry().verified.set(
      verifiedKey('r2-remote', digestOf(old)),
      'signature'
    )
    componentTrustRegistry().trust.set('r2-remote', [
      policy({ maxAgeSeconds: 60 }),
    ])
    expect(isTrustedDescriptor(old as never)).toBe(false)
    componentTrustRegistry().trust.set('r2-remote', [policy()])
    expect(isTrustedDescriptor(old as never)).toBe(true)
  })
})
