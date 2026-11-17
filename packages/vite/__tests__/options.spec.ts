import { isNFError } from '@next-federation/sdk'
import { resolveOptions } from '../src/options.ts'
import type { IslandRemoteOptions, ResolveContext } from '../src/options.ts'

const opts: IslandRemoteOptions = {
  name: 'shop',
  base: 'https://r.example/',
  islands: { Panel: './src/islands/Panel.tsx' },
  hosts: ['https://host.example'],
}
const serve = { command: 'serve' as const, env: {}, now: 0 }
const build = { command: 'build' as const, env: {}, now: 0 }

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (error) {
    return isNFError(error) ? error.code : `not an NFError: ${String(error)}`
  }
  return undefined
}

test('unversioned serve: publicBase is base, buildId "dev", mode development', () => {
  const r = resolveOptions(opts, serve)
  expect(r.publicBase).toBe('https://r.example/')
  expect(r.scopeKey).toBe(r.publicBase)
  expect(r.buildId).toBe('dev')
  expect(r.mode).toBe('development')
  expect(r.outDir).toBe('dist')
})

test('versioned build: publicBase and outDir carry the buildId', () => {
  const r = resolveOptions(
    { ...opts, base: 'https://r.example', buildId: 'v2' },
    { command: 'build', env: {}, now: 0 }
  )
  expect(r.publicBase).toBe('https://r.example/b/v2/')
  expect(r.outDir).toBe('dist/v2')
  expect(r.mode).toBe('production')
  expect(r.scopeKey).toBe('https://r.example/b/v2/')
})

test('a base with a path keeps it and always ends with "/"', () => {
  const r = resolveOptions(
    { ...opts, base: 'https://r.example/remote', buildId: 'v1' },
    build
  )
  expect(r.publicBase).toBe('https://r.example/remote/b/v1/')
})

test('versioned can be forced either way', () => {
  expect(resolveOptions({ ...opts, versioned: true }, serve).publicBase).toBe(
    'https://r.example/b/dev/'
  )
  const r = resolveOptions({ ...opts, versioned: false, buildId: 'x' }, build)
  expect(r.publicBase).toBe('https://r.example/')
  expect(r.outDir).toBe('dist')
})

test('NF_BUILD_ID env is used when no option is given', () => {
  const r = resolveOptions(opts, { ...build, env: { NF_BUILD_ID: 'ci-42' } })
  expect(r.buildId).toBe('ci-42')
  expect(r.publicBase).toBe('https://r.example/b/ci-42/')
  // The option wins over the env.
  expect(
    resolveOptions(
      { ...opts, buildId: 'opt' },
      { ...build, env: { NF_BUILD_ID: 'ci-42' } }
    ).buildId
  ).toBe('opt')
})

test('a build without any buildId uses the clock in base 36', () => {
  const r = resolveOptions(opts, { ...build, now: 1_700_000_000_000 })
  expect(r.buildId).toBe((1_700_000_000_000).toString(36))
})

test('relative base is NF-020', () => {
  expect(codeOf(() => resolveOptions({ ...opts, base: '/' }, serve))).toBe(
    'NF-020'
  )
  expect(
    codeOf(() => resolveOptions({ ...opts, base: './remote/' }, serve))
  ).toBe('NF-020')
  expect(
    codeOf(() => resolveOptions({ ...opts, base: 'file:///tmp/' }, serve))
  ).toBe('NF-020')
  expect(
    codeOf(() =>
      resolveOptions({ ...opts, base: 'https://r.example/?a=1' }, serve)
    )
  ).toBe('NF-020')
})

test('hosts ["*"] is NF-002', () => {
  expect(codeOf(() => resolveOptions({ ...opts, hosts: ['*'] }, serve))).toBe(
    'NF-002'
  )
  expect(
    codeOf(() =>
      resolveOptions({ ...opts, hosts: ['https://host.example/app'] }, serve)
    )
  ).toBe('NF-002')
  expect(
    codeOf(() => resolveOptions({ ...opts, hosts: ['host.example'] }, serve))
  ).toBe('NF-002')
})

test('buildId with a slash is NF-002', () => {
  expect(codeOf(() => resolveOptions({ ...opts, buildId: 'a/b' }, build))).toBe(
    'NF-002'
  )
  expect(
    codeOf(() => resolveOptions(opts, { ...build, env: { NF_BUILD_ID: '..' } }))
  ).toBe('NF-002')
})

test('bad names and empty islands are NF-002', () => {
  expect(codeOf(() => resolveOptions({ ...opts, name: '1shop' }, serve))).toBe(
    'NF-002'
  )
  expect(codeOf(() => resolveOptions({ ...opts, islands: {} }, serve))).toBe(
    'NF-002'
  )
  expect(
    codeOf(() =>
      resolveOptions({ ...opts, islands: { 'bad name': './a.tsx' } }, serve)
    )
  ).toBe('NF-002')
  expect(
    codeOf(() => resolveOptions({ ...opts, islands: { A: '' } }, serve))
  ).toBe('NF-002')
})

test('issuer JWKS URLs must be absolute http(s) URLs', () => {
  expect(
    codeOf(() =>
      resolveOptions({ ...opts, issuers: { 'https://h': '/jwks' } }, serve)
    )
  ).toBe('NF-002')
  const r = resolveOptions(
    { ...opts, issuers: { 'https://h': 'https://h/jwks' } },
    serve
  )
  expect(r.issuers).toEqual({ 'https://h': 'https://h/jwks' })
})

