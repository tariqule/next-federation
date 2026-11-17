import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'
import { isNFError } from '@next-federation/sdk'
import { withNextFederation } from '../src/config.ts'
import { callerDir } from '../src/installed-next.ts'
import { cacheModel, hostBasePath } from '../src/server/assert-wrapped.ts'

type Wp = (config: Record<string, unknown>, options: unknown) => unknown
type Loose = {
  env: Record<string, string>
  turbopack: { resolveAlias: Record<string, unknown> }
  transpilePackages: string[]
  webpack: Wp
  [key: string]: unknown
}
const loose = (c: NextConfig): Loose => c as unknown as Loose

const ALIAS = '@next-federation/next/island-cache'
const LEGACY = '@next-federation/next/island-cache/legacy'
const CC = '@next-federation/next/island-cache/cache-components'

function runWebpack(c: Loose, base: Record<string, unknown> = {}) {
  const wp = { resolve: { alias: { existing: 'x' } }, ...base }
  return c.webpack(wp, { isServer: true }) as {
    resolve: { alias: Record<string, unknown> }
    [key: string]: unknown
  }
}

function expectCode(fn: () => unknown, code: string) {
  let caught: unknown
  try {
    fn()
  } catch (error) {
    caught = error
  }
  expect(isNFError(caught)).toBe(true)
  expect((caught as { code: string }).code).toBe(code)
}

test('legacy config: env, alias, transpilePackages', () => {
  const c = loose(
    withNextFederation({ basePath: '/base', transpilePackages: ['x'] })
  )
  expect(c.env).toMatchObject({
    NF_CACHE_MODEL: 'legacy',
    NF_BASE_PATH: '/base',
  })
  expect(c.turbopack.resolveAlias[ALIAS]).toBe(LEGACY)
  expect(c.transpilePackages).toEqual(['x', '@next-federation/next'])
  expect(c.basePath).toBe('/base')
  // Webpack aliases match prefixes unless the key ends with `$`.
  expect(runWebpack(c).resolve.alias).toEqual({
    existing: 'x',
    [`${ALIAS}$`]: LEGACY,
  })
})

test('no basePath sets NF_BASE_PATH to the empty string', () => {
  const c = loose(withNextFederation({}))
  expect(c.env).toEqual({
    NF_CACHE_MODEL: 'legacy',
    NF_BASE_PATH: '',
    // The host's Next version: remote components check ranges against it.
    NF_NEXT_VERSION: '16.4.6',
  })
  expect(c.transpilePackages).toEqual(['@next-federation/next'])
})

test('cacheComponents: true selects the cache-components alias', () => {
  const c = loose(withNextFederation({ cacheComponents: true }))
  expect(c.env.NF_CACHE_MODEL).toBe('cache-components')
  expect(c.turbopack.resolveAlias[ALIAS]).toBe(CC)
  expect(runWebpack(c).resolve.alias[`${ALIAS}$`]).toBe(CC)
  expect(c.cacheComponents).toBe(true)
})

test('composes an existing webpack function and adds the alias', () => {
  const seen: unknown[] = []
  const c = loose(
    withNextFederation({
      webpack(config, options) {
        seen.push(options)
        return {
          ...config,
          marker: 1,
          resolve: {
            ...config.resolve,
            alias: { ...config.resolve.alias, user: 'u' },
          },
        }
      },
    })
  )
  const out = runWebpack(c)
  expect(seen).toEqual([{ isServer: true }])
  expect(out.marker).toBe(1)
  expect(out.resolve.alias).toEqual({
    existing: 'x',
    user: 'u',
    [`${ALIAS}$`]: LEGACY,
  })
})

test('webpack config without resolve.alias still gets the alias', () => {
  const c = loose(withNextFederation({}))
  const out = c.webpack({}, {}) as { resolve: { alias: unknown } }
  expect(out.resolve.alias).toEqual({ [`${ALIAS}$`]: LEGACY })
})

