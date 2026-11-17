import { generateKeyPairSync } from 'node:crypto'
import {
  componentDescriptorDigest,
  componentTrustRegistry,
  verifiedKey,
} from '@next-federation/protocol'
import type {
  ComponentBuildDescriptor,
  ComponentDescriptorFile,
} from '@next-federation/protocol'
import { isNFError } from '@next-federation/sdk'
import { CompactSign, importJWK } from 'jose'
import type { JWK } from 'jose'
import {
  fetchComponentDescriptor,
  readBodyLimited,
  verifyComponentDescriptor,
  verifyDescriptorTrust,
} from '../src/components.ts'
import { defineFederation } from '../src/config.ts'

const ORIGIN = 'https://remote.example'
const BASE = `${ORIGIN}/b/c1/`

function keyPair(kid: string): { priv: JWK; pub: JWK } {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const priv = { ...(privateKey.export({ format: 'jwk' }) as JWK), kid }
  const pub = { ...priv }
  delete pub.d
  return { priv, pub }
}

const payload: ComponentBuildDescriptor = {
  v: 1,
  name: 'components',
  buildId: 'c1',
  base: BASE,
  manifest: `${BASE}mf-manifest.json`,
  ssr: { integrity: { 'mf-manifest.json': 'sha384-AAAA' } },
}

async function sign(p: ComponentBuildDescriptor, priv: JWK): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(sorted(p)))
  return new CompactSign(bytes)
    .setProtectedHeader({
      alg: 'ES256',
      kid: priv.kid,
      typ: 'nf-components+jws',
    })
    .sign(await importJWK(priv, 'ES256'))
}

// canonicalJson order (keys sorted, recursively).
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sorted((value as Record<string, unknown>)[k])])
    )
  }
  return value
}

async function file(
  p: ComponentBuildDescriptor = payload,
  jws?: string
): Promise<ComponentDescriptorFile> {
  const digest = await componentDescriptorDigest(p)
  return jws ? { ...p, digest, jws } : { ...p, digest }
}

function federationWith(components: Record<string, unknown>) {
  return defineFederation({
    remotes: { components: { origin: ORIGIN, components } as never },
  })
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (error) {
    return isNFError(error) ? error.code : `not an NFError: ${String(error)}`
  }
  return undefined
}

afterEach(() => {
  rs.unstubAllEnvs()
})

test('a remote gets a components target with defaults', () => {
  const target = federationWith({}).componentTarget('components')
  expect(target).toEqual({
    remote: 'components',
    descriptorUrl: `${ORIGIN}/_nf/components.json`,
    allowedOrigins: [ORIGIN],
    timeoutMs: 3000,
    revalidate: 60,
    maxBuilds: 5,
    name: null,
    ssr: { publicKeys: [], pinned: {}, unsafeDev: false, maxAgeSeconds: null },
  })
  expect(federationWith({ ssr: false }).componentTarget('components').ssr).toBe(
    null
  )
})

test('componentTarget throws NF-001 for an unknown remote, NF-002 without `components`', () => {
  const federation = defineFederation({ remotes: { a: { origin: ORIGIN } } })
  expect(codeOf(() => federation.componentTarget('zzz'))).toBe('NF-001')
  expect(codeOf(() => federation.componentTarget('a'))).toBe('NF-002')
})

test.each([
  ['a non-JWK public key', { ssr: { publicKeys: ['x'] } }],
  ['a private key as public key', { ssr: { publicKeys: [keyPair('p').priv] } }],
  ['a bad pinned digest', { ssr: { pinned: { c1: 'md5-x' } } }],
  ['an unknown integrity mode', { ssr: { integrity: 'none' } }],
  ['maxBuilds 0', { maxBuilds: 0 }],
  [
    'a descriptor URL on another origin',
    { descriptor: 'https://evil.example/d.json' },
  ],
])('rejects %s (NF-002)', (_label, components) => {
  expect(codeOf(() => federationWith(components))).toBe('NF-002')
})

