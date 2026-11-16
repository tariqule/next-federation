import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isNFError } from '@next-federation/sdk'
import type { Plugin, UserConfig } from 'vite'
import { nextFederationIslands } from '../src/index.ts'
import type { IslandRemoteOptions } from '../src/options.ts'
import { devCorsMiddleware } from '../src/dev-cors.ts'
import { ENTRIES } from '../src/plugin-rsc/plugin.ts'
import { FLIGHT_CLIENT_ID } from '../src/scope-flight-client.ts'

const options: IslandRemoteOptions = {
  name: 'shop',
  base: 'https://shop.example/',
  islands: {
    Panel: './src/islands/Panel.tsx',
    Orders: { entry: './src/islands/Orders.tsx', private: true },
  },
  hosts: ['http://localhost:3100'],
  issuers: { 'http://localhost:3100': 'http://localhost:3100/jwks' },
  buildId: 'v1',
}

type Hook = (...args: unknown[]) => unknown
const handlerOf = (hook: unknown): Hook =>
  (typeof hook === 'function'
    ? hook
    : (hook as { handler: Hook }).handler) as Hook
const byName = (plugins: Plugin[], name: string): Plugin => {
  const found = plugins.find((p) => p.name === name)
  if (!found) throw new Error(`no plugin ${name}`)
  return found
}

/** A fresh plugin list with nf:config's config hook run for `command`. */
function setup(command: 'build' | 'serve' = 'build') {
  const plugins = nextFederationIslands(options)
  const config = byName(plugins, 'nf:config')
  const fragment = handlerOf(config.config)(
    {},
    {
      command,
      mode: command === 'build' ? 'production' : 'development',
    }
  ) as UserConfig
  handlerOf(config.configResolved)({ root: '/app' })
  return { plugins, config, fragment }
}

function load(plugin: Plugin, source: string, environment = 'rsc'): string {
  const id = handlerOf(plugin.resolveId)(source) as string
  expect(id).toBe(`\0${source}`)
  return handlerOf(plugin.load).call(
    { environment: { name: environment } },
    id
  ) as string
}
const defaultExport = (code: string): unknown =>
  JSON.parse(code.replace(/^export default /, ''))

test('composes plugin-rsc with the next-federation plugins', () => {
  const plugins = nextFederationIslands(options)
  const names = plugins.map((p) => p.name)
  expect(names).toContain('rsc:minimal')
  expect(names[0]!.startsWith('rsc')).toBe(true)
  expect(names.slice(-5)).toEqual([
    'nf:scope-flight-client',
    'nf:checks',
    'nf:island-css',
    'nf:share',
    'nf:config',
  ])
  // nf:config runs before plugin-rsc's config hook (it reads the outDirs);
  // the checks see 'use server' before plugin-rsc strips it; the scope
  // rewrite runs after plugin-rsc's patch.
  expect(byName(plugins, 'nf:config').enforce).toBe('pre')
  expect(byName(plugins, 'nf:checks').enforce).toBe('pre')
  expect(byName(plugins, 'nf:scope-flight-client').enforce).toBe('post')
  // Sharing: production client builds only, before Vite's resolver.
  expect(byName(plugins, 'nf:share')).toMatchObject({
    enforce: 'pre',
    apply: 'build',
  })
  expect(byName(plugins, 'rsc:patch-react-server-dom-webpack').enforce).toBe(
    undefined
  )
})

test('bad options fail when the plugin is created', () => {
  try {
    nextFederationIslands({ ...options, base: '/' })
  } catch (error) {
    expect(isNFError(error, 'NF-020')).toBe(true)
    return
  }
  throw new Error('expected NF-020')
})

test('the config hook resolves the options for the Vite command', () => {
  const built = setup('build').fragment
  expect(built.base).toBe('https://shop.example/b/v1/')
  expect(built.environments!.rsc!.build!.outDir).toBe('dist/v1/rsc')
  expect(built.server).toEqual({ cors: false })
  const served = setup('serve').fragment
  expect(served.base).toBe('https://shop.example/')
  expect(served.environments!.client!.build!.outDir).toBe('dist/client')
})

