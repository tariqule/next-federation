// Server loader, security fix round 2: what a layer refuses and how (error
// codes kept through the real Module Federation runtime, one layer for
// every unlisted build, nested remotes, no scope or instance growth, hung
// inits, a server-side `document`).
import { createHash } from 'node:crypto'
import * as MFRuntime from '@module-federation/runtime'
import { createInstance } from '@module-federation/runtime'
import { componentTrustRegistry } from '@next-federation/protocol'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import { createComponentRuntime } from '../src/components/runtime.ts'
import type {
  FederationInstance,
  ServerScope,
} from '../src/components/runtime.ts'
import {
  createServerEntryPlugin,
  evaluateServerEntry,
  forgetInstance,
  serializedInit,
} from '../src/components/server-loader.ts'

const sri = (text: string) =>
  `sha384-${createHash('sha384').update(text).digest('base64')}`

let served: Map<string, string>
let status: Map<string, number>
let hang: Set<string>
let requests: string[]

async function get(url: string) {
  requests.push(url)
  if (hang.has(url)) return new Promise<never>(() => {})
  const code = status.get(url)
  if (code !== undefined) {
    return { status: code, body: new Uint8Array(), headers: {} }
  }
  const body = served.get(url)
  return body === undefined
    ? { status: 404, body: new Uint8Array(), headers: {} }
    : { status: 200, body: new TextEncoder().encode(body), headers: {} }
}

const viteEntry = `
const mf = require("@module-federation/runtime");
exports.init = async () => {};
exports.get = async () => () => ({ default: function Probe() { return null } });`
const bundledEntry = `
exports.init = async () => {};
exports.get = async () => () => ({ default: function Probe() { return null } });`

let builds = 0
/** A build of container `name`, its manifest and entry served from memory. */
function build(
  name: string,
  opts: {
    pluginVersion?: string
    entry?: string
    /** null: no `remotes` field at all. */
    remotes?: unknown
    /** Where the descriptor's manifest points ('direct': the entry itself). */
    manifestPath?: string
  } = {}
) {
  const id = `r${++builds}`
  const base = `http://127.0.0.1:4994/b/${id}/`
  const manifestPath = opts.manifestPath ?? 'mf-manifest.json'
  const files: Record<string, string> = {
    [manifestPath]: JSON.stringify({
      id: name,
      name,
      metaData: {
        name,
        type: 'app',
        buildInfo: { buildVersion: '1.0.0', buildName: name },
        remoteEntry: { name: 'remoteEntry.js', path: '', type: 'module' },
        ssrRemoteEntry: {
          name: 'remoteEntry.ssr.js',
          path: '',
          type: 'module',
        },
        types: { path: '', name: '' },
        globalName: name,
        pluginVersion: opts.pluginVersion ?? '1.24.0',
        publicPath: base,
      },
      shared: [],
      ...(opts.remotes === null ? {} : { remotes: opts.remotes ?? [] }),
      exposes: [
        {
          id: `${name}:Probe`,
          name: 'Probe',
          assets: {
            js: { async: [], sync: [] },
            css: { async: [], sync: [] },
          },
          path: './Probe',
        },
      ],
    }),
    'remoteEntry.ssr.js': opts.entry ?? viteEntry,
  }
  if (manifestPath === 'direct') delete files.direct
  for (const [path, text] of Object.entries(files)) {
    served.set(`${base}${path}`, text)
  }
  const descriptor: RemoteComponentDescriptor = {
    remote: name,
    name,
    buildId: id,
    base,
    manifest:
      manifestPath === 'direct'
        ? `${base}remoteEntry.ssr.js`
        : `${base}${manifestPath}`,
    ssr: {
      integrity: Object.fromEntries(
        Object.entries(files).map(([path, text]) => [path, sri(text)])
      ),
    },
    maxBuilds: 5,
  }
  return { base, descriptor, entry: `${base}remoteEntry.ssr.js` }
}

let clock = 0
/** One server layer on the real MF runtime and server loader. */
function layer(extra: { loadTimeoutMs?: number } = {}) {
  const react = { useState: () => null, version: '19.3.1' }
  const scopes: ServerScope[] = []
  const instances: FederationInstance[] = []
  const forgotten: Array<[FederationInstance, ServerScope | undefined]> = []
  const runtime = createComponentRuntime({
    isServer: true,
    react,
    hostShared: { react: { version: '19.3.1', module: react } },
    createInstance: (options) => {
      const i = createInstance(
        options as unknown as Parameters<typeof createInstance>[0]
      ) as unknown as FederationInstance
      instances.push(i)
      return i
    },
    serverPlugin: (integrityFor, scope) => {
      scopes.push(scope)
      return createServerEntryPlugin({
        integrityFor,
        hostModules: { '@module-federation/runtime': MFRuntime },
        get,
        scope,
      })
    },
    forget: (instance, scope) => {
      forgotten.push([instance, scope])
      forgetInstance(instance, scope)
    },
    canLoadServerCode: () => true,
    isTrusted: () => true,
    now: () => clock,
    serverRetryMs: 1000,
    ...extra,
  })
  return { runtime, scopes, instances, forgotten }
}

