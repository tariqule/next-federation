import { isNFError } from '@next-federation/sdk'
import type { Plugin, UserConfig } from 'vite'
import { resolveOptions } from '../src/options.ts'
import type { IslandRemoteOptions } from '../src/options.ts'
import {
  FLIGHT_CLIENT_ID,
  optimizerCacheDir,
} from '../src/scope-flight-client.ts'
import {
  NF_PACKAGES,
  remoteViteConfig,
  rscPluginOptions,
} from '../src/plugin-rsc/config.ts'
import {
  ISLAND_CSS_EXPORT,
  islandCssPlugin,
} from '../src/plugin-rsc/island-css.ts'
import {
  SUPPORTED_PLUGIN_RSC_VERSION,
  assertInstalledPluginRsc,
  installedPluginRscVersion,
} from '../src/plugin-rsc/version.ts'

const remote: IslandRemoteOptions = {
  name: 'shop',
  base: 'https://shop.example/',
  islands: {
    Panel: './src/islands/Panel.tsx',
    Orders: { entry: './src/islands/Orders.tsx', private: true },
  },
  hosts: ['https://host.example', 'http://localhost:3100'],
}
const built = resolveOptions(
  { ...remote, buildId: 'v1' },
  { command: 'build', env: {}, now: 0 }
)

test('the installed plugin-rsc is the pinned 0.5.39', () => {
  expect(SUPPORTED_PLUGIN_RSC_VERSION).toBe('0.5.39')
  expect(installedPluginRscVersion()).toBe('0.5.39')
  expect(() => assertInstalledPluginRsc({})).not.toThrow()
})

test('plugin-rsc options: own entries and no hoistable CSS links', () => {
  const entries = {
    rsc: '/e/rsc.tsx',
    ssr: '/e/ssr.tsx',
    client: '/e/client.tsx',
  }
  expect(rscPluginOptions(entries)).toEqual({ entries, rscCssTransform: false })
})

describe('remoteViteConfig', () => {
  const config: UserConfig = remoteViteConfig(built)
  const env = config.environments!

  test('base is the absolute, build-pinned public base', () => {
    expect(config.base).toBe('https://shop.example/b/v1/')
  })

  test('the optimizer cache dir is named after the slot key (finding 14)', () => {
    expect(config.cacheDir).toBe(optimizerCacheDir('shop', built.scopeKey))
  })

  test('JSX is compiled by oxc without Fast Refresh (finding 5)', () => {
    expect(config.oxc).toEqual({
      jsx: { runtime: 'automatic', importSource: 'react', refresh: false },
    })
  })

  test('the dev pre-bundle of the flight client is scoped too', () => {
    const plugins = env.client!.optimizeDeps!.rolldownOptions!
      .plugins as Plugin[]
    expect(plugins).toHaveLength(1)
    const plugin = plugins[0]!
    expect(plugin.name).toBe('nf:scope-flight-client-optimizer')
    const t = plugin.transform as unknown as {
      filter: { id: RegExp }
      handler: (code: string) => { code: string }
    }
    expect(t.filter.id).toBe(FLIGHT_CLIENT_ID)
    expect(t.handler('__webpack_require__(1)').code).toBe(
      'globalThis.__nf_rsc__["https://shop.example/b/v1/"].require(1)'
    )
  })

  test('the client entry keeps its exports (finding 7)', () => {
    expect(env.client!.build!.rollupOptions!.preserveEntrySignatures).toBe(
      'exports-only'
    )
  })

  test('each environment builds into <outDir>/<env>', () => {
    expect(env.client!.build!.outDir).toBe('dist/v1/client')
    expect(env.ssr!.build!.outDir).toBe('dist/v1/ssr')
    expect(env.rsc!.build!.outDir).toBe('dist/v1/rsc')
  })

  test('server environments bundle @next-federation/* so the RSC bundle and the handler share one @next-federation/server', () => {
    for (const name of ['rsc', 'ssr'] as const) {
      const noExternal = env[name]!.resolve!.noExternal as RegExp[]
      expect(noExternal).toContain(NF_PACKAGES)
    }
    expect(NF_PACKAGES.test('@next-federation/server')).toBe(true)
    expect(NF_PACKAGES.test('@next-federation/island')).toBe(true)
    expect(NF_PACKAGES.test('next-federation-other')).toBe(false)
  })

  test("Vite's own CORS is off: it would pre-empt the handler on /_nf/ (ruling 18)", () => {
    expect(config.server!.cors).toBe(false)
  })

  test('dev: React is pre-bundled up front and the island package never is, so a cold optimizer never re-optimizes on the first host load (two Reacts)', () => {
    expect(env.client!.optimizeDeps!.include).toEqual([
      'react',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-dom',
      'react-dom/client',
    ])
    expect(env.client!.optimizeDeps!.exclude).toEqual([
      '@next-federation/island',
    ])
  })

  test("dev: the host's browser console is not forwarded to the remote's terminal, unless the remote asks for it", () => {
    expect(config.server!.forwardConsole).toBe(false)
    const own = remoteViteConfig(built, { server: { forwardConsole: true } })
    expect(own.server).toEqual({ cors: false })
  })
})

