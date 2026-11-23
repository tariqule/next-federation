// The Vite config the components remote plugin adds in dev.
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { Plugin, UserConfig } from 'vite'
import { isNFError, logger } from '@next-federation/sdk'
import { resolveComponentsOptions } from '../src/components/options.ts'
import { nextFederationComponents } from '../src/components/plugin.ts'
import { mfSharedConfig } from '../src/components/shared.ts'

const ENV_KEYS = ['NF_VITE_COMMAND', 'MFE_VITE_NO_TEST_ENV_CHECK']
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  process.env.NF_VITE_COMMAND = 'serve'
  process.env.MFE_VITE_NO_TEST_ENV_CHECK = 'true'
})

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function devConfig(user: UserConfig): UserConfig {
  const plugins = nextFederationComponents({
    name: 'shop',
    base: 'http://localhost:4110/',
    exposes: { './Counter': './src/Counter.tsx' },
  }) as Plugin[]
  const nf = plugins.find((p) => p.name === 'nf:components')!
  const config = nf.config as (
    user: UserConfig,
    env: { command: 'serve'; mode: string }
  ) => UserConfig
  return config(user, { command: 'serve', mode: 'development' })
}

test("dev: the host's browser console is not forwarded to the remote's terminal, unless the remote asks for it", () => {
  expect(devConfig({}).server?.forwardConsole).toBe(false)
  expect(
    devConfig({ server: { forwardConsole: true } }).server?.forwardConsole
  ).toBeUndefined()
})

describe('dev: a page of the project served by the remote (B3)', () => {
  type Req = { url: string; method: string; headers: Record<string, string> }
  type Middleware = (req: Req, res: unknown, next: () => void) => void
  function devMiddlewares(): Middleware[] {
    const plugins = nextFederationComponents({
      name: 'shop',
      base: 'http://localhost:4110/',
      exposes: { './Counter': './src/Counter.tsx' },
    }) as Plugin[]
    const nf = plugins.find((p) => p.name === 'nf:components')!
    const used: Middleware[] = []
    ;(nf.configureServer as (server: unknown) => void)({
      middlewares: { use: (fn: Middleware) => used.push(fn) },
    })
    return used
  }
  const request = (url: string, accept: string): Req => ({
    url,
    method: 'GET',
    headers: { accept },
  })
  const run = (mws: Middleware[], req: Req) => {
    let passed = 0
    for (const mw of mws) mw(req, {}, () => passed++)
    return passed
  }

  test('warns NF-002 once, pointing to the two-config setup, and still serves the page', () => {
    const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const mws = devMiddlewares()
      const html = 'text/html,application/xhtml+xml,*/*;q=0.8'
      expect(run(mws, request('/', html))).toBe(mws.length)
      run(mws, request('/index.html', html))
      const nf002 = warn.mock.calls
        .map((args: unknown[]) => args.join(' '))
        .filter((line: string) => line.includes('NF-002'))
      expect(nf002).toHaveLength(1)
      expect(nf002[0]).toContain('host-provided')
      expect(nf002[0]).toContain(
        'remote-components.md#keeping-a-standalone-app'
      )
    } finally {
      warn.mockRestore()
    }
  })

  test('a browser tab opening the manifest, the descriptor or another file of the remote does not warn; a page does', () => {
    // logger.warnOnce itself, so an earlier warning in this file does not hide a call.
    const warnOnce = rs.spyOn(logger, 'warnOnce').mockImplementation(() => {})
    try {
      const mws = devMiddlewares()
      const tab = (url: string): Req => ({
        url,
        method: 'GET',
        headers: {
          accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          'sec-fetch-dest': 'document',
        },
      })
      for (const url of [
        '/mf-manifest.json',
        '/mf-manifest.json?x=1',
        '/_nf/components.json',
        '/remoteEntry.js',
        '/src/Counter.tsx',
        '/assets/logo.svg',
      ]) {
        run(mws, tab(url))
      }
      expect(warnOnce).not.toHaveBeenCalled()
      run(mws, tab('/'))
      run(mws, tab('/about'))
      run(mws, tab('/index.html'))
      expect(warnOnce).toHaveBeenCalledTimes(3)
      // An HTML-accepting request that is not a document (a fetch, an
      // iframe-less tool): no warning.
      warnOnce.mockClear()
      run(mws, {
        url: '/',
        method: 'GET',
        headers: { accept: 'text/html', 'sec-fetch-dest': 'empty' },
      })
      expect(warnOnce).not.toHaveBeenCalled()
    } finally {
      warnOnce.mockRestore()
    }
  })

  test('module, manifest and descriptor requests (what a host loads) never warn', () => {
    const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const mws = devMiddlewares()
      run(mws, request('/remoteEntry.js', '*/*'))
      run(mws, request('/mf-manifest.json', 'application/json'))
      run(mws, request('/src/Counter.tsx', '*/*'))
      expect(
        warn.mock.calls.filter((args: unknown[]) =>
          args.join(' ').includes('NF-002')
        )
      ).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })
})