const registered = () =>
  (
    (globalThis as { __FEDERATION__?: { __INSTANCES__: unknown[] } })
      .__FEDERATION__?.__INSTANCES__ ?? []
  ).length

let warn: ReturnType<typeof rs.spyOn>
let error: ReturnType<typeof rs.spyOn>
beforeEach(() => {
  served = new Map()
  status = new Map()
  hang = new Set()
  requests = []
  clock += 100_000
  delete componentTrustRegistry().unlistedLayer
  warn = rs.spyOn(console, 'warn').mockImplementation(() => {})
  error = rs.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  rs.restoreAllMocks()
})

const codeOf = async (p: Promise<unknown>) =>
  p.then(
    () => 'loaded',
    (e: { code?: string }) => e.code ?? String(e)
  )

describe('I-1: a failed entry load keeps its own error (real MF runtime)', () => {
  test('a 503 is NF-029, a refusal NF-028, a tampered file NF-027', async () => {
    const down = build('down_entry')
    status.set(down.entry, 503)
    expect(await codeOf(layer().runtime.load(down.descriptor, './Probe'))).toBe(
      'NF-029'
    )

    // A listed version set up otherwise (its own runtime): unlisted, so the
    // other layer refuses it once the graph is known (in loadEntry).
    const owner = layer()
    const other = layer()
    const odd = build('odd_entry', {
      pluginVersion: '1.24.0',
      entry: bundledEntry,
    })
    expect(await codeOf(owner.runtime.load(odd.descriptor, './Probe'))).toBe(
      'loaded'
    )
    expect(await codeOf(other.runtime.load(odd.descriptor, './Probe'))).toBe(
      'NF-028'
    )
    // Refused right after the manifest (MF wraps errors of its manifest
    // fetch): still NF-028, as are nested remotes.
    const unlisted = build('unlisted_entry', {
      pluginVersion: '6.0.0',
      entry: bundledEntry,
    })
    expect(
      await codeOf(owner.runtime.load(unlisted.descriptor, './Probe'))
    ).toBe('loaded')
    expect(
      await codeOf(other.runtime.load(unlisted.descriptor, './Probe'))
    ).toBe('NF-028')
    const nested = build('nested_entry', { remotes: [{ name: 'other' }] })
    expect(
      await codeOf(layer().runtime.load(nested.descriptor, './Probe'))
    ).toBe('NF-028')

    const tampered = build('tampered_entry')
    served.set(tampered.entry, `${viteEntry}\n// changed`)
    expect(
      await codeOf(layer().runtime.load(tampered.descriptor, './Probe'))
    ).toBe('NF-027')
  })
})

describe('I-2: unlisted builds server-render in one layer per process', () => {
  test('two unlisted containers: the first layer to load either gets both', async () => {
    const x = build('unlisted_x', {
      pluginVersion: '7.0.0',
      entry: bundledEntry,
    })
    const y = build('unlisted_y', {
      pluginVersion: '8.0.0',
      entry: bundledEntry,
    })
    const a = layer()
    const b = layer()
    expect(await a.runtime.serverLoad(x.descriptor, './Probe')).not.toBeNull()
    expect(await b.runtime.serverLoad(y.descriptor, './Probe')).toBeNull()
    expect(await b.runtime.serverLoad(x.descriptor, './Probe')).toBeNull()
    expect(await a.runtime.serverLoad(y.descriptor, './Probe')).not.toBeNull()
    expect(b.runtime.serverBlock(x.descriptor)).toBe('unisolated')
    expect(b.runtime.serverBlock(y.descriptor)).toBe('unisolated')
  })

  test('a refused layer never fetches the graph, then no request at all, and logs no error', async () => {
    const x = build('unlisted_z', {
      pluginVersion: '7.0.0',
      entry: bundledEntry,
    })
    await layer().runtime.serverLoad(x.descriptor, './Probe')
    const b = layer()
    requests = []
    expect(await b.runtime.serverLoad(x.descriptor, './Probe')).toBeNull()
    // Refused right after the manifest: the entry graph is never fetched.
    expect(requests).toEqual([`${x.base}mf-manifest.json`])
    // Retries after the cooldown: serverBlock answers, nothing is fetched.
    for (let i = 0; i < 3; i++) {
      clock += 5_000
      requests = []
      expect(
        await b.runtime.serverLoad({ ...x.descriptor }, './Probe')
      ).toBeNull()
      expect(requests).toEqual([])
    }
    expect(error).not.toHaveBeenCalled()
    const lines = warn.mock.calls
      .map((c) => c.join(' '))
      .filter((l) => l.startsWith('[ next-federation ]') && l.includes(x.base))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/NF-028.*cannot be kept apart/)
  })
})

