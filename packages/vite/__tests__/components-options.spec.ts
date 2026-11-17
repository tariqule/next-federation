import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, generateKeyPairSync } from 'node:crypto'
import {
  componentDescriptorDigest,
  parseComponentDescriptorFile,
} from '@next-federation/protocol'
import { isNFError } from '@next-federation/sdk'
import { compactVerify, importJWK } from 'jose'
import type { JWK } from 'jose'
import {
  collectBrowserAssets,
  collectServerIntegrity,
  createDescriptorFile,
} from '../src/components/descriptor.ts'
import { resolveComponentsOptions } from '../src/components/options.ts'
import {
  SUPPORTED_MF_VITE_VERSION,
  assertModuleFederationViteVersion,
  installedModuleFederationViteVersion,
} from '../src/components/version.ts'

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (error) {
    return isNFError(error) ? error.code : `not an NFError: ${String(error)}`
  }
  return undefined
}

const ctx = { command: 'build' as const, env: {}, now: 1_700_000_000_000 }
const base = {
  name: 'components',
  base: 'https://remote.example',
  exposes: { './Counter': './src/Counter.tsx' },
}

afterEach(() => {
  rs.restoreAllMocks()
})

test('the pinned @module-federation/vite is the installed one', () => {
  expect(SUPPORTED_MF_VITE_VERSION).toBe('1.24.0')
  expect(installedModuleFederationViteVersion()).toBe('1.24.0')
})

test('another @module-federation/vite is NF-026; NF_ALLOW_MF_VITE=1 only warns', () => {
  expect(
    codeOf(() => assertModuleFederationViteVersion('1.24.0', {}))
  ).toBeUndefined()
  expect(codeOf(() => assertModuleFederationViteVersion('1.25.0', {}))).toBe(
    'NF-026'
  )
  const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
  expect(
    codeOf(() =>
      assertModuleFederationViteVersion('1.25.0', { NF_ALLOW_MF_VITE: '1' })
    )
  ).toBeUndefined()
  expect(String(warn.mock.calls[0]?.join(' '))).toMatch(/NF-026.*1\.25\.0/)
})

test('outDir: trimming trailing slashes is linear on a long run of inner slashes', () => {
  // `/\/+$/` retries the slash run from every start position: quadratic.
  const outDir = `dist${'/'.repeat(100_000)}x`
  const started = performance.now()
  const resolved = resolveComponentsOptions(
    { ...base, buildId: 'c1', outDir: `${outDir}//` },
    ctx
  )
  expect(performance.now() - started).toBeLessThan(100)
  expect(resolved.outDir).toBe(`${outDir}/c1`)
})

test('a build gets an immutable /b/<buildId>/ base and its own folder', () => {
  const resolved = resolveComponentsOptions(
    { ...base, buildId: 'c1', shared: ['components-context'] },
    ctx
  )
  expect(resolved.publicBase).toBe('https://remote.example/b/c1/')
  expect(resolved.outDir).toBe('dist/c1')
  expect(resolved.ssr).toBe(true)
  expect(Object.keys(resolved.shared)).toEqual([
    'react',
    'react-dom',
    'react-dom/client',
    'react/jsx-runtime',
    'components-context',
  ])
  expect(resolved.shared['components-context']).toEqual({
    requiredVersion: false,
    fallback: false,
  })
  expect(resolved.shared.react).toEqual({
    requiredVersion: '^19.0.0',
    fallback: false,
  })
})

test('buildId defaults to NF_BUILD_ID, then the build time', () => {
  expect(
    resolveComponentsOptions(base, { ...ctx, env: { NF_BUILD_ID: 'x9' } })
      .buildId
  ).toBe('x9')
  expect(resolveComponentsOptions(base, ctx).buildId).toBe(ctx.now.toString(36))
  expect(
    resolveComponentsOptions(base, { ...ctx, command: 'serve' }).publicBase
  ).toBe('https://remote.example/')
})