test("integrity: 'unsafe-dev' is NF-002 in production", () => {
  rs.stubEnv('NODE_ENV', 'production')
  expect(
    codeOf(() => federationWith({ ssr: { integrity: 'unsafe-dev' } }))
  ).toBe('NF-002')
  rs.stubEnv('NODE_ENV', 'development')
  expect(
    federationWith({ ssr: { integrity: 'unsafe-dev' } }).componentTarget(
      'components'
    ).ssr?.unsafeDev
  ).toBe(true)
})

test('a signed descriptor verified with the configured key keeps SSR', async () => {
  const { priv, pub } = keyPair('k1')
  const target = federationWith({ ssr: { publicKeys: [pub] } }).componentTarget(
    'components'
  )
  const result = await verifyComponentDescriptor(
    target,
    await file(payload, await sign(payload, priv))
  )
  expect(result.trust).toBe('signature')
  expect(result.descriptor).toEqual({
    remote: 'components',
    name: 'components',
    buildId: 'c1',
    base: BASE,
    manifest: `${BASE}mf-manifest.json`,
    ssr: payload.ssr,
    maxBuilds: 5,
    jws: expect.any(String),
  })
})

test('key rotation: any configured key verifies (old and new)', async () => {
  const oldKey = keyPair('old')
  const newKey = keyPair('new')
  const target = federationWith({
    ssr: { publicKeys: [newKey.pub, oldKey.pub] },
  }).componentTarget('components')
  for (const priv of [oldKey.priv, newKey.priv]) {
    const result = await verifyComponentDescriptor(
      target,
      await file(payload, await sign(payload, priv))
    )
    expect(result.trust).toBe('signature')
    expect(result.descriptor.ssr).not.toBeNull()
  }
  // A key without kid is tried too.
  const noKid = { ...oldKey.pub }
  delete noKid.kid
  const target2 = federationWith({
    ssr: { publicKeys: [noKid] },
  }).componentTarget('components')
  expect(
    (
      await verifyComponentDescriptor(
        target2,
        await file(payload, await sign(payload, oldKey.priv))
      )
    ).trust
  ).toBe('signature')
})

test('a signature from an unknown key is NF-027 and browser-only', async () => {
  const { pub } = keyPair('k1')
  const other = keyPair('k1')
  const target = federationWith({ ssr: { publicKeys: [pub] } }).componentTarget(
    'components'
  )
  const result = await verifyComponentDescriptor(
    target,
    await file(payload, await sign(payload, other.priv))
  )
  expect(result.trust).toBeNull()
  expect(result.code).toBe('NF-027')
  expect(result.descriptor.ssr).toBeNull()
  expect(result.descriptor.buildId).toBe('c1')
})

test('a descriptor whose fields differ from its signed payload is NF-027', async () => {
  const { priv, pub } = keyPair('k1')
  const target = federationWith({ ssr: { publicKeys: [pub] } }).componentTarget(
    'components'
  )
  const jws = await sign(payload, priv)
  const swapped = {
    ...payload,
    ssr: { integrity: { 'mf-manifest.json': 'sha384-BBBB' } },
  }
  const result = await verifyComponentDescriptor(
    target,
    await file(swapped, jws)
  )
  expect(result.code).toBe('NF-027')
  expect(result.descriptor.ssr).toBeNull()
})

test('a pinned buildId -> digest pair keeps SSR; a different digest is NF-027', async () => {
  const digest = await componentDescriptorDigest(payload)
  const pinned = federationWith({
    ssr: { pinned: { c1: digest } },
  }).componentTarget('components')
  const ok = await verifyComponentDescriptor(pinned, await file())
  expect(ok.trust).toBe('pinned')
  expect(ok.descriptor.ssr).toEqual(payload.ssr)

  const wrong = federationWith({
    ssr: { pinned: { c1: 'sha384-AAAAAAAA' } },
  }).componentTarget('components')
  const bad = await verifyComponentDescriptor(wrong, await file())
  expect(bad.code).toBe('NF-027')
  expect(bad.descriptor.ssr).toBeNull()
})