describe('the React range a components remote accepts', () => {
  const ctx = {
    command: 'build' as const,
    env: {},
    now: 1_700_000_000_000,
  }
  const base = {
    name: 'shop',
    base: 'https://shop.example.com',
    exposes: { './Counter': './src/Counter.tsx' },
  }
  const reactModules = [
    'react',
    'react-dom',
    'react-dom/client',
    'react/jsx-runtime',
  ]

  test('react: "^18.3.0 || ^19.0.0" is the requiredVersion of react, react-dom, react-dom/client and react/jsx-runtime', () => {
    const resolved = resolveComponentsOptions(
      { ...base, react: '^18.3.0 || ^19.0.0' },
      ctx
    )
    for (const name of reactModules) {
      expect(resolved.shared[name]).toEqual({
        requiredVersion: '^18.3.0 || ^19.0.0',
        fallback: false,
      })
    }
  })

  test('react: "banana" throws NF-002', () => {
    let error: unknown
    try {
      resolveComponentsOptions({ ...base, react: 'banana' }, ctx)
    } catch (e) {
      error = e
    }
    expect(isNFError(error) && error.code).toBe('NF-002')
  })

  test('a non-string react throws NF-002', () => {
    expect(() =>
      resolveComponentsOptions({ ...base, react: 19 as unknown as string }, ctx)
    ).toThrow(/NF-002/)
  })

  test('default stays ^19.0.0', () => {
    const resolved = resolveComponentsOptions(base, ctx)
    for (const name of reactModules) {
      expect(resolved.shared[name]?.requiredVersion).toBe('^19.0.0')
    }
  })
})

