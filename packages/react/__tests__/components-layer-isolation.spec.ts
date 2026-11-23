// Server loader: how one router layer's copy of a remote build is kept apart
// from another layer's in one process (scoped globals, tags, init order, the
// builds it can isolate), and what it refuses.
import { createHash } from 'node:crypto'
import { componentTrustRegistry } from '@next-federation/protocol'
import {
  ISOLATED_SERVER_BUILDS,
  createServerEntryPlugin,
  evaluateServerEntry,
  scopedGlobalThis,
  serializedInit,
} from '../src/components/server-loader.ts'
import type { ServerLoaderOptions } from '../src/components/server-loader.ts'
import type { ServerScope } from '../src/components/runtime.ts'

const sri = (text: string) =>
  `sha384-${createHash('sha384').update(text).digest('base64')}`

const base = 'http://127.0.0.1:4998/b/x1/'
let files: Record<string, string>
let scopeIds = 0

const scope = (layer = String(++scopeIds)): ServerScope => ({
  id: `${layer}.1`,
  layer,
  globals: {},
  blocked: new Map(),
  builds: new Map(),
  failures: new Map(),
  unlisted: new Set(),
})

function options(s?: ServerScope): ServerLoaderOptions {
  return {
    integrityFor: (url) =>
      url.startsWith(base)
        ? {
            base,
            integrity: Object.fromEntries(
              Object.entries(files).map(([path, text]) => [path, sri(text)])
            ),
          }
        : undefined,
    hostModules: { '@module-federation/runtime': { host: true } },
    get: async (url) => {
      const body = files[url.slice(base.length)]
      return body === undefined
        ? { status: 404, body: new Uint8Array(), headers: {} }
        : { status: 200, body: new TextEncoder().encode(body), headers: {} }
    },
    ...(s ? { scope: s } : {}),
  }
}

const KEY = '__nfIsolationSpec'
const real = globalThis as unknown as Record<string, unknown>

beforeEach(() => {
  files = {}
  // One process: the layer that server-renders unlisted builds.
  delete componentTrustRegistry().unlistedLayer
  rs.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  delete real[KEY]
  rs.restoreAllMocks()
})

describe('scoped globalThis (C)', () => {
  const isScoped = (key: string) => key === KEY
  test('defineProperty: a scoped key lands in the store, even non-configurable', () => {
    const store: Record<PropertyKey, unknown> = {}
    const g = scopedGlobalThis(store, isScoped)
    // As a bundled MF runtime defines its registry.
    Object.defineProperty(g, KEY, {
      value: { mine: true },
      configurable: false,
      writable: true,
    })
    expect(store[KEY]).toEqual({ mine: true })
    expect(KEY in real).toBe(false)
    expect((g as unknown as Record<string, unknown>)[KEY]).toEqual({
      mine: true,
    })
  })

  test('getOwnPropertyDescriptor and has: scoped keys from the store, others from globalThis', () => {
    const store: Record<PropertyKey, unknown> = {}
    const g = scopedGlobalThis(store, isScoped)
    real[KEY] = 'process-wide'
    expect(Object.prototype.hasOwnProperty.call(g, KEY)).toBe(false)
    expect(KEY in g).toBe(false)
    store[KEY] = 'scoped'
    expect(Object.getOwnPropertyDescriptor(g, KEY)?.value).toBe('scoped')
    expect(KEY in g).toBe(true)
    // Not scoped: the real object, configurable as the target requires.
    expect(Object.getOwnPropertyDescriptor(g, 'setTimeout')?.value).toBe(
      setTimeout
    )
    expect('setTimeout' in g).toBe(true)
    // A non-configurable real global reads without a Proxy invariant error.
    expect(Object.getOwnPropertyDescriptor(g, 'undefined')).toBeDefined()
  })

  test('ownKeys: the real keys without the scoped ones, plus the store', () => {
    const store: Record<PropertyKey, unknown> = { [KEY]: 1 }
    const g = scopedGlobalThis(store, isScoped)
    real[KEY] = 'process-wide'
    const keys = Reflect.ownKeys(g)
    expect(keys.filter((k) => k === KEY)).toHaveLength(1)
    expect(keys).toContain('setTimeout')
    expect(Object.keys(g)).toContain(KEY)
  })

  test('a non-configurable define of an unscoped key reaches globalThis', () => {
    const key = `${KEY}_fixed_${Math.random().toString(36).slice(2)}`
    const g = scopedGlobalThis({}, isScoped)
    Object.defineProperty(g, key, { value: 7, configurable: false })
    expect(real[key]).toBe(7)
    expect(Object.getOwnPropertyDescriptor(g, key)?.configurable).toBe(false)
  })
})