test('an unsigned descriptor without a pin renders browser-only (NF-028)', async () => {
  const { pub } = keyPair('k1')
  const target = federationWith({ ssr: { publicKeys: [pub] } }).componentTarget(
    'components'
  )
  const result = await verifyComponentDescriptor(target, await file())
  expect(result.trust).toBeNull()
  expect(result.code).toBe('NF-028')
  expect(result.descriptor.ssr).toBeNull()
})

test("'unsafe-dev' trusts the descriptor as served (dev only)", async () => {
  const target = federationWith({
    ssr: { integrity: 'unsafe-dev' },
  }).componentTarget('components')
  const result = await verifyComponentDescriptor(target, await file())
  expect(result.trust).toBe('unsafe-dev')
  expect(result.descriptor.ssr).toEqual(payload.ssr)
})

test('ssr: false never evaluates server code and does not warn', async () => {
  const target = federationWith({ ssr: false }).componentTarget('components')
  const result = await verifyComponentDescriptor(target, await file())
  expect(result.descriptor.ssr).toBeNull()
  expect(result.code).toBeUndefined()
})

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  })

test('fetchComponentDescriptor returns the parsed file', async () => {
  const target = federationWith({}).componentTarget('components')
  const seen: Array<{ url: string; init: RequestInit }> = []
  const result = await fetchComponentDescriptor(target, {
    fetch: async (url, init) => {
      seen.push({ url: String(url), init: init ?? {} })
      return okResponse(await file())
    },
    init: { cache: 'no-store' },
  })
  expect(result.ok && result.file.buildId).toBe('c1')
  expect(seen[0]!.url).toBe(`${ORIGIN}/_nf/components.json`)
  expect(seen[0]!.init).toMatchObject({
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  })
})

test('fetchComponentDescriptor fails with NF-029 (HTTP, JSON, shape) and NF-005 (foreign base)', async () => {
  const target = federationWith({}).componentTarget('components')
  const run = (respond: () => Response | Promise<Response>) =>
    fetchComponentDescriptor(target, { fetch: async () => respond() })
  expect(await run(() => new Response('x', { status: 503 }))).toMatchObject({
    ok: false,
    code: 'NF-029',
    status: 503,
  })
  expect(await run(() => new Response('{'))).toMatchObject({
    ok: false,
    code: 'NF-029',
  })
  expect(await run(() => okResponse({ v: 9 }))).toMatchObject({
    ok: false,
    code: 'NF-029',
  })
  const foreign = {
    ...payload,
    base: 'https://evil.example/b/c1/',
    manifest: 'https://evil.example/b/c1/mf-manifest.json',
  }
  expect(await run(async () => okResponse(await file(foreign)))).toMatchObject({
    ok: false,
    code: 'NF-005',
  })
  expect(
    await run(() => {
      throw new TypeError('fetch failed')
    })
  ).toMatchObject({ ok: false, code: 'NF-029' })
})

test('fetchComponentDescriptor times out after timeoutMs (NF-029)', async () => {
  const target = {
    ...federationWith({}).componentTarget('components'),
    timeoutMs: 50,
  }
  const started = performance.now()
  const result = await fetchComponentDescriptor(target, {
    fetch: (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        )
      }),
  })
  expect(result).toMatchObject({ ok: false, code: 'NF-029' })
  expect(performance.now() - started).toBeLessThan(1000)
})

