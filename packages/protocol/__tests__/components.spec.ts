import { createHash } from 'node:crypto'
import {
  COMPONENTS_DESCRIPTOR_PATH,
  componentDescriptorDigest,
  componentTrustRegistry,
  parseComponentDescriptorFile,
  sha384Integrity,
} from '../src/components.ts'

const base = 'https://remote.example/b/c1/'
const payload = {
  v: 1 as const,
  name: 'components',
  buildId: 'c1',
  base,
  manifest: `${base}mf-manifest.json`,
  ssr: {
    integrity: {
      'mf-manifest.json': 'sha384-AAAA',
      'remoteEntry.ssr.js': 'sha384-BBBB',
    },
  },
}

test('the descriptor path is fixed', () => {
  expect(COMPONENTS_DESCRIPTOR_PATH).toBe('/_nf/components.json')
})

test('sha384Integrity matches node:crypto', async () => {
  const bytes = new TextEncoder().encode('module.exports = 1')
  const expected = `sha384-${createHash('sha384').update(bytes).digest('base64')}`
  expect(await sha384Integrity(bytes)).toBe(expected)
})

test('the digest covers the canonical payload only', async () => {
  const a = await componentDescriptorDigest(payload)
  const reordered = {
    ssr: payload.ssr,
    manifest: payload.manifest,
    base,
    buildId: 'c1',
    name: 'components',
    v: 1 as const,
  }
  expect(await componentDescriptorDigest(reordered)).toBe(a)
  expect(a).toMatch(/^sha384-[A-Za-z0-9+/]+=*$/)
  const changed = {
    ...payload,
    ssr: {
      integrity: { ...payload.ssr.integrity, 'remoteEntry.ssr.js': 'x' },
    },
  }
  expect(await componentDescriptorDigest(changed)).not.toBe(a)
})

test('parses a valid file and keeps only known fields', () => {
  const file = parseComponentDescriptorFile({
    ...payload,
    digest: 'sha384-x',
    jws: 'a.b.c',
    extra: true,
  })
  expect(file).toEqual({ ...payload, digest: 'sha384-x', jws: 'a.b.c' })
  expect(
    parseComponentDescriptorFile({ ...payload, ssr: null, digest: 'd' })
  ).toEqual({ ...payload, ssr: null, digest: 'd' })
})

test.each([
  ['not an object', 'x'],
  ['wrong version', { ...payload, v: 2, digest: 'd' }],
  ['bad name', { ...payload, name: '1x', digest: 'd' }],
  ['bad buildId', { ...payload, buildId: '../x', digest: 'd' }],
  ['relative base', { ...payload, base: '/b/c1/', digest: 'd' }],
  ['base without slash', { ...payload, base: base.slice(0, -1), digest: 'd' }],
  [
    'manifest outside base',
    { ...payload, manifest: 'https://evil.example/m.json', digest: 'd' },
  ],
  [
    'integrity path escapes base',
    {
      ...payload,
      ssr: { integrity: { '../x.cjs': 'sha384-A' } },
      digest: 'd',
    },
  ],
  [
    'integrity value not sha384',
    { ...payload, ssr: { integrity: { 'a.cjs': 'sha256-A' } }, digest: 'd' },
  ],
  ['missing digest', { ...payload }],
])('rejects %s (NF-002-free: returns null)', (_name, value) => {
  expect(parseComponentDescriptorFile(value)).toBeNull()
})

test('iat (seconds, integer) is part of the signed payload and its digest', async () => {
  const withIat = { ...payload, iat: 1_700_000_000 }
  const file = parseComponentDescriptorFile({ ...withIat, digest: 'd' })
  expect(file?.iat).toBe(1_700_000_000)
  expect(await componentDescriptorDigest(withIat)).not.toBe(
    await componentDescriptorDigest(payload)
  )
  expect(
    parseComponentDescriptorFile({ ...payload, iat: 1.5, digest: 'd' })
  ).toBeNull()
})

test('the trust registry is one process-wide object under a symbol key', () => {
  const a = componentTrustRegistry()
  expect(componentTrustRegistry()).toBe(a)
  expect(
    (globalThis as Record<symbol, unknown>)[
      Symbol.for('nf.components.verified')
    ]
  ).toBe(a)
  expect(a.verified).toBeInstanceOf(Map)
  expect(a.trust).toBeInstanceOf(Map)
})

describe('browser assets (stylesheets and modulepreload)', () => {
  const assets = {
    entry: `${base}remoteEntry.js`,
    exposes: {
      './Counter': {
        css: [`${base}assets/Counter-x.css`],
        js: [`${base}assets/Counter-x.js`, `${base}assets/dist-y.js`],
      },
    },
  }

  test('parses assets and keeps them in the payload, the digest covers them', async () => {
    const file = parseComponentDescriptorFile({
      ...payload,
      assets,
      digest: 'd',
    })
    expect(file?.assets).toEqual(assets)
    const a = await componentDescriptorDigest({ ...payload, assets })
    expect(a).not.toBe(await componentDescriptorDigest(payload))
    const moved = {
      ...assets,
      exposes: {
        './Counter': { ...assets.exposes['./Counter'], css: [`${base}x.css`] },
      },
    }
    expect(
      await componentDescriptorDigest({ ...payload, assets: moved })
    ).not.toBe(a)
  })

  test('a descriptor without assets still parses (older builds, dev)', () => {
    expect(
      parseComponentDescriptorFile({ ...payload, digest: 'd' })?.assets
    ).toBeUndefined()
  })

  const expose = (patch: Record<string, unknown>) => ({
    ...payload,
    assets: {
      ...assets,
      exposes: { './Counter': { ...assets.exposes['./Counter'], ...patch } },
    },
    digest: 'd',
  })
  test.each([
    [
      'a stylesheet on another origin',
      expose({ css: ['https://evil.example/a.css'] }),
    ],
    ['a stylesheet escaping base', expose({ css: [`${base}../c2/a.css`] })],
    ['a stylesheet with a query', expose({ css: [`${base}a.css?x=1`] })],
    [
      'a chunk on another origin',
      expose({ js: ['https://evil.example/a.js'] }),
    ],
    ['a non-string chunk', expose({ js: [1] })],
    [
      'an entry outside base',
      {
        ...payload,
        assets: { ...assets, entry: 'https://evil.example/e.js' },
        digest: 'd',
      },
    ],
    [
      'an expose key that is not ./name',
      {
        ...payload,
        assets: {
          ...assets,
          exposes: { Counter: assets.exposes['./Counter'] },
        },
        digest: 'd',
      },
    ],
    ['assets not an object', { ...payload, assets: [], digest: 'd' }],
  ])('rejects %s', (_name, value) => {
    expect(parseComponentDescriptorFile(value)).toBeNull()
  })
})
