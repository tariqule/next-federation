import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { runInThisContext } from 'node:vm'
import { FLIGHT_REGISTRY_GLOBAL } from '@next-federation/protocol'
import { resolveOptions } from '../src/options.ts'
import type { IslandRemoteOptions } from '../src/options.ts'
import {
  FLIGHT_CLIENT_ID,
  optimizerCacheDir,
  scopeFlightClient,
} from '../src/scope-flight-client.ts'
import {
  flightScopeOptimizerPlugin,
  flightScopePlugin,
} from '../src/plugin-rsc/scope.ts'

test('scopes every flight-client global to the build key', () => {
  const out = scopeFlightClient(
    '__vite_rsc_require__(a);__webpack_require__.u(b);__webpack_require__(c);__webpack_chunk_load__(d)',
    'https://r.example/b/v2/'
  )
  expect(out).toBe(
    'globalThis.__nf_rsc__["https://r.example/b/v2/"].require(a);({}).u(b);globalThis.__nf_rsc__["https://r.example/b/v2/"].require(c);globalThis.__nf_rsc__["https://r.example/b/v2/"].chunkLoad(d)'
  )
})

test('the slot uses the shared registry global name', () => {
  expect(scopeFlightClient('__webpack_require__(x)', 'k')).toBe(
    `globalThis.${FLIGHT_REGISTRY_GLOBAL}["k"].require(x)`
  )
})

test('FLIGHT_CLIENT_ID matches the browser flight client, not the edge or node one', () => {
  expect(
    FLIGHT_CLIENT_ID.test(
      '/x/node_modules/react-server-dom-webpack/cjs/react-server-dom-webpack-client.browser.production.js'
    )
  ).toBe(true)
  expect(
    FLIGHT_CLIENT_ID.test(
      '/x/react-server-dom-webpack/cjs/react-server-dom-webpack-client.edge.production.js'
    )
  ).toBe(false)
})

const remote: IslandRemoteOptions = {
  name: 'shop',
  base: 'https://shop.example/',
  islands: { Panel: './Panel.tsx' },
  hosts: [],
}

test('two builds of one remote get different scope keys and cache dirs', () => {
  const ctx = { command: 'build' as const, env: {}, now: 0 }
  const v1 = resolveOptions({ ...remote, buildId: 'v1' }, ctx)
  const v2 = resolveOptions({ ...remote, buildId: 'v2' }, ctx)
  expect(v1.scopeKey).toBe('https://shop.example/b/v1/')
  expect(v2.scopeKey).toBe('https://shop.example/b/v2/')
  const d1 = optimizerCacheDir(v1.name, v1.scopeKey)
  const d2 = optimizerCacheDir(v2.name, v2.scopeKey)
  expect(d1).toMatch(/^node_modules\/\.vite-nf-shop-[0-9a-f]{8}$/)
  expect(d2).toMatch(/^node_modules\/\.vite-nf-shop-[0-9a-f]{8}$/)
  expect(d1).not.toBe(d2)
  // Stable for one key (the dev pre-bundle cache is reused across restarts).
  expect(optimizerCacheDir('shop', v1.scopeKey)).toBe(d1)
})

test('the cache dir is the sha1 of the slot key', () => {
  const hash = createHash('sha1')
    .update('https://shop.example/')
    .digest('hex')
    .slice(0, 8)
  expect(optimizerCacheDir('shop', 'https://shop.example/')).toBe(
    `node_modules/.vite-nf-shop-${hash}`
  )
})

// --- Carry from Task 13: prove the REAL flight client is bound per build. ---

const require = createRequire(import.meta.url)
const flightFile = join(
  dirname(require.resolve('react-server-dom-webpack/package.json')),
  'cjs/react-server-dom-webpack-client.browser.production.js'
)
const flightSource = readFileSync(flightFile, 'utf8')

type FlightClient = {
  createFromReadableStream(stream: ReadableStream<Uint8Array>): Promise<unknown>
}