test('maxAge defaults to 60 and must be a non-negative integer', () => {
  expect(resolveOptions(opts, serve).maxAge).toBe(60)
  expect(resolveOptions({ ...opts, maxAge: 0 }, serve).maxAge).toBe(0)
  expect(codeOf(() => resolveOptions({ ...opts, maxAge: -1 }, serve))).toBe(
    'NF-002'
  )
})

test('string and object island entries normalise to { entry, private }', () => {
  const r = resolveOptions(
    {
      ...opts,
      islands: {
        A: './a.tsx',
        B: { entry: './b.tsx' },
        C: { entry: './c.tsx', private: true },
      },
    },
    serve
  )
  expect(r.islands).toEqual({
    A: { entry: './a.tsx', private: false },
    B: { entry: './b.tsx', private: false },
    C: { entry: './c.tsx', private: true },
  })
  expect(r.hosts).toEqual(['https://host.example'])
  expect(r.issuers).toEqual({})
  expect(r.name).toBe('shop')
})

test('outDir: versioned builds go to <outDir>/<buildId>, serve to <outDir>', () => {
  expect(
    resolveOptions({ ...opts, outDir: 'dist/a/', buildId: 'v1' }, build).outDir
  ).toBe('dist/a/v1')
  expect(resolveOptions({ ...opts, outDir: 'out' }, serve).outDir).toBe('out')
  expect(codeOf(() => resolveOptions({ ...opts, outDir: ' ' }, build))).toBe(
    'NF-002'
  )
})

test('outDir: trimming trailing slashes is linear on a long run of inner slashes', () => {
  // `/\/+$/` retries the slash run from every start position: quadratic.
  const outDir = `dist${'/'.repeat(100_000)}x`
  const started = performance.now()
  const r = resolveOptions(
    { ...opts, outDir: `${outDir}//`, buildId: 'v1' },
    build
  )
  expect(performance.now() - started).toBeLessThan(100)
  expect(r.outDir).toBe(`${outDir}/v1`)
})

test.each(['_canary', '-x', 'x'.repeat(129), '.', '..'])(
  'buildId %j is NF-002 (one pattern with nf-serve and the descriptor)',
  (buildId) => {
    expect(codeOf(() => resolveOptions({ ...opts, buildId }, build))).toBe(
      'NF-002'
    )
  }
)

describe('plain http for a non-loopback host', () => {
  const prodBuild = { ...build, env: { NODE_ENV: 'production' } }
  const messageOf = (
    o: IslandRemoteOptions,
    ctx: ResolveContext = prodBuild
  ) => {
    try {
      resolveOptions(o, ctx)
    } catch (error) {
      expect(isNFError(error, 'NF-002')).toBe(true)
      return (error as Error).message
    }
    return 'none'
  }

  test('an http base or JWKS URL is NF-002 in a production build', () => {
    expect(messageOf({ ...opts, base: 'http://r.example/app/' })).toMatch(
      /`base`.*https.*http:\/\/r\.example\b/
    )
    expect(
      messageOf({ ...opts, issuers: { 'https://h': 'http://h.example/jwks' } })
    ).toMatch(/issuers.*http:\/\/h\.example/)
  })

  test('loopback, the dev server, NODE_ENV=test and the opt-in are accepted', () => {
    expect(messageOf({ ...opts, base: 'http://localhost:4100/' })).toBe('none')
    expect(messageOf({ ...opts, base: 'http://127.0.0.1:4100/' })).toBe('none')
    expect(messageOf({ ...opts, base: 'http://r.example/' }, serve)).toBe(
      'none'
    )
    expect(
      messageOf(
        { ...opts, base: 'http://r.example/' },
        { ...build, env: { NODE_ENV: 'test' } }
      )
    ).toBe('none')
    const r = resolveOptions(
      { ...opts, base: 'http://r.example/', allowInsecureHttp: true },
      prodBuild
    )
    expect(r.allowInsecureHttp).toBe(true)
    expect(resolveOptions(opts, prodBuild).allowInsecureHttp).toBe(false)
  })
})

test('actions: requireIdentity defaults to false, maxBodyBytes to 1 MiB, both validated', () => {
  const r = resolveOptions(opts, serve)
  expect(r.actionsRequireIdentity).toBe(false)
  expect(r.maxActionBodyBytes).toBe(1_048_576)
  const set = resolveOptions(
    { ...opts, actions: { requireIdentity: true, maxBodyBytes: 4096 } },
    build
  )
  expect(set.actionsRequireIdentity).toBe(true)
  expect(set.maxActionBodyBytes).toBe(4096)
  // No client-side action timeout unless the remote sets one.
  expect(r.actionTimeoutMs).toBeNull()
  expect(
    resolveOptions({ ...opts, actions: { timeoutMs: 15_000 } }, build)
      .actionTimeoutMs
  ).toBe(15_000)
  for (const actions of [
    { timeoutMs: 0 },
    { timeoutMs: 2.5 },
    { timeoutMs: '10s' },
    { requireIdentity: 'yes' },
    { maxBodyBytes: 0 },
    { maxBodyBytes: 1.5 },
    { maxBodyBytes: -1 },
    'on',
    null,
  ]) {
    expect(
      codeOf(() =>
        resolveOptions(
          { ...opts, actions: actions as IslandRemoteOptions['actions'] },
          serve
        )
      )
    ).toBe('NF-002')
  }
})