test('keeps existing turbopack.resolveAlias and env entries', () => {
  const c = loose(
    withNextFederation({
      env: { MINE: '1' },
      turbopack: { root: '/r', resolveAlias: { a: './a.ts' } },
      reactStrictMode: true,
    })
  )
  expect(c.env).toEqual({
    MINE: '1',
    NF_CACHE_MODEL: 'legacy',
    NF_BASE_PATH: '',
    NF_NEXT_VERSION: '16.4.6',
  })
  expect(c.turbopack).toEqual({
    root: '/r',
    resolveAlias: { a: './a.ts', [ALIAS]: LEGACY },
  })
  expect(c.reactStrictMode).toBe(true)
})

test('does not mutate the input config', () => {
  const input: NextConfig = {
    env: { MINE: '1' },
    transpilePackages: ['x'],
    turbopack: { resolveAlias: { a: './a.ts' } },
  }
  const snapshot = JSON.stringify(input)
  withNextFederation(input)
  expect(JSON.stringify(input)).toBe(snapshot)
})

test('does not duplicate @next-federation/next in transpilePackages', () => {
  const c = loose(
    withNextFederation({ transpilePackages: ['@next-federation/next'] })
  )
  expect(c.transpilePackages).toEqual(['@next-federation/next'])
})

test('supports a config function', async () => {
  const fn = withNextFederation(async (phase: string) => ({
    basePath: phase === 'phase-production-build' ? '/p' : '',
    cacheComponents: true,
  }))
  expect(typeof fn).toBe('function')
  const c = loose(await fn('phase-production-build', { defaultConfig: {} }))
  expect(c.env).toEqual({
    NF_CACHE_MODEL: 'cache-components',
    NF_BASE_PATH: '/p',
    NF_NEXT_VERSION: '16.4.6',
  })
  expect(c.turbopack.resolveAlias[ALIAS]).toBe(CC)
})

test('supports a synchronous config function', async () => {
  const fn = withNextFederation(() => ({}))
  const c = loose(await fn('phase-development-server', {}))
  expect(c.env.NF_CACHE_MODEL).toBe('legacy')
})

test('@next-federation/next in serverExternalPackages is NF-002', () => {
  expectCode(
    () =>
      withNextFederation({ serverExternalPackages: ['@next-federation/next'] }),
    'NF-002'
  )
  expectCode(
    () =>
      withNextFederation({
        serverExternalPackages: ['sharp', '@next-federation/core'],
      }),
    'NF-002'
  )
  expect(() =>
    withNextFederation({ serverExternalPackages: ['sharp'] })
  ).not.toThrow()
})

test('a config function with serverExternalPackages rejects with NF-002', async () => {
  const fn = withNextFederation(() => ({
    serverExternalPackages: ['@next-federation/server'],
  }))
  const error = await Promise.resolve(fn('x', {})).catch((e: unknown) => e)
  expect(isNFError(error)).toBe(true)
  expect((error as { code: string }).code).toBe('NF-002')
})

describe('assert-wrapped', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  test('cacheModel() without the env is NF-017', () => {
    delete process.env.NF_CACHE_MODEL
    expectCode(() => cacheModel(), 'NF-017')
  })

  test('cacheModel() with an unknown value is NF-017', () => {
    process.env.NF_CACHE_MODEL = 'bogus'
    expectCode(() => cacheModel(), 'NF-017')
  })

  test('cacheModel() returns the model the wrapper set', () => {
    process.env.NF_CACHE_MODEL = 'legacy'
    expect(cacheModel()).toBe('legacy')
    process.env.NF_CACHE_MODEL = 'cache-components'
    expect(cacheModel()).toBe('cache-components')
  })

  test('hostBasePath() without the wrapper env is NF-017', () => {
    delete process.env.NF_CACHE_MODEL
    process.env.NF_BASE_PATH = '/base'
    expectCode(() => hostBasePath(), 'NF-017')
  })

  test('hostBasePath() returns NF_BASE_PATH or the empty string', () => {
    process.env.NF_CACHE_MODEL = 'legacy'
    process.env.NF_BASE_PATH = '/base'
    expect(hostBasePath()).toBe('/base')
    delete process.env.NF_BASE_PATH
    expect(hostBasePath()).toBe('')
  })

  test('the wrapper env satisfies cacheModel() and hostBasePath()', () => {
    const c = loose(withNextFederation({ basePath: '/b' }))
    Object.assign(process.env, c.env)
    expect(cacheModel()).toBe('legacy')
    expect(hostBasePath()).toBe('/b')
  })
})