describe('fix round 1', () => {
  test("'unsafe-dev' is allowed only when NODE_ENV is development or test", () => {
    for (const env of ['production', 'staging', '']) {
      rs.stubEnv('NODE_ENV', env)
      expect(
        codeOf(() => federationWith({ ssr: { integrity: 'unsafe-dev' } }))
      ).toBe('NF-002')
    }
    rs.stubEnv('NODE_ENV', 'test')
    expect(
      codeOf(() => federationWith({ ssr: { integrity: 'unsafe-dev' } }))
    ).toBeUndefined()
  })

  test('a verified descriptor is recorded in the process trust registry and carries its jws', async () => {
    const { priv, pub } = keyPair('k1')
    const target = federationWith({
      ssr: { publicKeys: [pub] },
    }).componentTarget('components')
    const p = { ...payload, buildId: 'reg1', iat: 1 }
    const jws = await sign(p, priv)
    const result = await verifyComponentDescriptor(target, await file(p, jws))
    expect(result.descriptor.jws).toBe(jws)
    expect(result.descriptor.iat).toBe(1)
    expect(
      componentTrustRegistry().verified.has(
        verifiedKey('components', await componentDescriptorDigest(p))
      )
    ).toBe(true)
    // An unverified one is not.
    const u = { ...payload, buildId: 'reg2' }
    await verifyComponentDescriptor(target, await file(u))
    expect(
      componentTrustRegistry().verified.has(
        verifiedKey('components', await componentDescriptorDigest(u))
      )
    ).toBe(false)
  })

  test('defineFederation registers each remote trust policy for the server loader', () => {
    const { pub } = keyPair('k9')
    defineFederation({
      remotes: {
        regRemote: {
          origin: ORIGIN,
          components: {
            name: 'components',
            ssr: { publicKeys: [pub as never], maxAge: 3600 },
          },
        },
      },
    })
    const policies = componentTrustRegistry().trust.get('regRemote')
    expect(policies).toHaveLength(1)
    expect(policies?.at(-1)).toEqual({
      publicKeys: [pub],
      pinned: {},
      unsafeDev: false,
      maxAgeSeconds: 3600,
      name: 'components',
      allowedOrigins: [ORIGIN],
    })
    // Replaced on the next defineFederation (a dev reload drops removed keys).
    defineFederation({
      remotes: { regRemote: { origin: ORIGIN, components: {} } },
    })
    expect(componentTrustRegistry().trust.get('regRemote')).toEqual([
      {
        publicKeys: [],
        pinned: {},
        unsafeDev: false,
        maxAgeSeconds: null,
        name: null,
        allowedOrigins: [ORIGIN],
      },
    ])
  })

  test('the expected container name and a maximum age are enforced (NF-027)', async () => {
    const { priv, pub } = keyPair('k1')
    const named = federationWith({
      name: 'other',
      ssr: { publicKeys: [pub] },
    }).componentTarget('components')
    const p = { ...payload, iat: Math.floor(Date.now() / 1000) }
    const r1 = await verifyComponentDescriptor(
      named,
      await file(p, await sign(p, priv))
    )
    expect(r1.code).toBe('NF-027')
    expect(r1.descriptor.ssr).toBeNull()

    const bounded = federationWith({
      ssr: { publicKeys: [pub], maxAge: 60 },
    }).componentTarget('components')
    const fresh = await verifyComponentDescriptor(
      bounded,
      await file(p, await sign(p, priv))
    )
    expect(fresh.trust).toBe('signature')
    const old = { ...payload, iat: Math.floor(Date.now() / 1000) - 3600 }
    const stale = await verifyComponentDescriptor(
      bounded,
      await file(old, await sign(old, priv))
    )
    expect(stale.code).toBe('NF-027')
    // No iat at all: refused when an age bound is configured.
    const none = await verifyComponentDescriptor(
      bounded,
      await file(payload, await sign(payload, priv))
    )
    expect(none.code).toBe('NF-027')
  })

  test('maxBuilds must be an integer >= 1', () => {
    expect(codeOf(() => federationWith({ maxBuilds: -1 }))).toBe('NF-002')
    expect(codeOf(() => federationWith({ maxBuilds: 1.5 }))).toBe('NF-002')
  })
})