test.each([
  ['a name that is not an identifier', { ...base, name: 'my-remote' }],
  ['a relative base', { ...base, base: '/x/' }],
  ['no exposes', { ...base, exposes: {} }],
  ['an expose key without ./', { ...base, exposes: { Counter: './a.tsx' } }],
  ['a bad buildId', { ...base, buildId: '..' }],
  ['a shared React entry', { ...base, shared: ['react'] }],
  ['next itself', { ...base, shared: ['next'] }],
  ['another next/* module', { ...base, shared: ['next/head'] }],
  [
    'a fallback for next/link',
    { ...base, shared: { 'next/link': { fallback: true } } },
  ],
  [
    'an invalid range',
    { ...base, shared: { lib: { requiredVersion: 'latest' } } },
  ],
  ['a non-boolean fallback', { ...base, shared: { lib: { fallback: 'yes' } } }],
])('rejects %s', (_label, options) => {
  const code = codeOf(() => resolveComponentsOptions(options as never, ctx))
  expect(code === 'NF-002' || code === 'NF-020').toBe(true)
})

async function buildDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nf-components-'))
  await mkdir(join(dir, 'assets'))
  await writeFile(
    join(dir, 'mf-manifest.json'),
    JSON.stringify({
      metaData: { ssrRemoteEntry: { name: 'remoteEntry.ssr.js', path: '' } },
    })
  )
  await writeFile(
    join(dir, 'remoteEntry.ssr.js'),
    'const r = require("@module-federation/runtime"); require("./assets/a.cjs")'
  )
  await writeFile(join(dir, 'assets/a.cjs'), 'require("./b.cjs")')
  await writeFile(join(dir, 'assets/b.cjs'), 'exports.b = 1')
  await writeFile(join(dir, 'assets/unrelated.cjs'), 'exports.x = 1')
  return dir
}

const sri = (text: string) =>
  `sha384-${createHash('sha384').update(text).digest('base64')}`