test('an unreadable Next version is NF-002 at config time (remote components need it)', async () => {
  rs.resetModules()
  rs.doMock('node:module', () => ({
    createRequire: () => () => ({ version: undefined }),
  }))
  const { withNextFederation: wrap } = await import('../src/config.ts')
  expectCode(() => wrap({}), 'NF-002')
  rs.doUnmock('node:module')
  rs.resetModules()
})

describe('Next 15 (no stable cacheLife in next/cache)', () => {
  // A Next 15 install: `next/cache` has `unstable_cacheLife` only, which is
  // how the wrapper tells that cacheComponents is unavailable.
  async function next15() {
    rs.resetModules()
    rs.doMock('node:module', () => ({
      createRequire: () => (id: string) =>
        id === 'next/package.json'
          ? { version: '15.5.28' }
          : { unstable_cacheLife: () => undefined },
    }))
    const mod = await import('../src/config.ts')
    return mod.withNextFederation
  }
  afterEach(() => {
    rs.doUnmock('node:module')
    rs.resetModules()
  })

  test('the legacy model works, with the installed version', async () => {
    const wrap = await next15()
    const c = loose(wrap({ basePath: '/b' }))
    expect(c.env).toEqual({
      NF_CACHE_MODEL: 'legacy',
      NF_BASE_PATH: '/b',
      NF_NEXT_VERSION: '15.5.28',
    })
    expect(c.turbopack.resolveAlias[ALIAS]).toBe(LEGACY)
    expect(runWebpack(c).resolve.alias[`${ALIAS}$`]).toBe(LEGACY)
  })

  test('cacheComponents is NF-002 (Next 16 only)', async () => {
    const wrap = await next15()
    expectCode(() => wrap({ cacheComponents: true }), 'NF-002')
    let message = ''
    try {
      wrap({ cacheComponents: true })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('Next.js 16')
    expect(message).toContain('15.5.28')
    // false is the legacy model.
    expect(loose(wrap({ cacheComponents: false })).env.NF_CACHE_MODEL).toBe(
      'legacy'
    )
  })

  test("Next 15's experimental cache-components flags are NF-002", async () => {
    const wrap = await next15()
    for (const flag of ['dynamicIO', 'cacheComponents']) {
      expectCode(
        () => wrap({ experimental: { [flag]: true } } as unknown as NextConfig),
        'NF-002'
      )
    }
    expect(() =>
      wrap({ experimental: { dynamicIO: false } } as unknown as NextConfig)
    ).not.toThrow()
  })

  test('a config function with cacheComponents rejects with NF-002', async () => {
    const wrap = await next15()
    const fn = wrap(() => ({ cacheComponents: true }))
    const error = await Promise.resolve(fn('x', {})).catch((e: unknown) => e)
    expect(isNFError(error)).toBe(true)
    expect((error as { code: string }).code).toBe('NF-002')
  })
})

test('Next 16 keeps experimental flags out of the check (Next validates them)', () => {
  // The real install (next 16.4.6): cacheComponents works, and the wrapper
  // never inspects `experimental`.
  const c = loose(
    withNextFederation({
      cacheComponents: true,
      experimental: { dynamicIO: true },
    } as unknown as NextConfig)
  )
  expect(c.env.NF_CACHE_MODEL).toBe('cache-components')
})

test("the Next version is looked up from the calling next.config's folder (and cwd)", async () => {
  rs.resetModules()
  const seen: Array<string | null> = []
  rs.doMock('../src/installed-next.ts', () => ({
    nextProjectDir: (stack: string | undefined) => {
      // The real parser, without the next.config check (this spec's folder
      // has none).
      return callerDir(stack)
    },
    installedNext: (projectDir: string | null) => {
      seen.push(projectDir)
      return { version: '15.5.28', path: 'x', cacheComponents: false }
    },
  }))
  const { withNextFederation: wrap } = await import('../src/config.ts')
  expect(loose(wrap({})).env.NF_NEXT_VERSION).toBe('15.5.28')
  await wrap(() => ({}))('x', {})
  // This spec file is the caller here, as a host's next.config is.
  const here = dirname(fileURLToPath(import.meta.url))
  expect(seen).toEqual([here, here])
  rs.doUnmock('../src/installed-next.ts')
  rs.resetModules()
})