describe('final fix wave', () => {
  const nowS = () => Math.floor(Date.now() / 1000)

  test('the registry records the trust kind; maxAge bounds signed builds only', async () => {
    const { priv, pub } = keyPair('k1')
    const p = { ...payload, buildId: 'kind1', iat: 1 }
    const pin = await componentDescriptorDigest(p)
    // Pinned (no signature path) with an old iat and a maxAge: still trusted.
    const pinned = federationWith({
      ssr: { pinned: { kind1: pin }, maxAge: 60 },
    }).componentTarget('components')
    const r = await verifyComponentDescriptor(pinned, await file(p))
    expect(r.trust).toBe('pinned')
    expect(
      componentTrustRegistry().verified.get(verifiedKey('components', pin))
    ).toBe('pinned')
    // Signed, fresh: recorded as a signature.
    const fresh = { ...payload, buildId: 'kind2', iat: nowS() }
    const signedTarget = federationWith({
      ssr: { publicKeys: [pub], maxAge: 60 },
    }).componentTarget('components')
    const s = await verifyComponentDescriptor(
      signedTarget,
      await file(fresh, await sign(fresh, priv))
    )
    expect(s.trust).toBe('signature')
    expect(
      componentTrustRegistry().verified.get(
        verifiedKey('components', await componentDescriptorDigest(fresh))
      )
    ).toBe('signature')
  })

  test('a descriptor whose digest field differs from the computed digest is NF-027', async () => {
    const target = federationWith({
      ssr: { pinned: { c1: await componentDescriptorDigest(payload) } },
    }).componentTarget('components')
    const forged = { ...(await file(payload)), digest: 'sha384-AAAA' }
    const r = await verifyComponentDescriptor(target, forged)
    expect(r.trust).toBeNull()
    expect(r.code).toBe('NF-027')
    expect(r.descriptor.ssr).toBeNull()
    // Browser-only remotes (no ssr policy) are refused the same way.
    const plain = federationWith({ ssr: false }).componentTarget('components')
    expect((await verifyComponentDescriptor(plain, forged)).code).toBe('NF-027')
  })

  test('an iat more than 60 s in the future is NF-027', async () => {
    const { priv, pub } = keyPair('k1')
    const target = federationWith({
      ssr: { publicKeys: [pub] },
    }).componentTarget('components')
    const ahead = { ...payload, buildId: 'future', iat: nowS() + 600 }
    const r = await verifyComponentDescriptor(
      target,
      await file(ahead, await sign(ahead, priv))
    )
    expect(r.code).toBe('NF-027')
    expect(r.detail).toMatch(/future/)
    const near = { ...payload, buildId: 'near', iat: nowS() + 30 }
    expect(
      (
        await verifyComponentDescriptor(
          target,
          await file(near, await sign(near, priv))
        )
      ).trust
    ).toBe('signature')
  })

  test("a dev reload (defineFederation again) drops the remote's verified entries", async () => {
    const pin = await componentDescriptorDigest(payload)
    const target = defineFederation({
      remotes: {
        reload: {
          origin: ORIGIN,
          components: { ssr: { pinned: { c1: pin } } },
        },
        other: { origin: ORIGIN, components: { ssr: { pinned: { c1: pin } } } },
      },
    })
    await verifyComponentDescriptor(
      target.componentTarget('reload'),
      await file()
    )
    await verifyComponentDescriptor(
      target.componentTarget('other'),
      await file()
    )
    const registry = componentTrustRegistry()
    expect(registry.verified.has(verifiedKey('reload', pin))).toBe(true)
    defineFederation({
      remotes: { reload: { origin: ORIGIN, components: {} } },
    })
    expect(registry.verified.has(verifiedKey('reload', pin))).toBe(false)
    expect(registry.verified.has(verifiedKey('other', pin))).toBe(true)
  })
})

