import { createHash } from 'node:crypto'
import type {
  ComponentBuildTypes,
  ComponentSharedModule,
} from '../src/components.ts'
import {
  COMPONENTS_DESCRIPTOR_PATH,
  componentDescriptorDigest,
  componentTrustRegistry,
  isNeverFallback,
  parseComponentDescriptorFile,
  parseComponentTypesIndex,
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

describe('shared modules (version negotiation)', () => {
  const shared: Record<string, ComponentSharedModule> = {
    'components-context': { requiredVersion: '^1.0.0', fallback: false },
    'date-lib': {
      requiredVersion: '^2.0.0',
      fallback: true,
      exposes: ['./Counter'],
      version: '2.0.0',
    },
    'next/link': { requiredVersion: false, fallback: false, exposes: [] },
  }

  test('parses shared and the digest covers it', async () => {
    const file = parseComponentDescriptorFile({
      ...payload,
      shared,
      digest: 'd',
    })
    expect(file?.shared).toEqual(shared)
    const a = await componentDescriptorDigest({ ...payload, shared })
    expect(a).not.toBe(await componentDescriptorDigest(payload))
    const relaxed: Record<string, ComponentSharedModule> = {
      ...shared,
      'components-context': { requiredVersion: false, fallback: false },
    }
    expect(
      await componentDescriptorDigest({ ...payload, shared: relaxed })
    ).not.toBe(a)
  })

  test('a descriptor without shared still parses (older builds)', () => {
    expect(
      parseComponentDescriptorFile({ ...payload, digest: 'd' })?.shared
    ).toBeUndefined()
  })

  const withShared = (value: unknown) => ({
    ...payload,
    shared: value,
    digest: 'd',
  })
  test.each([
    ['shared not an object', withShared([])],
    [
      'a relative specifier',
      withShared({ './x': { requiredVersion: false, fallback: false } }),
    ],
    [
      'an invalid range',
      withShared({ lib: { requiredVersion: 'latest', fallback: false } }),
    ],
    [
      'a missing fallback flag',
      withShared({ lib: { requiredVersion: false } }),
    ],
    [
      'a non-boolean fallback',
      withShared({ lib: { requiredVersion: false, fallback: 'yes' } }),
    ],
    [
      'an expose that is not ./name',
      withShared({
        lib: { requiredVersion: false, fallback: false, exposes: ['Counter'] },
      }),
    ],
    ...[
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'next/link',
      'next/navigation',
      'next/router',
      // Every React and Next.js module, not only the listed ones.
      'react-dom/server',
      'react/jsx-dev-runtime',
      'next',
      'next/head',
      'next/font/google',
    ].map((name) => [
      `a fallback copy of ${name} (always the host's)`,
      withShared({ [name]: { requiredVersion: false, fallback: true } }),
    ]),
    [
      'a bundled version that is not semver',
      withShared({
        lib: { requiredVersion: false, fallback: true, version: 'x' },
      }),
    ],
    [
      'exposes not a list',
      withShared({
        lib: { requiredVersion: false, fallback: false, exposes: './Counter' },
      }),
    ],
  ])('rejects %s', (_name, value) => {
    expect(parseComponentDescriptorFile(value)).toBeNull()
  })
})

describe('type declarations', () => {
  const hash = `sha384-${'A'.repeat(64)}`
  const types: ComponentBuildTypes = {
    index: `${base}@mf-types/index.json`,
    integrity: hash,
  }

  test('parses one signed index entry, and the digest covers it', async () => {
    const file = parseComponentDescriptorFile({
      ...payload,
      types,
      digest: 'd',
    })
    expect(file?.types).toEqual(types)
    const a = await componentDescriptorDigest({ ...payload, types })
    expect(a).not.toBe(await componentDescriptorDigest(payload))
    expect(
      await componentDescriptorDigest({
        ...payload,
        types: { ...types, integrity: `sha384-${'B'.repeat(64)}` },
      })
    ).not.toBe(a)
  })

  test('a descriptor without types still parses (older builds)', () => {
    expect(
      parseComponentDescriptorFile({ ...payload, digest: 'd' })?.types
    ).toBeUndefined()
  })

  const withTypes = (value: unknown) => ({
    ...payload,
    types: value,
    digest: 'd',
  })
  test.each([
    ['types not an object', withTypes([])],
    [
      'an index outside the base',
      withTypes({ ...types, index: 'https://evil.example/i.json' }),
    ],
    [
      'an index that is not .json',
      withTypes({ ...types, index: `${base}@mf-types/index.js` }),
    ],
    [
      'an index with a query',
      withTypes({ ...types, index: `${base}@mf-types/index.json?x` }),
    ],
    [
      'an integrity that is not sha384',
      withTypes({ ...types, integrity: 'md5-x' }),
    ],
  ])('rejects %s', (_name, value) => {
    expect(parseComponentDescriptorFile(value)).toBeNull()
  })
})

describe('type declarations index (@mf-types/index.json)', () => {
  const hash = `sha384-${'A'.repeat(64)}`
  const index = {
    exposes: { './Counter': '@mf-types/Counter.d.ts' },
    files: {
      '@mf-types/Counter.d.ts': hash,
      '@mf-types/compiled-types/Counter.d.ts': hash,
    },
  }

  test('parses a valid index', () => {
    expect(parseComponentTypesIndex(index)).toEqual(index)
  })

  test.each([
    ['files missing', { exposes: {} }],
    [
      'a file that is not a .d.ts',
      { exposes: {}, files: { '@mf-types/a.js': hash } },
    ],
    [
      'a parent segment',
      { exposes: {}, files: { '@mf-types/../x.d.ts': hash } },
    ],
    [
      'an encoded parent segment',
      { exposes: {}, files: { '%2e%2e/x.d.ts': hash } },
    ],
    ['a drive letter segment', { exposes: {}, files: { 'a/C:/x.d.ts': hash } }],
    ['a backslash', { exposes: {}, files: { 'a\\x.d.ts': hash } }],
    ['an absolute path', { exposes: {}, files: { '/etc/x.d.ts': hash } }],
    ['a file without a sha384', { exposes: {}, files: { 'a.d.ts': 'md5-x' } }],
    [
      'an expose key that is not ./name',
      { exposes: { Counter: '@mf-types/Counter.d.ts' }, files: index.files },
    ],
    [
      'an expose pointing at an unlisted file',
      { exposes: { './Counter': '@mf-types/Other.d.ts' }, files: index.files },
    ],
    [
      'an expose naming an inherited property (toString)',
      { exposes: { './Counter': 'toString' }, files: index.files },
    ],
    [
      'an expose naming an inherited property (constructor)',
      { exposes: { './Counter': 'constructor' }, files: index.files },
    ],
    [
      'more than 2000 files',
      {
        exposes: {},
        files: Object.fromEntries(
          Array.from({ length: 2001 }, (_, i) => [`t/${i}.d.ts`, hash])
        ),
      },
    ],
  ])('rejects %s', (_name, value) => {
    expect(parseComponentTypesIndex(value)).toBeNull()
  })
})

test('isNeverFallback: react, react-dom and next with every subpath, nothing else', () => {
  for (const name of [
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'react-dom',
    'react-dom/server',
    'react-dom/client',
    'next',
    'next/head',
    'next/link',
  ]) {
    expect(isNeverFallback(name)).toBe(true)
  }
  for (const name of [
    'react-is',
    'react-dom-x',
    'next-intl',
    'nextjs-toploader',
    '@acme/react',
    'preact',
  ]) {
    expect(isNeverFallback(name)).toBe(false)
  }
})

test('a fallback copy of a module that only starts like React or Next.js is accepted', () => {
  for (const name of ['react-is', 'next-intl']) {
    expect(
      parseComponentDescriptorFile({
        ...payload,
        shared: { [name]: { requiredVersion: false, fallback: true } },
        digest: 'd',
      })
    ).not.toBeNull()
  }
})