describe('I-3: no scope or instance growth', () => {
  test('repeated timeouts keep the scope and add no instance', async () => {
    const slow = build('slow_entry')
    hang.add(slow.entry)
    const l = layer({ loadTimeoutMs: 20 })
    const before = registered()
    for (let i = 0; i < 4; i++) {
      clock += 5_000
      expect(
        await l.runtime.serverLoad({ ...slow.descriptor }, './Probe')
      ).toBeNull()
    }
    // One scope throughout; each replaced instance left the registry.
    expect(new Set(l.scopes.map((s) => s.id)).size).toBe(1)
    expect(l.instances.length).toBeGreaterThan(1)
    expect(registered() - before).toBeLessThanOrEqual(1)
    expect(l.forgotten.every(([, scope]) => scope === undefined)).toBe(true)
    // The hung entry load was started once, then reused.
    expect(requests.filter((u) => u === slow.entry)).toHaveLength(1)
  })

  test('forgetInstance drops the instance and the scope-tagged registry entries', async () => {
    const x = build('forget_me')
    const l = layer()
    await l.runtime.load(x.descriptor, './Probe')
    const scope = l.scopes[0]!
    const [instance] = l.instances
    const real = globalThis as unknown as {
      __FEDERATION__: {
        __INSTANCES__: unknown[]
        __MANIFEST_LOADING__: Record<string, unknown>
        moduleInfo: Record<string, unknown>
      }
      __GLOBAL_LOADING_REMOTE_ENTRY__: Record<string, unknown>
    }
    const tagged = (record: Record<string, unknown>) =>
      Object.keys(record).filter((k) => k.endsWith(`=${scope.id}`))
    expect(tagged(real.__GLOBAL_LOADING_REMOTE_ENTRY__).length).toBeGreaterThan(
      0
    )
    forgetInstance(instance!, scope)
    expect(real.__FEDERATION__.__INSTANCES__).not.toContain(instance)
    expect(tagged(real.__GLOBAL_LOADING_REMOTE_ENTRY__)).toEqual([])
    expect(tagged(real.__FEDERATION__.__MANIFEST_LOADING__)).toEqual([])
    expect(tagged(real.__FEDERATION__.moduleInfo)).toEqual([])
  })
})

describe('M-1: a hung init never blocks the container', () => {
  test('after the wait, later inits stop waiting for a never-settling one', async () => {
    const name = `hung_${Math.random().toString(36).slice(2)}`
    const calls: string[] = []
    const container = (label: string, forever = false) => ({
      init: () => {
        calls.push(label)
        return forever ? new Promise(() => {}) : Promise.resolve()
      },
    })
    const wrap = (label: string, forever = false) =>
      serializedInit(name, container(label, forever), 30) as {
        init: () => Promise<unknown>
      }
    void wrap('hung', true).init()
    // Still within the wait: the next one waits, then gives up (never runs).
    await expect(wrap('second').init()).rejects.toMatchObject({
      code: 'NF-029',
    })
    expect(calls).toEqual(['hung'])
    // The hung init has run for longer than the wait: no longer waited for.
    await new Promise((r) => setTimeout(r, 10))
    await expect(wrap('third').init()).resolves.toBeUndefined()
    expect(calls).toEqual(['hung', 'third'])
  })
})

describe('M-1b: init timing never reads the wall clock', () => {
  test('serializedInit times inits with performance.now(), not Date.now() (flagged in a partialPrefetching render)', async () => {
    const name = `clock_${Math.random().toString(36).slice(2)}`
    const dateNow = rs.spyOn(Date, 'now')
    const wrap = () =>
      serializedInit(name, { init: () => Promise.resolve() }, 30) as {
        init: () => Promise<unknown>
      }
    await wrap().init()
    void wrap().init()
    await wrap().init()
    expect(dateNow).not.toHaveBeenCalled()
    dateNow.mockRestore()
  })
})