// --- Finding 8: plugin-rsc 0.5.39 wires only the FIRST loadCss() per module. ---

type Transform = {
  filter: { id: RegExp }
  handler: (code: string, id: string) => { code: string } | undefined
}

function cssPlugin(islands = built.islands, root = '/app') {
  const plugin = islandCssPlugin(islands)
  ;(plugin.configResolved as (c: { root: string }) => void)({ root })
  return plugin
}
function run(plugin: Plugin, code: string, id: string) {
  return (plugin.transform as unknown as Transform).handler(code, id)
}
const loadCssCalls = (code: string) =>
  code.split('import.meta.viteRsc.loadCss(').length - 1

test('appends exactly one loadCss() export to each island module', () => {
  const plugin = cssPlugin()
  for (const file of ['Panel', 'Orders']) {
    const out = run(
      plugin,
      'export default function X() { return null }\n',
      `/app/src/islands/${file}.tsx`
    )
    expect(out).toBeDefined()
    expect(loadCssCalls(out!.code)).toBe(1)
    expect(out!.code).toContain(
      `export const ${ISLAND_CSS_EXPORT} = () => import.meta.viteRsc.loadCss()`
    )
  }
})

test('regression: an entry shared by two islands still gets one loadCss() call', () => {
  const plugin = cssPlugin(
    resolveOptions(
      {
        ...remote,
        islands: { A: './src/islands/Panel.tsx', B: './src/islands/Panel.tsx' },
      },
      { command: 'build', env: {}, now: 0 }
    ).islands
  )
  const out = run(
    plugin,
    'export default () => null\n',
    '/app/src/islands/Panel.tsx'
  )
  expect(loadCssCalls(out!.code)).toBe(1)
  // Transforming an already-transformed module (e.g. a second pass) adds nothing.
  expect(run(plugin, out!.code, '/app/src/islands/Panel.tsx')).toBeUndefined()
})

test('regression: an island module that calls loadCss() itself is NF-002 (its call would hide ours)', () => {
  const plugin = cssPlugin()
  try {
    run(
      plugin,
      'export const islandCss = () => import.meta.viteRsc.loadCss()\n',
      '/app/src/islands/Panel.tsx'
    )
  } catch (error) {
    expect(isNFError(error, 'NF-002')).toBe(true)
    return
  }
  throw new Error('expected NF-002')
})

test('only island entries are touched, query strings ignored, rsc environment only', () => {
  const plugin = cssPlugin()
  expect(
    run(plugin, 'export {}', '/app/src/islands/Counter.tsx')
  ).toBeUndefined()
  expect(
    loadCssCalls(
      run(plugin, 'export {}', '/app/src/islands/Panel.tsx?v=1')!.code
    )
  ).toBe(1)
  const apply = plugin.applyToEnvironment as (e: { name: string }) => boolean
  expect(apply({ name: 'rsc' })).toBe(true)
  expect(apply({ name: 'client' })).toBe(false)
  expect(apply({ name: 'ssr' })).toBe(false)
  expect(plugin.enforce).toBe('pre')
})

test('regression: a "use client" island entry is NF-002 (plugin-rsc would make it a client reference)', () => {
  const plugin = cssPlugin()
  try {
    run(
      plugin,
      "'use client'\nexport default function X() { return null }\n",
      '/app/src/islands/Panel.tsx'
    )
  } catch (error) {
    expect(isNFError(error, 'NF-002')).toBe(true)
    return
  }
  throw new Error('expected NF-002')
})