test('virtual:next-federation/config: full options on the server, public fields in the browser', () => {
  const { config } = setup()
  const server = defaultExport(load(config, 'virtual:next-federation/config'))
  expect(server).toMatchObject({
    name: 'shop',
    buildId: 'v1',
    publicBase: 'https://shop.example/b/v1/',
    hosts: ['http://localhost:3100'],
    issuers: options.issuers,
    maxAge: 60,
  })
  const client = defaultExport(
    load(config, 'virtual:next-federation/config', 'client')
  )
  expect(client).toEqual({
    name: 'shop',
    buildId: 'v1',
    publicBase: 'https://shop.example/b/v1/',
    scopeKey: 'https://shop.example/b/v1/',
    mode: 'production',
  })
})

test('virtual:next-federation/islands: lazy imports of the absolute entries with their private flag', () => {
  const code = load(setup().config, 'virtual:next-federation/islands')
  expect(code).toContain(
    '"Panel": { load: () => import("/app/src/islands/Panel.tsx"), private: false }'
  )
  expect(code).toContain(
    '"Orders": { load: () => import("/app/src/islands/Orders.tsx"), private: true }'
  )
})

test('virtual:next-federation/bootstrap re-exports mountIsland from the client entry itself', () => {
  const code = load(setup('serve').config, 'virtual:next-federation/bootstrap')
  expect(code).toBe(
    `export { mountIsland } from ${JSON.stringify(ENTRIES.client)}\n`
  )
  expect(ENTRIES.client).toMatch(/\/src\/plugin-rsc\/entry\.client\.tsx$/)
})

test('the checks plugin rejects "use server" with NF-019, using the real module id', () => {
  const checks = byName(nextFederationIslands(options), 'nf:checks')
  const transform = handlerOf(checks.transform)
  expect(
    transform("export const a = 'use server'", '/app/src/a.ts?v=1')
  ).toBeUndefined()
  // .css is not parsed even if the text appears in it.
  expect(transform("/* 'use server' */", '/app/src/a.css')).toBeUndefined()
  for (const id of ['/app/src/actions.ts', '/app/src/Form.tsx?v=1']) {
    try {
      transform(
        "export async function f() {\n  'use server'\n  return 1\n}",
        id
      )
    } catch (error) {
      expect(isNFError(error, 'NF-019')).toBe(true)
      continue
    }
    throw new Error(`expected NF-019 for ${id}`)
  }
  const filter = (checks.transform as { filter: { id: { exclude: RegExp } } })
    .filter.id.exclude
  expect(filter.test('\0virtual:x')).toBe(true)
})

test('scope rewrite on the plugin-rsc-patched, vendored browser flight client', () => {
  const require = createRequire(import.meta.url)
  const pkg = dirname(require.resolve('@vitejs/plugin-rsc/package.json'))
  const id = join(
    pkg,
    'dist/vendor/react-server-dom/cjs/react-server-dom-webpack-client.browser.production.js'
  )
  const original = readFileSync(id, 'utf8')
  const { plugins } = setup()
  const patch = byName(plugins, 'rsc:patch-react-server-dom-webpack')
  const scope = byName(plugins, 'nf:scope-flight-client')
  expect(FLIGHT_CLIENT_ID.test(id)).toBe(true)
  // plugin-rsc's patch runs first (normal order), ours after it (post).
  const patched = (handlerOf(patch.transform)(original, id) as { code: string })
    .code
  expect(patched).toContain('__vite_rsc_require__')
  const scoped = (handlerOf(scope.transform)(patched, id) as { code: string })
    .code
  expect(scoped).toContain(
    'globalThis.__nf_rsc__["https://shop.example/b/v1/"].require'
  )
  expect(scoped).toContain(
    'globalThis.__nf_rsc__["https://shop.example/b/v1/"].chunkLoad'
  )
  expect(scoped).not.toMatch(
    /__vite_rsc_require__|__webpack_require__|__webpack_chunk_load__/
  )
})