describe('remote router imports rewired (links)', () => {
  const ROUTER = '@next-federation/router'
  const routerDir = realpathSync(resolve(import.meta.dirname, '../../router'))
  const routerVersion = (
    JSON.parse(readFileSync(join(routerDir, 'package.json'), 'utf8')) as {
      version: string
    }
  ).version
  const ctx = {
    command: 'build' as const,
    env: {},
    now: 1_700_000_000_000,
  }
  const base = {
    name: 'shop',
    base: 'https://shop.example.com',
    exposes: { './Header': './src/Header.tsx' },
  }
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nf-vite-links-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  type Handler = (
    this: unknown,
    source: string,
    importer: string | undefined,
    options: object
  ) => Promise<unknown>

  /**
   * The plugin after its `config` hook ran for this root: the aliases it
   * gave Vite, and the router shims' `resolveId` handler.
   */
  function configured(
    options: Partial<Parameters<typeof nextFederationComponents>[0]> = {}
  ): {
    aliases: Array<{ find: RegExp; replacement: string }>
    resolveId: Handler
    /** The server environment's `resolve.noExternal`. */
    serverNoExternal: unknown
  } {
    const plugins = nextFederationComponents({
      ...base,
      ...options,
    }) as Plugin[]
    const nf = plugins.find((p) => p.name === 'nf:components')!
    const shims = plugins.find((p) => p.name === 'nf:components-router-shims')!
    const config = (
      nf.config as (
        user: UserConfig,
        env: { command: 'serve'; mode: string }
      ) => UserConfig
    )({ root }, { command: 'serve', mode: 'development' })
    return {
      aliases: (config.resolve?.alias ?? []) as Array<{
        find: RegExp
        replacement: string
      }>,
      resolveId: (shims.resolveId as { handler: Handler }).handler,
      serverNoExternal: config.environments?.ssr?.resolve?.noExternal,
    }
  }
  const configAliases = (
    options: Partial<Parameters<typeof nextFederationComponents>[0]> = {}
  ) => configured(options).aliases

  /** A plugin context whose `this.resolve` records its calls and gives `id`. */
  function context(id: string | null, calls: Array<[string, string]> = []) {
    return {
      resolve: async (source: string, importer: string) => {
        calls.push([source, importer])
        return id === null ? null : { id }
      },
    }
  }

  /** The root's package.json, with these fields. */
  const manifest = (fields: Record<string, unknown>) =>
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'shop', ...fields })
    )

  /** A `react-router` package at `version` in `dir`; its entry file. */
  const fakeReactRouter = (dir: string, version: string) => {
    mkdirSync(join(dir, 'dist'), { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'react-router', version })
    )
    writeFileSync(join(dir, 'dist', 'index.mjs'), 'export {}\n')
    return join(dir, 'dist', 'index.mjs')
  }

  test("default: @next-federation/router shared with a fallback, this plugin's own copy and version", () => {
    const resolved = resolveComponentsOptions(base, ctx)
    expect(resolved.links).toBe(true)
    expect(resolved.shared[ROUTER]).toEqual({
      requiredVersion: `>=0.${routerVersion.split('.')[1]}.0 <1.0.0`,
      fallback: true,
      import: join(routerDir, 'dist', 'index.js'),
      version: routerVersion,
    })
    expect(mfSharedConfig(resolved)[ROUTER]).toEqual({
      singleton: false,
      requiredVersion: `>=0.${routerVersion.split('.')[1]}.0 <1.0.0`,
      import: join(routerDir, 'dist', 'index.js'),
      version: routerVersion,
    })
    // Listed with a fallback (another range): still this plugin's copy.
    expect(
      resolveComponentsOptions(
        {
          ...base,
          shared: { [ROUTER]: { requiredVersion: '>=9.0.0', fallback: true } },
        },
        ctx
      ).shared[ROUTER]
    ).toEqual({
      requiredVersion: '>=9.0.0',
      fallback: true,
      import: join(routerDir, 'dist', 'index.js'),
      version: routerVersion,
    })
    // Listed as a bare specifier: host-provided only, as the user asked.
    expect(
      resolveComponentsOptions({ ...base, shared: [ROUTER] }, ctx).shared[
        ROUTER
      ]
    ).toEqual({ requiredVersion: false, fallback: false })
  })

  test('next/link and next/navigation are aliased to the shims (exact, absolute)', () => {
    const aliases = configAliases()
    expect(aliases.map((a) => a.find.source).sort()).toEqual([
      '^next\\/link$',
      '^next\\/navigation$',
    ])
    for (const { find, replacement } of aliases) {
      expect(replacement.startsWith(join(routerDir, 'src', 'shims'))).toBe(true)
      expect(find.test(find.source.slice(1, -1).replace(/\\/g, ''))).toBe(true)
    }
    const link = aliases.find((a) => a.find.test('next/link'))!
    expect(link.find.test('next/link/x')).toBe(false)
    expect(link.find.test('xnext/link')).toBe(false)
  })

  test('the server build bundles React Router and the packages it depends on, by name (transitively, from its own folder; React and peers stay shared); none without the shim', () => {
    const pkgJson = (dir: string, fields: Record<string, unknown>) => {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify(fields))
    }
    // pnpm's layout: the real folder, its dependencies next to it.
    const store = join(root, '.store', 'react-router', 'node_modules')
    pkgJson(join(store, 'react-router'), {
      name: 'react-router',
      version: '7.18.6',
      dependencies: { cookie: '^1.0.0', react: '^19.0.0', hoisted: '^1.0.0' },
      peerDependencies: { 'react-dom': '>=18' },
    })
    pkgJson(join(store, 'cookie'), {
      name: 'cookie',
      dependencies: { nested: '^1.0.0' },
    })
    pkgJson(join(store, 'nested'), { name: 'nested' })
    // Hoisted: in the root's node_modules.
    pkgJson(join(root, 'node_modules', 'hoisted'), { name: 'hoisted' })
    symlinkSync(
      join(store, 'react-router'),
      join(root, 'node_modules', 'react-router')
    )
    expect(configured().serverNoExternal).toBeUndefined()
    manifest({ dependencies: { 'react-router': '^7.0.0' } })
    expect([...(configured().serverNoExternal as string[])].sort()).toEqual([
      'cookie',
      'hoisted',
      'nested',
      'react-router',
      'react-router-dom',
    ])
    expect(configured({ links: false }).serverNoExternal).toBeUndefined()
    // React Router 6 at the root: React Router is left alone, nothing bundled
    // for it.
    pkgJson(join(store, 'react-router'), {
      name: 'react-router',
      version: '6.30.0',
      dependencies: { cookie: '^1.0.0' },
    })
    expect(configured().serverNoExternal).toBeUndefined()
    // react-router-dom only, react-router not in the root's node_modules
    // (pnpm): the same.
    rmSync(join(root, 'node_modules', 'react-router'))
    manifest({ dependencies: { 'react-router-dom': '^7.0.0' } })
    expect(configured().serverNoExternal).toBeUndefined()
  })

  test("react-router and react-router-dom go to the shim only when the root's package.json declares one and react-router 7 resolves; the real package is what Vite resolves from the remote's source", async () => {
    const shim = join(routerDir, 'src', 'shims', 'react-router.tsx')
    const from = join(root, 'src', 'Header.tsx')
    const real = fakeReactRouter(
      join(root, 'node_modules', 'react-router'),
      '7.18.6'
    )
    // Not declared (an install found through NODE_PATH, a parent folder or
    // Node's global folders does not count): left alone.
    let { resolveId } = configured()
    expect(await resolveId.call(context(real), 'react-router', from, {})).toBe(
      null
    )
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
    ]) {
      manifest({ [field]: { 'react-router-dom': '^7.0.0' } })
      ;({ resolveId } = configured())
      expect(
        await resolveId.call(context(real), 'react-router', from, {}),
        field
      ).toBe(shim)
      expect(
        await resolveId.call(context(real), 'react-router-dom', from, {})
      ).toBe(shim)
    }
    manifest({ optionalDependencies: { 'react-router': '^7.0.0' } })
    ;({ resolveId } = configured())
    expect(await resolveId.call(context(real), 'react-router', from, {})).toBe(
      null
    )
    manifest({ dependencies: { 'react-router': '^7.0.0' } })
    ;({ resolveId } = configured())
    // The shim's own import of the real package: Vite's resolution of
    // `react-router` from the remote's source, never the shim again.
    const calls: Array<[string, string]> = []
    expect(
      await resolveId.call(
        context(real, calls),
        '@next-federation/router/real-react-router',
        shim,
        {}
      )
    ).toEqual({ id: real })
    expect(calls).toEqual([['react-router', from]])
    expect(await resolveId.call(context(real), 'react-router', shim, {})).toBe(
      null
    )
    // The shim imported although react-router does not resolve: NF-002
    // naming react-router 7, not a silent shim loop.
    ;({ resolveId } = configured())
    const warn = rs.spyOn(logger, 'warnOnce').mockImplementation(() => {})
    await expect(
      resolveId.call(
        context(null),
        '@next-federation/router/real-react-router',
        shim,
        {}
      )
    ).rejects.toThrow(/NF-002[\s\S]*react-router 7, which does not resolve/)
    warn.mockRestore()
    // The private name from any other importer is not resolved here.
    expect(
      await resolveId.call(
        context(real),
        '@next-federation/router/real-react-router',
        from,
        {}
      )
    ).toBe(null)
    expect(
      await resolveId.call(context('/x'), 'react-router/dom', from, {})
    ).toBe(null)
  })

  test.each([
    [
      'react-router-dom 6 (react-router 6 resolves)',
      () =>
        fakeReactRouter(join(root, 'node_modules', 'react-router'), '6.30.0'),
      /the react-router that resolves is 6\.30\.0, not React Router 7/,
    ],
    [
      'react-router-dom 7, react-router does not resolve from the root (pnpm)',
      () => null,
      /react-router does not resolve/,
    ],
  ])(
    '%s: react-router and react-router-dom are left alone, with one NF-002 warning (how to rewire them, or links: false); next/link is still rewired',
    async (_name, install, reason) => {
      manifest({ dependencies: { 'react-router-dom': '^7.0.0' } })
      const real = install()
      const warn = rs.spyOn(logger, 'warnOnce').mockImplementation(() => {})
      try {
        const { aliases, resolveId } = configured()
        const from = join(root, 'src', 'Header.tsx')
        for (const source of [
          'react-router-dom',
          'react-router',
          'react-router-dom',
        ]) {
          expect(
            await resolveId.call(context(real), source, from, {}),
            source
          ).toBe(null)
        }
        // One resolution, one warning.
        expect(warn).toHaveBeenCalledTimes(1)
        const [code, , message] = warn.mock.calls[0]!
        expect(code).toBe('NF-002')
        expect(message).toMatch(reason)
        expect(message).toContain(
          `${join(root, 'package.json')} declares react-router-dom`
        )
        expect(message).toContain('add react-router 7 as a direct dependency')
        expect(message).toContain('`links: false`')
        expect(aliases.some((a) => a.find.test('next/link'))).toBe(true)
      } finally {
        warn.mockRestore()
      }
    }
  )

  test('the React Router keys are one group: listing react-router or react-router-dom in shared rewires neither', async () => {
    manifest({ dependencies: { 'react-router': '^7.0.0' } })
    const from = join(root, 'src', 'Header.tsx')
    for (const listed of ['react-router', 'react-router-dom']) {
      const { resolveId } = configured({ shared: [listed] })
      for (const source of ['react-router', 'react-router-dom']) {
        expect(
          await resolveId.call(context('/x'), source, from, {}),
          `${listed} listed, ${source}`
        ).toBe(null)
      }
    }
    // links: false rewires nothing either.
    const { resolveId } = configured({ links: false })
    expect(await resolveId.call(context('/x'), 'react-router', from, {})).toBe(
      null
    )
  })

  test("a shim's @next-federation/router import: only Module Federation's share module is taken from the remote's root, never a file found there", async () => {
    const { aliases, resolveId } = configured()
    const link = aliases.find((a) => a.find.test('next/link'))!.replacement
    const calls: Array<[string, string]> = []
    const share =
      '\0virtual:mf:links__loadShare___mf_0_next_mf_2_federation_mf_1_router__loadShare__.js'
    expect(
      await resolveId.call(context(share, calls), ROUTER, link, {})
    ).toEqual({ id: share })
    // Resolved as an import of the remote's own source (its first expose).
    expect(calls).toEqual([[ROUTER, join(root, 'src', 'Header.tsx')]])
    // A planted copy found from the root is dropped (null: the shim's own
    // resolution, in this plugin's install), also one whose path contains
    // Module Federation's tag or folder name.
    for (const planted of [
      join(root, '..', 'node_modules', ROUTER, 'dist/index.js'),
      join(root, '..', 'node_modules', ROUTER, 'x__loadShare__y.js'),
      join(root, 'node_modules', '__mf__virtual', 'r__loadShare__r.js'),
      `${join(root, 'x')}\0virtual:mf:a__loadShare__b.js`,
      // Another package's share proxy.
      '\0virtual:mf:links__loadShare__react__loadShare__.js',
    ]) {
      expect(
        await resolveId.call(context(planted), ROUTER, link, {}),
        planted
      ).toBeNull()
    }
    // Other importers and specifiers are left alone.
    expect(
      await resolveId.call(context(share), ROUTER, join(root, 'src/x.ts'), {})
    ).toBeNull()
    expect(await resolveId.call(context(share), 'react', link, {})).toBeNull()
  })

  test('a specifier listed in shared keeps its sharing (not rewired)', () => {
    const aliases = configAliases({ shared: ['next/link'] })
    expect(aliases.map((a) => a.find.source)).toEqual(['^next\\/navigation$'])
  })

  test('links: false → no aliases, no entry', () => {
    expect(configAliases({ links: false })).toEqual([])
    const resolved = resolveComponentsOptions({ ...base, links: false }, ctx)
    expect(resolved.shared).not.toHaveProperty(ROUTER)
    expect(Object.keys(resolved.shared).sort()).toEqual(
      ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'].sort()
    )
    expect(() =>
      resolveComponentsOptions(
        { ...base, links: 'no' as unknown as boolean },
        ctx
      )
    ).toThrow(/NF-002/)
  })
})