describe('browser assets (Mode A stylesheets and modulepreload)', () => {
  const withAssets: ComponentBuildDescriptor = {
    ...payload,
    assets: {
      entry: `${BASE}remoteEntry.js`,
      exposes: {
        './Counter': {
          css: [`${BASE}assets/Counter-x.css`],
          js: [`${BASE}assets/Counter-x.js`],
        },
      },
    },
  }
  const target = (pub: JWK) =>
    federationWith({ ssr: { publicKeys: [pub] } }).componentTarget('components')

  test('a signed descriptor carries its signed assets to RemoteComponent', async () => {
    const { priv, pub } = keyPair('k1')
    const result = await verifyComponentDescriptor(
      target(pub),
      await file(withAssets, await sign(withAssets, priv))
    )
    expect(result.trust).toBe('signature')
    expect(result.descriptor.assets).toEqual(withAssets.assets)
  })

  test('a stylesheet URL changed after signing is refused (NF-027), and no assets are kept', async () => {
    const { priv, pub } = keyPair('k1')
    const jws = await sign(withAssets, priv)
    const tampered: ComponentBuildDescriptor = {
      ...withAssets,
      assets: {
        ...withAssets.assets!,
        exposes: {
          './Counter': {
            css: [`${BASE}assets/evil.css`],
            js: withAssets.assets!.exposes['./Counter']!.js,
          },
        },
      },
    }
    // The digest recomputed by whoever edited the file: the JWS still differs.
    const recomputed = await verifyComponentDescriptor(
      target(pub),
      await file(tampered, jws)
    )
    expect(recomputed.code).toBe('NF-027')
    expect(recomputed.descriptor.ssr).toBeNull()
    expect(recomputed.descriptor.assets).toBeUndefined()
    // The digest left as published: it is not the payload's.
    const stale = {
      ...(await file(withAssets, jws)),
      assets: tampered.assets,
    }
    const result = await verifyComponentDescriptor(target(pub), stale)
    expect(result.code).toBe('NF-027')
    expect(result.descriptor.assets).toBeUndefined()
  })

  test('a browser-only build (no SSR policy, or unsigned) keeps its assets for the browser', async () => {
    const plain = defineFederation({
      remotes: { components: { origin: ORIGIN, components: {} } as never },
    }).componentTarget('components')
    const result = await verifyComponentDescriptor(
      plain,
      await file(withAssets)
    )
    expect(result.trust).toBeNull()
    expect(result.descriptor.assets).toEqual(withAssets.assets)
    const { pub } = keyPair('k1')
    const unsigned = await verifyComponentDescriptor(
      target(pub),
      await file(withAssets)
    )
    expect(unsigned.code).toBe('NF-028')
    expect(unsigned.descriptor.assets).toEqual(withAssets.assets)
  })
})

describe('shared modules (version negotiation)', () => {
  const withShared: ComponentBuildDescriptor = {
    ...payload,
    shared: {
      'components-context': { requiredVersion: '^1.0.0', fallback: false },
      'date-lib': { requiredVersion: '^2.0.0', fallback: true },
    },
  }
  const target = (pub: JWK) =>
    federationWith({ ssr: { publicKeys: [pub] } }).componentTarget('components')

  test('a signed descriptor carries its shared requirements', async () => {
    const { priv, pub } = keyPair('k1')
    const result = await verifyComponentDescriptor(
      target(pub),
      await file(withShared, await sign(withShared, priv))
    )
    expect(result.trust).toBe('signature')
    expect(result.descriptor.shared).toEqual(withShared.shared)
  })

  test('requirements changed after signing are refused (NF-027)', async () => {
    const { priv, pub } = keyPair('k1')
    const jws = await sign(withShared, priv)
    const relaxed: ComponentBuildDescriptor = {
      ...withShared,
      shared: {
        ...withShared.shared,
        'components-context': { requiredVersion: false, fallback: false },
      },
    }
    const result = await verifyComponentDescriptor(
      target(pub),
      await file(relaxed, jws)
    )
    expect(result.code).toBe('NF-027')
    expect(result.descriptor.ssr).toBeNull()
  })

  test('a browser-only build keeps its requirements (the browser checks them)', async () => {
    const { pub } = keyPair('k1')
    const unsigned = await verifyComponentDescriptor(
      target(pub),
      await file(withShared)
    )
    expect(unsigned.code).toBe('NF-028')
    expect(unsigned.descriptor.shared).toEqual(withShared.shared)
  })
})