describe('dev CORS for module assets (ruling 18)', () => {
  type Res = { status: number; headers: Record<string, string>; ended: boolean }
  function call(url: string, origin?: string, method = 'GET') {
    const state: Res = { status: 200, headers: {}, ended: false }
    const res = {
      set statusCode(v: number) {
        state.status = v
      },
      setHeader(name: string, value: string) {
        state.headers[name.toLowerCase()] = value
      },
      end() {
        state.ended = true
      },
    } as unknown as ServerResponse
    const req = {
      url,
      method,
      headers: origin ? { origin } : {},
    } as unknown as IncomingMessage
    let nextCalled = false
    devCorsMiddleware(['http://localhost:3100'])(req, res, () => {
      nextCalled = true
    })
    return { ...state, nextCalled }
  }

  test('allowed hosts get CORS on assets', () => {
    const r = call('/src/islands/Counter.tsx', 'http://localhost:3100')
    expect(r.headers['access-control-allow-origin']).toBe(
      'http://localhost:3100'
    )
    expect(r.nextCalled).toBe(true)
  })

  test('other origins get none', () => {
    const r = call('/src/x.tsx', 'http://evil.test')
    expect(r.headers['access-control-allow-origin']).toBeUndefined()
    expect(r.nextCalled).toBe(true)
  })

  test('/_nf/ requests, preflights included, are left to the island handler', () => {
    for (const method of ['GET', 'OPTIONS']) {
      const r = call('/_nf/island/X?p=1', 'http://localhost:3100', method)
      expect(r.headers).toEqual({})
      expect(r.ended).toBe(false)
      expect(r.nextCalled).toBe(true)
    }
  })

  test('only a leading /_nf/ (or one right after the base path) belongs to the handler', () => {
    const asset = call('/src/_nf/x.js', 'http://localhost:3100')
    expect(asset.headers['access-control-allow-origin']).toBe(
      'http://localhost:3100'
    )
    const state = { headers: {} as Record<string, string> }
    const res = {
      setHeader: (n: string, v: string) => (state.headers[n] = v),
    } as unknown as ServerResponse
    let passed = 0
    const mw = devCorsMiddleware(['http://localhost:3100'], '/remote/')
    for (const url of ['/remote/_nf/island/X', '/_nf/health']) {
      mw(
        {
          url,
          method: 'OPTIONS',
          headers: { origin: 'http://localhost:3100' },
        } as unknown as IncomingMessage,
        res,
        () => passed++
      )
    }
    expect(passed).toBe(2)
    expect(state.headers).toEqual({})
  })

  test('asset preflights from allowed hosts are answered', () => {
    const r = call('/@id/x', 'http://localhost:3100', 'OPTIONS')
    expect(r.status).toBe(204)
    expect(r.ended).toBe(true)
    expect(r.nextCalled).toBe(false)
  })
})

test('a non-production build (React development copies) neither provides nor consumes', () => {
  const run = (isProduction: boolean) => {
    const plugins = nextFederationIslands(options)
    const config = byName(plugins, 'nf:config')
    handlerOf(config.config)({}, { command: 'build', mode: 'development' })
    handlerOf(config.configResolved)({ root: '/app', isProduction })
    const resolved = defaultExport(
      load(config, 'virtual:next-federation/config')
    ) as { share: unknown }
    // The client entry is the async share boundary only when sharing.
    const boundary = handlerOf(byName(plugins, 'nf:share').load).call(
      { environment: { name: 'client' } },
      ENTRIES.client
    )
    return { share: resolved.share, boundary }
  }
  const dev = run(false)
  expect(dev.share).toBeNull()
  expect(dev.boundary).toBeUndefined()
  const prod = run(true)
  expect(prod.share).toMatchObject({ scope: 'nf-islands' })
  expect(String(prod.boundary)).toContain('await ready')
})