describe('M-2: what the server never evaluates', () => {
  test('a server-side document global never hands remote code the real global', async () => {
    const entry = `
      var g = (function () { try { return document.defaultView } catch (e) { return globalThis } })();
      exports.real = g === realGlobalForSpec;`
    const x = build('doc_entry', { entry })
    const real = globalThis as unknown as Record<string, unknown>
    real.realGlobalForSpec = globalThis
    real.document = { defaultView: globalThis }
    try {
      const scope: ServerScope = {
        id: 'doc.1',
        layer: 'doc',
        globals: {},
        blocked: new Map(),
        builds: new Map(),
        failures: new Map(),
        unlisted: new Set(),
      }
      const exports = (await evaluateServerEntry(x.entry, {
        integrityFor: (url) =>
          url.startsWith(x.base)
            ? { base: x.base, integrity: x.descriptor.ssr!.integrity }
            : undefined,
        hostModules: { '@module-federation/runtime': MFRuntime },
        get,
        scope,
      })) as { real: boolean }
      expect(exports.real).toBe(false)
    } finally {
      delete real.document
      delete real.realGlobalForSpec
    }
  })

  test('a build whose manifest lists remotes renders browser-only, before any server code is fetched', async () => {
    const x = build('nested_remotes', {
      remotes: [{ federationContainerName: 'other', moduleName: 'X' }],
    })
    const l = layer()
    requests = []
    expect(await l.runtime.serverLoad(x.descriptor, './Probe')).toBeNull()
    expect(requests).toEqual([`${x.base}mf-manifest.json`])
    expect(l.runtime.serverBlock(x.descriptor)).toBe('nested-remotes')
    expect(error).not.toHaveBeenCalled()
    expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(
      /NF-028.*lists remotes of its own/
    )
  })

  test("the MF runtime's own Node script loader fails closed", () => {
    const plugin = createServerEntryPlugin({
      integrityFor: () => undefined,
      hostModules: { '@module-federation/runtime': MFRuntime },
    })
    expect(() =>
      plugin.createScript({ url: 'http://127.0.0.1:1/x.js' })
    ).toThrow(/NF-027/)
  })
})