describe('remote router imports rewired: real builds (needs `pnpm build`)', () => {
  // A project inside this package's node_modules, so vite and react resolve;
  // with a router planted in a parent node_modules of the project.
  const pkg = resolve(import.meta.dirname, '..')
  const vite = join(pkg, 'node_modules', 'vite', 'bin', 'vite.js')
  const plugin = join(pkg, 'dist', 'index.js')
  let parent: string
  beforeAll(() => {
    parent = mkdtempSync(join(pkg, 'node_modules', '.nf-links-spec-'))
    const planted = join(parent, 'node_modules', '@next-federation', 'router')
    mkdirSync(join(planted, 'dist'), { recursive: true })
    writeFileSync(
      join(planted, 'package.json'),
      JSON.stringify({
        name: '@next-federation/router',
        version: '0.1.99',
        type: 'module',
        exports: { '.': './dist/index.js', './package.json': './package.json' },
      })
    )
    writeFileSync(
      join(planted, 'dist', 'index.js'),
      [
        "const planted = 'PLANTED_ROUTER_MARKER'",
        'export const Link = () => planted',
        'export const useNavigate = () => () => planted',
        'export const usePathname = () => planted',
        'export const useSearchParams = () => planted',
      ].join('\n')
    )
  })
  afterAll(() => {
    rmSync(parent, { recursive: true, force: true })
  })

  type Descriptor = {
    shared?: Record<
      string,
      {
        requiredVersion: string
        fallback: boolean
        version?: string
        exposes?: string[]
      }
    >
  }

  /** Builds a project whose ./Nav is `source`; returns its descriptor and browser JS. */
  function build(
    name: string,
    source: string,
    fields: Record<string, unknown> = {},
    setup?: (app: string) => void,
    { ssr = false }: { ssr?: boolean } = {}
  ): {
    descriptor: Descriptor
    js: string
    files: Record<string, string>
    /** The server build's CommonJS files (with `ssr`). */
    server: Record<string, string>
    /** What the build wrote to stderr (warnings). */
    stderr: string
  } {
    const app = join(parent, name)
    mkdirSync(join(app, 'src'), { recursive: true })
    writeFileSync(
      join(app, 'package.json'),
      JSON.stringify({ name, private: true, type: 'module', ...fields })
    )
    setup?.(app)
    writeFileSync(join(app, 'src', 'Nav.tsx'), source)
    writeFileSync(
      join(app, 'vite.config.mjs'),
      [
        `import { nextFederationComponents } from ${JSON.stringify(plugin)}`,
        'export default {',
        '  logLevel: "error",',
        '  plugins: [nextFederationComponents({',
        '    name: "links", base: "http://127.0.0.1:4999/",',
        `    exposes: { "./Nav": "./src/Nav.tsx" }, ssr: ${ssr},`,
        '  })],',
        '}',
      ].join('\n')
    )
    const env: Record<string, string | undefined> = { ...process.env }
    for (const key of [
      'NODE_ENV',
      'VITEST',
      'JEST_WORKER_ID',
      'NF_COMPONENTS_BUILT_AT',
      'NF_COMPONENTS_SIGNING_KEY',
      'NF_VITE_COMMAND',
    ]) {
      delete env[key]
    }
    env.NF_BUILD_ID = 'l1'
    const run = spawnSync(process.execPath, [vite, 'build'], {
      cwd: app,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    if (run.status !== 0) throw new Error(`vite build failed:\n${run.stderr}`)
    const dir = join(app, 'dist', 'l1')
    const client = join(dir, 'client')
    const files: Record<string, string> = {}
    const server: Record<string, string> = {}
    for (const file of readdirSync(client, { recursive: true })) {
      const name = String(file)
      if (name.endsWith('.cjs') || name.endsWith('.ssr.js')) {
        server[name] = readFileSync(join(client, name), 'utf8')
      } else if (name.endsWith('.js')) {
        files[name] = readFileSync(join(client, name), 'utf8')
      }
    }
    return {
      descriptor: JSON.parse(
        readFileSync(join(dir, 'nf-components.json'), 'utf8')
      ) as Descriptor,
      js: Object.values(files).join('\n'),
      files,
      server,
      stderr: run.stderr,
    }
  }

  test("a graph importing next/link gets the router shared entry with fallback; a router planted in a parent node_modules is never used (resolution from the plugin's own install)", () => {
    const { descriptor, js, files } = build(
      'with-link',
      [
        "import Link from 'next/link'",
        "import { usePathname } from 'next/navigation'",
        'export default function Nav() {',
        '  return <Link href={{ pathname: "/p", query: { id: "1" } }}>{usePathname()}</Link>',
        '}',
      ].join('\n')
    )
    const router = JSON.parse(
      readFileSync(resolve(pkg, '../router/package.json'), 'utf8')
    ) as { version: string }
    expect(descriptor.shared?.['@next-federation/router']).toEqual({
      requiredVersion: `>=0.${router.version.split('.')[1]}.0 <1.0.0`,
      fallback: true,
      version: router.version,
      exposes: ['./Nav'],
    })
    expect(js).not.toContain('PLANTED_ROUTER_MARKER')
    // The published files never name a folder of the build machine (the
    // shared entry's `import` is this install's file).
    expect(js).not.toContain(resolve(pkg, '../..'))
    // The shim's import is the shared module: Nav's chunk imports Module
    // Federation's share proxy, never the chunk of the bundled copy (the
    // only chunk with the router's code) directly.
    const nav = Object.entries(files).find(([f]) => /Nav-[\w-]+\.js$/.test(f))!
    const copies = Object.entries(files).filter(([, code]) =>
      code.includes('currententrychange')
    )
    expect(copies).toHaveLength(1)
    const copy = basename(copies[0]![0])
    expect(nav[0]).not.toBe(copies[0]![0])
    expect(nav[1]).not.toContain(copy)
    expect(nav[1]).toMatch(/from"\.\/[^"]*loadShare[^"]*"/)
  }, 120_000)

  test("a graph importing react-router (declared): rewired to the shim, one React Router, the router through Module Federation's share module", () => {
    const realRouter = realpathSync(
      resolve(pkg, '../router/node_modules/react-router')
    )
    const { descriptor, js, files } = build(
      'with-react-router',
      [
        "import { Link, MemoryRouter, Route, Routes } from 'react-router'",
        'export default function Nav() {',
        '  return <div><Link to="/out">out</Link><MemoryRouter><Routes>',
        '    <Route path="/" element={<Link to="/in">in</Link>} />',
        '  </Routes></MemoryRouter></div>',
        '}',
      ].join('\n'),
      { dependencies: { 'react-router': '7.18.6' } },
      (app) => {
        mkdirSync(join(app, 'node_modules'), { recursive: true })
        symlinkSync(realRouter, join(app, 'node_modules', 'react-router'))
      }
    )
    expect(descriptor.shared?.['@next-federation/router']?.exposes).toEqual([
      './Nav',
    ])
    // One copy of React Router (a string each copy has once).
    expect(
      js.split('You cannot render a <Router> inside another <Router>')
    ).toHaveLength(2)
    expect(js).not.toContain('PLANTED_ROUTER_MARKER')
    const nav = Object.entries(files).find(([f]) => /Nav-[\w-]+\.js$/.test(f))!
    expect(nav[1]).toMatch(/from"\.\/[^"]*loadShare[^"]*"/)
  }, 120_000)

  test('react-router (declared), server build: React Router and the packages it depends on are bundled into the server files, once; no package is required', () => {
    const realRouter = realpathSync(
      resolve(pkg, '../router/node_modules/react-router')
    )
    const { server } = build(
      'with-react-router-ssr',
      [
        "import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router'",
        'export default function Nav() {',
        '  return <div><Link to="/out">{useLocation().pathname}</Link><MemoryRouter><Routes>',
        '    <Route path="/" element={<Link to="/in">in</Link>} />',
        '  </Routes></MemoryRouter></div>',
        '}',
      ].join('\n'),
      { dependencies: { 'react-router': '7.18.6' } },
      (app) => {
        mkdirSync(join(app, 'node_modules'), { recursive: true })
        symlinkSync(realRouter, join(app, 'node_modules', 'react-router'))
      },
      { ssr: true }
    )
    const code = Object.values(server).join('\n')
    expect(Object.keys(server).length).toBeGreaterThan(0)
    // A host's server loader refuses any require of a package (NF-030).
    const required = [...code.matchAll(/require\("([^"]+)"\)/g)]
      .map((m) => m[1]!)
      .filter((id) => !id.startsWith('.'))
    expect(required).toEqual(
      required.filter((id) => id === '@module-federation/runtime')
    )
    expect(
      code.split('You cannot render a <Router> inside another <Router>')
    ).toHaveLength(2)
  }, 120_000)

  /** The NF-002 lines about React Router left alone, in `stderr`. */
  const reactRouterWarnings = (stderr: string) =>
    stderr
      .split('\n')
      .filter(
        (line) =>
          line.includes('NF-002') &&
          line.includes('leaves react-router and react-router-dom imports')
      )

  test('react-router-dom 6 only: builds, React Router is not rewired, one NF-002 warning', () => {
    const { descriptor, js, stderr } = build(
      'with-react-router-dom-6',
      [
        "import { Link } from 'react-router-dom'",
        'export default function Nav() {',
        '  return <Link to="/out" />',
        '}',
      ].join('\n'),
      { dependencies: { 'react-router-dom': '6.30.0' } },
      (app) => {
        // React Router 6's layout: react-router-dom on react-router 6 (no
        // useInRouterContext or createPath: the shim cannot run on it).
        const modules = join(app, 'node_modules')
        for (const [name, code] of [
          ['react-router', "export const marker = 'FAKE_RR_6'\n"],
          [
            'react-router-dom',
            "import { marker } from 'react-router'\nexport const Link = (p) => 'FAKE_RR_DOM_6:' + marker + p.to\n",
          ],
        ] as const) {
          mkdirSync(join(modules, name), { recursive: true })
          writeFileSync(
            join(modules, name, 'package.json'),
            JSON.stringify({
              name,
              version: '6.30.0',
              type: 'module',
              exports: { '.': './index.js' },
            })
          )
          writeFileSync(join(modules, name, 'index.js'), code)
        }
      }
    )
    expect(js).toContain('FAKE_RR_DOM_6:')
    expect(js).toContain('FAKE_RR_6')
    // The remote's own React Router: no expose imports the router.
    expect(descriptor.shared?.['@next-federation/router']?.exposes).toEqual([])
    const warnings = reactRouterWarnings(stderr)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('6.30.0')
  }, 120_000)

  test('react-router-dom 7 only, react-router not resolvable from the root (pnpm layout): builds, not rewired, one NF-002 warning', () => {
    const realRouter = realpathSync(
      resolve(pkg, '../router/node_modules/react-router')
    )
    const { descriptor, js, stderr } = build(
      'with-react-router-dom-7-only',
      [
        "import { Link, MemoryRouter } from 'react-router-dom'",
        'export default function Nav() {',
        '  return <MemoryRouter><Link to="/in">in</Link></MemoryRouter>',
        '}',
      ].join('\n'),
      { dependencies: { 'react-router-dom': '7.18.6' } },
      (app) => {
        // pnpm: react-router-dom's real folder has react-router next to it;
        // the root's node_modules has react-router-dom only.
        const store = join(app, '.store', 'node_modules')
        const dom = join(store, 'react-router-dom')
        mkdirSync(dom, { recursive: true })
        writeFileSync(
          join(dom, 'package.json'),
          JSON.stringify({
            name: 'react-router-dom',
            version: '7.18.6',
            type: 'module',
            exports: { '.': './index.mjs' },
          })
        )
        writeFileSync(join(dom, 'index.mjs'), "export * from 'react-router'\n")
        symlinkSync(realRouter, join(store, 'react-router'))
        mkdirSync(join(app, 'node_modules'), { recursive: true })
        symlinkSync(dom, join(app, 'node_modules', 'react-router-dom'))
      }
    )
    // One React Router, the remote's own.
    expect(
      js.split('You cannot render a <Router> inside another <Router>')
    ).toHaveLength(2)
    expect(descriptor.shared?.['@next-federation/router']?.exposes).toEqual([])
    const warnings = reactRouterWarnings(stderr)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('react-router does not resolve')
  }, 120_000)

  test('a graph without router imports gets none: no expose of the build needs the router', () => {
    const { descriptor, js } = build(
      'plain-anchor',
      'export default function Nav() { return <a href="/p">p</a> }\n'
    )
    // Module Federation's shared list is fixed when the plugin is created,
    // so the entry is in the build, needed by no expose.
    expect(descriptor.shared?.['@next-federation/router']?.exposes).toEqual([])
    expect(js).not.toContain('PLANTED_ROUTER_MARKER')
  }, 120_000)
})