describe('type declarations (types)', () => {
  const hash = `sha384-${'A'.repeat(64)}`
  const withTypes: ComponentBuildDescriptor = {
    ...payload,
    types: { index: `${BASE}@mf-types/index.json`, integrity: hash },
  }
  const target = (components: Record<string, unknown>) =>
    federationWith(components).componentTarget('components')

  test('a signed descriptor with types still verifies for SSR', async () => {
    const { priv, pub } = keyPair('k1')
    const result = await verifyComponentDescriptor(
      target({ ssr: { publicKeys: [pub] } }),
      await file(withTypes, await sign(withTypes, priv))
    )
    expect(result.code).toBeUndefined()
    expect(result.trust).toBe('signature')
  })

  test('verifyDescriptorTrust accepts a signed or pinned build, with or without server code', async () => {
    const { priv, pub } = keyPair('k1')
    const browserOnly: ComponentBuildDescriptor = { ...withTypes, ssr: null }
    const signed = await verifyDescriptorTrust(
      target({ ssr: { publicKeys: [pub] } }),
      await file(browserOnly, await sign(browserOnly, priv))
    )
    expect(signed).toEqual({ ok: true, trust: 'signature' })
    const pinned = await verifyDescriptorTrust(
      target({
        ssr: { pinned: { c1: await componentDescriptorDigest(withTypes) } },
      }),
      await file(withTypes)
    )
    expect(pinned).toEqual({ ok: true, trust: 'pinned' })
  })

  test('verifyDescriptorTrust refuses types changed after signing (NF-027)', async () => {
    const { priv, pub } = keyPair('k1')
    const jws = await sign(withTypes, priv)
    const swapped: ComponentBuildDescriptor = {
      ...withTypes,
      types: {
        index: `${BASE}@mf-types/index.json`,
        integrity: `sha384-${'B'.repeat(64)}`,
      },
    }
    const result = await verifyDescriptorTrust(
      target({ ssr: { publicKeys: [pub] } }),
      await file(swapped, jws)
    )
    expect(result).toMatchObject({ ok: false, code: 'NF-027' })
  })

  test('verifyDescriptorTrust refuses an unverifiable build (NF-028), and a remote with ssr: false', async () => {
    const { pub } = keyPair('k1')
    expect(
      await verifyDescriptorTrust(
        target({ ssr: { publicKeys: [pub] } }),
        await file(withTypes)
      )
    ).toMatchObject({ ok: false, code: 'NF-028' })
    expect(
      await verifyDescriptorTrust(target({ ssr: false }), await file(withTypes))
    ).toMatchObject({ ok: false, code: 'NF-028' })
  })

  test("verifyDescriptorTrust refuses a digest that is not the payload's (NF-027)", async () => {
    const tampered = { ...(await file(withTypes)), digest: 'sha384-x' }
    expect(
      await verifyDescriptorTrust(
        target({ ssr: { pinned: { c1: tampered.digest } } }),
        tampered
      )
    ).toMatchObject({ ok: false, code: 'NF-027' })
  })
})

describe('bounded response bodies', () => {
  /** A body that never ends: `chunk` bytes per pull, counting pulls and cancels. */
  function endless(chunk: number, delayMs = 0) {
    const seen = { pulls: 0, cancelled: false }
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        seen.pulls++
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
        controller.enqueue(new Uint8Array(chunk).fill(32))
      },
      cancel() {
        seen.cancelled = true
      },
    })
    return { body, seen }
  }

  test('a descriptor body over 1 MiB without content-length is refused without buffering it (NF-029)', async () => {
    const target = federationWith({}).componentTarget('components')
    const { body, seen } = endless(64 * 1024)
    const result = await fetchComponentDescriptor(target, {
      fetch: async () => new Response(body),
    })
    expect(result).toMatchObject({ ok: false, code: 'NF-029' })
    expect(seen.cancelled).toBe(true)
    expect(seen.pulls).toBeLessThan(40)
  })

  test('a slow drip is cut at the limit too', async () => {
    const { body, seen } = endless(8, 5)
    expect(await readBodyLimited(new Response(body), 64)).toBeNull()
    expect(seen.cancelled).toBe(true)
    expect(seen.pulls).toBeLessThan(15)
  })

  test('a body within the limit is returned as its raw bytes', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41])
    expect(await readBodyLimited(new Response(bytes), 4)).toEqual(bytes)
  })
})