describe('init order (B)', () => {
  test('an init that waited too long fails without running; inits never overlap', async () => {
    let running = 0
    let overlapped = false
    let release!: () => void
    const stalled = new Promise<void>((r) => (release = r))
    const calls: string[] = []
    const container = (label: string, wait?: Promise<void>) => ({
      init: async () => {
        running++
        if (running > 1) overlapped = true
        calls.push(label)
        await wait
        running--
      },
      get: async () => () => ({}),
    })
    const name = `stall_${Math.random().toString(36).slice(2)}`
    const a = serializedInit(name, container('a', stalled), 50) as {
      init: () => Promise<void>
    }
    const b = serializedInit(name, container('b'), 50) as {
      init: () => Promise<void>
    }
    const c = serializedInit(name, container('c'), 5_000) as {
      init: () => Promise<void>
    }
    const first = a.init()
    // The stalled init holds the lock: b gives up after 50 ms, never runs.
    await expect(b.init()).rejects.toMatchObject({ code: 'NF-029' })
    expect(calls).toEqual(['a'])
    // c waits for a (and for b, which never ran), then runs alone.
    const third = c.init()
    await new Promise((r) => setTimeout(r, 20))
    expect(calls).toEqual(['a'])
    release()
    await first
    await third
    expect(calls).toEqual(['a', 'c'])
    expect(overlapped).toBe(false)
    await new Promise((r) => setTimeout(r, 0))
    expect(componentTrustRegistry().initLocks?.has(name)).toBe(false)
  })
})

describe('tags and containers (E)', () => {
  test('a scope tags URLs with a random per-process fragment, stripped before fetching', async () => {
    files['mf-manifest.json'] = '{"remotes":[]}'
    const s = scope()
    const plugin = createServerEntryPlugin(options(s))
    const { remote } = plugin.beforeRegisterRemote({
      remote: { entry: `${base}mf-manifest.json` },
    })
    expect(remote.entry).toMatch(
      new RegExp(`^${base}mf-manifest\\.json#nf_host_[0-9a-f]{32}=${s.id}$`)
    )
    expect(remote.entry).not.toContain('#nf_host=')
    // Re-tagging replaces the tag; fetch strips it.
    expect(
      plugin.beforeRegisterRemote({ remote: { entry: remote.entry! } }).remote
        .entry
    ).toBe(remote.entry)
    expect((await plugin.fetch(remote.entry!)!).status).toBe(200)
    // A guessed tag is part of the URL: it is not listed, never fetched.
    await expect(
      plugin.fetch(`${base}mf-manifest.json#nf_host=${s.id}`)!
    ).rejects.toMatchObject({ code: 'NF-027' })
  })

  test('only a container the loader evaluated is used', async () => {
    files['remoteEntry.ssr.js'] =
      'const mf = require("@module-federation/runtime"); exports.init = async () => {}; exports.get = async () => () => ({})'
    files['mf-manifest.json'] = JSON.stringify({
      metaData: { pluginVersion: '1.24.0' },
      remotes: [],
    })
    const plugin = createServerEntryPlugin(options(scope()))
    await plugin.fetch(`${base}mf-manifest.json`)
    const container = await plugin.loadEntry({
      remoteInfo: { name: 'evaluated', entry: `${base}remoteEntry.ssr.js` },
    })
    await expect(
      plugin.afterLoadEntry({ remoteEntryExports: container })
    ).resolves.toBeUndefined()
    // One MF found elsewhere (a global named like the remote).
    await expect(
      plugin.afterLoadEntry({
        remoteEntryExports: { init: async () => {}, get: async () => {} },
      })
    ).rejects.toMatchObject({ code: 'NF-027' })
    await expect(
      plugin.afterLoadEntry({ remoteEntryExports: undefined })
    ).rejects.toMatchObject({ code: 'NF-027' })
  })
})