/** Evaluates one transformed copy of the flight client (one per build, as in a page). */
function evaluate(code: string): FlightClient {
  const module = { exports: {} as FlightClient }
  const fn = runInThisContext(
    `(function (exports, require, module) {${code}\n})`,
    { filename: flightFile }
  ) as (e: unknown, r: NodeRequire, m: { exports: FlightClient }) => void
  fn(module.exports, createRequire(flightFile), module)
  return module.exports
}

/** A Flight payload whose root is a client reference with one chunk. */
function payload(id: string): ReadableStream<Uint8Array> {
  const text = `1:I[${JSON.stringify(id)},["c-${id}","/c.js"],"Counter",1]\n0:"$L1"\n`
  return new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(text))
      c.close()
    },
  })
}

type Calls = { require: string[]; chunkLoad: string[] }
function installSlot(key: string): Calls {
  const calls: Calls = { require: [], chunkLoad: [] }
  const g = globalThis as Record<string, unknown>
  const registry = (g[FLIGHT_REGISTRY_GLOBAL] ??= {}) as Record<string, unknown>
  registry[key] = {
    require(id: string) {
      calls.require.push(id)
      return Promise.resolve({ Counter: () => null })
    },
    chunkLoad(id: string) {
      calls.chunkLoad.push(id)
      return Promise.resolve()
    },
  }
  return calls
}

type Transform = { handler: (code: string, id: string) => { code: string } }

/** Runs the flight client through the client-environment build transform. */
function viaBuild(scopeKey: string): string {
  const plugin = flightScopePlugin(scopeKey)
  return (plugin.transform as unknown as Transform).handler(
    flightSource,
    flightFile
  ).code
}
/** Runs the flight client through the dependency-optimizer transform (dev pre-bundle). */
function viaOptimizer(scopeKey: string): string {
  const plugin = flightScopeOptimizerPlugin(scopeKey)
  return (plugin.transform as unknown as Transform).handler(
    flightSource,
    flightFile
  ).code
}

const flush = () => new Promise((r) => setTimeout(r, 20))

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[FLIGHT_REGISTRY_GLOBAL]
})

test.each([
  [
    'two builds of one remote',
    'https://shop.example/b/v1/',
    'https://shop.example/b/v2/',
  ],
  ['two remotes on one page', 'https://a.example/', 'https://b.example/'],
])(
  '%s: each flight client resolves client references only through its own slot (build + optimizer)',
  async (_label, keyA, keyB) => {
    for (const transform of [viaBuild, viaOptimizer]) {
      const a = installSlot(keyA)
      const b = installSlot(keyB)
      const codeA = transform(keyA)
      const codeB = transform(keyB)
      expect(codeA).not.toMatch(
        /__webpack_require__|__webpack_chunk_load__|__vite_rsc_require__/
      )
      expect(codeA).toContain(`["${keyA}"]`)
      expect(codeA).not.toContain(`["${keyB}"]`)

      const clientA = evaluate(codeA)
      const clientB = evaluate(codeB)
      void clientA.createFromReadableStream(payload('/src/A.tsx'))
      void clientB.createFromReadableStream(payload('/src/B.tsx'))
      await flush()

      expect(a).toEqual({
        require: ['/src/A.tsx'],
        chunkLoad: ['c-/src/A.tsx'],
      })
      expect(b).toEqual({
        require: ['/src/B.tsx'],
        chunkLoad: ['c-/src/B.tsx'],
      })
      delete (globalThis as Record<string, unknown>)[FLIGHT_REGISTRY_GLOBAL]
    }
  }
)

test('the build transform applies only to the client environment', () => {
  const plugin = flightScopePlugin('https://shop.example/')
  const apply = plugin.applyToEnvironment as (env: { name: string }) => boolean
  expect(apply({ name: 'client' })).toBe(true)
  expect(apply({ name: 'ssr' })).toBe(false)
  expect(apply({ name: 'rsc' })).toBe(false)
  expect(plugin.enforce).toBe('post')
  const filter = (plugin.transform as unknown as { filter: { id: RegExp } })
    .filter
  expect(filter.id).toBe(FLIGHT_CLIENT_ID)
  const optFilter = (
    flightScopeOptimizerPlugin('k').transform as unknown as {
      filter: { id: RegExp }
    }
  ).filter
  expect(optFilter.id).toBe(FLIGHT_CLIENT_ID)
})