test('collects the sha384 of the manifest and every file of the server graph', async () => {
  const dir = await buildDir()
  try {
    const integrity = await collectServerIntegrity(dir)
    expect(integrity).toEqual({
      'mf-manifest.json': sri(
        JSON.stringify({
          metaData: {
            ssrRemoteEntry: { name: 'remoteEntry.ssr.js', path: '' },
          },
        })
      ),
      'remoteEntry.ssr.js': sri(
        'const r = require("@module-federation/runtime"); require("./assets/a.cjs")'
      ),
      'assets/a.cjs': sri('require("./b.cjs")'),
      'assets/b.cjs': sri('exports.b = 1'),
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a server graph that escapes the build folder is NF-002', async () => {
  const dir = await buildDir()
  try {
    await writeFile(join(dir, 'assets/b.cjs'), 'require("../../outside.cjs")')
    await expect(collectServerIntegrity(dir)).rejects.toMatchObject({
      code: 'NF-002',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

const browserManifest = {
  metaData: {
    remoteEntry: { name: 'remoteEntry.js', path: '' },
    ssrRemoteEntry: { name: 'remoteEntry.ssr.js', path: '' },
  },
  exposes: [
    {
      name: 'Counter',
      path: './Counter',
      assets: {
        js: { sync: ['assets/dist-a.js', 'assets/Counter-b.js'], async: [] },
        css: { sync: ['assets/Counter-c.css'], async: ['assets/lazy-d.css'] },
      },
    },
    {
      name: 'Plain',
      path: './Plain',
      assets: {
        js: { sync: ['assets/Plain-e.js'], async: [] },
        css: { sync: [], async: [] },
      },
    },
  ],
}

test("collects each exposed module's stylesheets and chunks as absolute URLs under base", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nf-components-'))
  try {
    await writeFile(
      join(dir, 'mf-manifest.json'),
      JSON.stringify(browserManifest)
    )
    const b = 'https://remote.example/b/c1/'
    expect(await collectBrowserAssets(dir, b)).toEqual({
      entry: `${b}remoteEntry.js`,
      exposes: {
        './Counter': {
          css: [`${b}assets/Counter-c.css`],
          js: [`${b}assets/dist-a.js`, `${b}assets/Counter-b.js`],
        },
        './Plain': { css: [], js: [`${b}assets/Plain-e.js`] },
      },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test.each([
  ['a file outside the build folder', '../c0/x.css'],
  ['an absolute URL', 'https://evil.example/x.css'],
])('collectBrowserAssets: %s is NF-002', async (_label, file) => {
  const dir = await mkdtemp(join(tmpdir(), 'nf-components-'))
  try {
    const manifest = structuredClone(browserManifest)
    manifest.exposes[0]!.assets.css.sync = [file]
    await writeFile(join(dir, 'mf-manifest.json'), JSON.stringify(manifest))
    await expect(
      collectBrowserAssets(dir, 'https://remote.example/b/c1/')
    ).rejects.toMatchObject({ code: 'NF-002' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a descriptor file with assets parses back to the same payload', async () => {
  const b = 'https://remote.example/b/c1/'
  const file = await createDescriptorFile(
    {
      ...payload,
      assets: {
        entry: `${b}remoteEntry.js`,
        exposes: { './Counter': { css: [`${b}a.css`], js: [`${b}a.js`] } },
      },
    },
    {}
  )
  expect(parseComponentDescriptorFile(file)).toEqual(file)
})

function privateJwk(): JWK {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return { ...(privateKey.export({ format: 'jwk' }) as JWK), kid: 'k1' }
}

const payload = {
  v: 1 as const,
  name: 'components',
  buildId: 'c1',
  base: 'https://remote.example/b/c1/',
  manifest: 'https://remote.example/b/c1/mf-manifest.json',
  ssr: { integrity: { 'mf-manifest.json': sri('{}') } },
}

test('an unsigned descriptor carries its digest only', async () => {
  const file = await createDescriptorFile(payload, {})
  expect(parseComponentDescriptorFile(file)).toEqual(file)
  expect(file.digest).toBe(await componentDescriptorDigest(payload))
  expect(file.jws).toBeUndefined()
})

test('NF_COMPONENTS_SIGNING_KEY signs the canonical payload (ES256 JWS)', async () => {
  const jwk = privateJwk()
  const file = await createDescriptorFile(payload, {
    NF_COMPONENTS_SIGNING_KEY: JSON.stringify(jwk),
  })
  expect(typeof file.jws).toBe('string')
  const publicJwk = { ...jwk }
  delete publicJwk.d
  const key = await importJWK(publicJwk, 'ES256')
  const { payload: bytes, protectedHeader } = await compactVerify(
    file.jws!,
    key
  )
  expect(protectedHeader).toMatchObject({
    alg: 'ES256',
    kid: 'k1',
    typ: 'nf-components+jws',
  })
  expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(payload)
})

test('a signing key that is not a private P-256 JWK is NF-002', async () => {
  await expect(
    createDescriptorFile(payload, { NF_COMPONENTS_SIGNING_KEY: 'nope' })
  ).rejects.toMatchObject({ code: 'NF-002' })
  const publicOnly = privateJwk()
  delete publicOnly.d
  await expect(
    createDescriptorFile(payload, {
      NF_COMPONENTS_SIGNING_KEY: JSON.stringify(publicOnly),
    })
  ).rejects.toMatchObject({ code: 'NF-002' })
})

test.each(['_canary', '-x', 'x'.repeat(129)])('buildId %j is NF-002', (id) => {
  expect(
    codeOf(() => resolveComponentsOptions({ ...base, buildId: id }, ctx))
  ).toBe('NF-002')
})

test('an http base for a non-loopback host is NF-002 in a production build', () => {
  const prod = { ...ctx, env: { NODE_ENV: 'production' } }
  const http = { ...base, base: 'http://remote.example' }
  expect(() => resolveComponentsOptions(http, prod)).toThrow(
    /NF-002.*`base`.*https.*http:\/\/remote\.example/
  )
  expect(
    resolveComponentsOptions({ ...base, base: 'http://localhost:4300' }, prod)
      .publicBase
  ).toMatch(/^http:\/\/localhost:4300\//)
  expect(
    resolveComponentsOptions({ ...http, allowInsecureHttp: true }, prod)
      .publicBase
  ).toMatch(/^http:\/\/remote\.example\//)
  expect(
    resolveComponentsOptions(http, { ...prod, command: 'serve' }).publicBase
  ).toBe('http://remote.example/')
})