describe('round 3: manifest checks fail closed', () => {
  test.each([
    ['a direct-entry descriptor (manifest = the entry)', 'direct'],
    ['a manifest named manifest.json', 'manifest.json'],
    ['a manifest URL with a query', 'mf-manifest.json?v=2'],
  ])('%s never server-renders unchecked', async (_label, manifestPath) => {
    // Nested remotes: must never server-render, whatever the manifest URL.
    const nested = build(`nested_${manifestPath}`, {
      manifestPath,
      remotes: [{ name: 'other' }],
    })
    const l = layer()
    expect(await l.runtime.serverLoad(nested.descriptor, './Probe')).toBeNull()
    expect(['nested-remotes', 'unchecked']).toContain(
      l.runtime.serverBlock(nested.descriptor)
    )
    // An unlisted build in a second layer: refused there too.
    const x = build(`unlisted_${manifestPath}`, {
      manifestPath,
      pluginVersion: '7.0.0',
      entry: bundledEntry,
    })
    const owner = layer()
    const other = layer()
    const first = await owner.runtime.serverLoad(x.descriptor, './Probe')
    if (manifestPath === 'direct') {
      // No manifest at all: not checkable, browser-only everywhere.
      expect(first).toBeNull()
      expect(owner.runtime.serverBlock(x.descriptor)).toBe('unchecked')
    } else {
      expect(first).not.toBeNull()
    }
    expect(await other.runtime.serverLoad(x.descriptor, './Probe')).toBeNull()
  })

  test('a tampered manifest is NF-027, not the NF-029 MF wraps it in', async () => {
    const x = build('tampered_manifest')
    served.set(`${x.base}mf-manifest.json`, '{"changed":true}')
    expect(await codeOf(layer().runtime.load(x.descriptor, './Probe'))).toBe(
      'NF-027'
    )
  })

  test('a build that never ran (a syntax error) does not claim the unlisted layer', async () => {
    const broken = build('unlisted_broken', {
      pluginVersion: '7.0.0',
      entry: 'exports.x = ;',
    })
    const x = build('unlisted_ok', {
      pluginVersion: '7.0.0',
      entry: bundledEntry,
    })
    const a = layer()
    const b = layer()
    expect(await a.runtime.serverLoad(broken.descriptor, './Probe')).toBeNull()
    expect(componentTrustRegistry().unlistedLayer).toBeUndefined()
    // The other layer can still be the one.
    expect(await b.runtime.serverLoad(x.descriptor, './Probe')).not.toBeNull()
    expect(await a.runtime.serverLoad(x.descriptor, './Probe')).toBeNull()
  })

  test('a build whose code ran before it threw keeps the claim', async () => {
    const broken = build('unlisted_half', {
      pluginVersion: '7.0.0',
      entry: 'globalThis.__nfHalfRan = true; throw new Error("half way")',
    })
    const a = layer()
    try {
      expect(
        await a.runtime.serverLoad(broken.descriptor, './Probe')
      ).toBeNull()
      expect(componentTrustRegistry().unlistedLayer).toBe(a.scopes[0]!.layer)
    } finally {
      delete (globalThis as Record<string, unknown>).__nfHalfRan
    }
  })

  test('an unlisted refusal is not permanent: the layer server-renders once the claim is free', async () => {
    const x = build('unlisted_free', {
      pluginVersion: '7.0.0',
      entry: bundledEntry,
    })
    const a = layer()
    const b = layer()
    expect(await a.runtime.serverLoad(x.descriptor, './Probe')).not.toBeNull()
    expect(await b.runtime.serverLoad(x.descriptor, './Probe')).toBeNull()
    expect(b.runtime.serverBlock(x.descriptor)).toBe('unisolated')
    // The claim is released (as a failed first evaluation releases it).
    delete componentTrustRegistry().unlistedLayer
    expect(b.runtime.serverBlock(x.descriptor)).toBeNull()
    clock += 5_000
    expect(
      await b.runtime.serverLoad({ ...x.descriptor }, './Probe')
    ).not.toBeNull()
    expect(componentTrustRegistry().unlistedLayer).toBe(b.scopes[0]!.layer)
  })

  test('a manifest without a remotes list is unchecked: browser-only', async () => {
    for (const remotes of [null, 'other', { other: 1 }]) {
      const x = build(`remotes_${String(remotes)}`, { remotes })
      const l = layer()
      requests = []
      expect(await l.runtime.serverLoad(x.descriptor, './Probe')).toBeNull()
      expect(l.runtime.serverBlock(x.descriptor)).toBe('unchecked')
      expect(requests).toEqual([`${x.base}mf-manifest.json`])
    }
  })

  test('replaced instances leave no __SHARE__ entry behind', async () => {
    const slow = build('slow_share')
    hang.add(slow.entry)
    const l = layer({ loadTimeoutMs: 20 })
    for (let i = 0; i < 4; i++) {
      clock += 5_000
      await l.runtime.serverLoad({ ...slow.descriptor }, './Probe')
    }
    const id = l.scopes[0]!.id
    const share =
      (globalThis as { __FEDERATION__?: { __SHARE__?: object } }).__FEDERATION__
        ?.__SHARE__ ?? ({} as Record<string, unknown>)
    const keys = Object.keys(share).filter(
      (k) => k === `nf_host_${id}` || k.startsWith(`nf_host_${id}@`)
    )
    // At most one entry, and never a replaced instance's share scope.
    expect(keys.length).toBeLessThanOrEqual(1)
    const replaced = l.forgotten.map(
      ([instance]) =>
        (instance as unknown as { shareScopeMap: unknown }).shareScopeMap
    )
    expect(replaced.length).toBeGreaterThan(1)
    for (const key of keys) {
      expect(replaced).not.toContain((share as Record<string, unknown>)[key])
    }
  })

  test('a polyfilled window or self never hands remote code the real global', async () => {
    const entry = `
      exports.window = typeof window === "undefined" ? "none" : window === realGlobalForSpec ? "real" : "other";
      exports.self = typeof self === "undefined" ? "none" : self === realGlobalForSpec ? "real" : "other";`
    const x = build('window_entry', { entry })
    const real = globalThis as unknown as Record<string, unknown>
    real.realGlobalForSpec = globalThis
    real.window = globalThis
    const hadSelf = 'self' in real
    const self = real.self
    real.self = globalThis
    try {
      const exports = (await evaluateServerEntry(x.entry, {
        integrityFor: (url) =>
          url.startsWith(x.base)
            ? { base: x.base, integrity: x.descriptor.ssr!.integrity }
            : undefined,
        hostModules: { '@module-federation/runtime': MFRuntime },
        get,
        scope: {
          id: 'win.1',
          layer: 'win',
          globals: {},
          blocked: new Map(),
          builds: new Map(),
          failures: new Map(),
          unlisted: new Set(),
        },
      })) as { window: string; self: string }
      expect(exports).toEqual({ window: 'none', self: 'none' })
    } finally {
      delete real.window
      delete real.realGlobalForSpec
      if (hadSelf) real.self = self
      else delete real.self
    }
  })
})