describe('builds the loader can keep apart per layer (A, D)', () => {
  const manifest = (pluginVersion: string) =>
    JSON.stringify({ name: 'gated', metaData: { pluginVersion }, remotes: [] })
  // An entry that bundles its own runtime: its registry on __FEDERATION__.
  const bundled = `
    const g = globalThis;
    if (!Object.prototype.hasOwnProperty.call(g, "__FEDERATION__")) {
      Object.defineProperty(g, "__FEDERATION__", { value: { __INSTANCES__: [] }, configurable: false, writable: true });
    }
    g.__FEDERATION__.__INSTANCES__.push({ name: "gated" });
    exports.instances = g.__FEDERATION__.__INSTANCES__;
    exports.init = async () => {};
    exports.get = async () => () => ({});`
  const viteLike = `const mf = require("@module-federation/runtime"); exports.instances = globalThis.__FEDERATION__ && globalThis.__FEDERATION__.__INSTANCES__; exports.init = async () => {}; exports.get = async () => () => ({});`

  async function load(s: ServerScope, name: string) {
    const plugin = createServerEntryPlugin(options(s))
    await plugin.fetch(`${base}mf-manifest.json`)
    return (await plugin.loadEntry({
      remoteInfo: { name, entry: `${base}remoteEntry.js` },
    })) as { instances?: unknown[] }
  }

  test('the plugin versions pinned and installed here are ones the loader isolates', async () => {
    const { readFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const json = async (path: string) =>
      JSON.parse(
        await readFile(resolve(import.meta.dirname, path), 'utf8')
      ) as {
        version?: string
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
    const rspackFixture = '../../../test/fixtures/components-remote-rspack'
    const builds = [
      {
        plugin: '@module-federation/vite',
        bundlesRuntime: false,
        // The exact pin of @next-federation/vite, and what the lockfile installed.
        versions: [
          (await json('../../vite/package.json')).dependencies![
            '@module-federation/vite'
          ],
          (
            await json(
              '../../vite/node_modules/@module-federation/vite/package.json'
            )
          ).version,
        ],
      },
      {
        plugin: '@module-federation/enhanced',
        bundlesRuntime: true,
        // The Rspack fixture's pin, and what the lockfile installed.
        versions: [
          (await json(`${rspackFixture}/package.json`)).devDependencies![
            '@module-federation/enhanced'
          ],
          (
            await json(
              `${rspackFixture}/node_modules/@module-federation/enhanced/package.json`
            )
          ).version,
        ],
      },
    ]
    for (const { plugin, bundlesRuntime, versions } of builds) {
      for (const pluginVersion of versions) {
        expect(ISOLATED_SERVER_BUILDS).toContainEqual({
          plugin,
          pluginVersion,
          bundlesRuntime,
        })
      }
    }
  })

  test('a build that bundles its own runtime gets a registry per layer, never the process-wide one', async () => {
    files['mf-manifest.json'] = manifest('2.9.2')
    files['remoteEntry.js'] = bundled
    const name = `own_${Math.random().toString(36).slice(2)}`
    const a = await load(scope(), name)
    const b = await load(scope(), name)
    expect(a.instances).toEqual([{ name: 'gated' }])
    expect(b.instances).toEqual([{ name: 'gated' }])
    expect(a.instances).not.toBe(b.instances)
    const fed = (
      globalThis as { __FEDERATION__?: { __INSTANCES__: unknown[] } }
    ).__FEDERATION__
    expect(fed?.__INSTANCES__ ?? []).not.toContainEqual({ name: 'gated' })
  })

  test("a build that bundles its own runtime starts with the scope's plugins as its runtime's global plugins", async () => {
    files['mf-manifest.json'] = manifest('2.9.2')
    // As @module-federation/runtime-core's setGlobalDefaultVal and
    // getPluginsToRegister: an existing registry is completed, and every
    // instance registers its __GLOBAL_PLUGIN__.
    files['remoteEntry.js'] = `
      const g = globalThis;
      if (!Object.prototype.hasOwnProperty.call(g, "__FEDERATION__")) {
        Object.defineProperty(g, "__FEDERATION__", { value: {}, configurable: false, writable: true });
      }
      g.__FEDERATION__.__GLOBAL_PLUGIN__ ??= [];
      g.__FEDERATION__.__INSTANCES__ ??= [];
      exports.plugins = g.__FEDERATION__.__GLOBAL_PLUGIN__;
      exports.init = async () => {};
      exports.get = async () => () => ({});`
    const plugin = { name: 'nf-components-host-shares' }
    const name = `plugins_${Math.random().toString(36).slice(2)}`
    const a = (await load({ ...scope(), plugins: [plugin] }, name)) as {
      plugins?: unknown[]
    }
    const b = (await load({ ...scope(), plugins: [plugin] }, name)) as {
      plugins?: unknown[]
    }
    expect(a.plugins).toEqual([plugin])
    expect(b.plugins).toEqual([plugin])
    // Each scope's registry has its own list; the process-wide one has none.
    expect(a.plugins).not.toBe(b.plugins)
    const fed = (
      globalThis as { __FEDERATION__?: { __GLOBAL_PLUGIN__?: unknown[] } }
    ).__FEDERATION__
    expect(fed?.__GLOBAL_PLUGIN__ ?? []).not.toContain(plugin)
  })

  test("a Vite build keeps the host runtime's process-wide registry", async () => {
    files['mf-manifest.json'] = manifest('1.24.0')
    files['remoteEntry.js'] = viteLike
    const s = scope()
    const exports = await load(s, `vite_${Math.random().toString(36).slice(2)}`)
    expect(exports.instances).toBe(
      (globalThis as { __FEDERATION__?: { __INSTANCES__: unknown[] } })
        .__FEDERATION__?.__INSTANCES__
    )
  })

  test.each([
    ['an unknown plugin version', '9.9.9', bundled],
    ['a known version with another runtime setup', '2.9.2', viteLike],
  ])(
    '%s server-renders only in the first layer that loads it',
    async (_label, version, entry) => {
      const warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
      files['mf-manifest.json'] = manifest(version)
      files['remoteEntry.js'] = entry
      const name = `unknown_${Math.random().toString(36).slice(2)}`
      const first = scope()
      await expect(load(first, name)).resolves.toBeDefined()
      // The same layer again (a restart of its runtime): still allowed.
      await expect(
        load({ ...first, id: `${first.layer}.2`, globals: {} }, name)
      ).resolves.toBeDefined()
      // Another layer: browser-only, warned once.
      const other = scope()
      await expect(load(other, name)).rejects.toMatchObject({
        code: 'NF-028',
      })
      await expect(load(other, name)).rejects.toMatchObject({
        code: 'NF-028',
      })
      const lines = warn.mock.calls
        .map((c) => c.join(' '))
        .filter((l) => l.includes('cannot be kept apart'))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatch(/NF-028/)
    }
  )

  test('a build the loader isolates loads in every layer', async () => {
    files['mf-manifest.json'] = manifest('1.24.0')
    files['remoteEntry.js'] = viteLike
    const name = `known_${Math.random().toString(36).slice(2)}`
    await expect(load(scope(), name)).resolves.toBeDefined()
    await expect(load(scope(), name)).resolves.toBeDefined()
  })

  test('without a scope (one runtime, no layers) nothing is gated', async () => {
    files['remoteEntry.js'] = viteLike
    const exports = (await evaluateServerEntry(
      `${base}remoteEntry.js`,
      options()
    )) as { init?: unknown }
    expect(typeof exports.init).toBe('function')
  })
})
